import { expect, test } from 'vitest';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentPrintPacks, assessments, workflowDispatches } from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import {
  createPrintPreview,
  getPrintPreview,
  inspectPrint,
} from '../lib/services/assessment_print_previews.ts';
import type { PrintConfiguration } from '../lib/print/print_contract.ts';
import { printSourceDigest } from '../lib/print/print_snapshot.ts';
import { printPackIdentityValid } from '../lib/print/print_pack.ts';
import { parsePrintConfirmation } from '../lib/services/assessment_print_confirmation.ts';

const configuration: PrintConfiguration = {
  title: 'Paper',
  paper: 'a4',
  locale: 'sv-SE',
  instructions: '',
  responseLines: 6,
  responseOverrides: {},
  order: 'authored',
  approvePresentation: true,
};

test('real PostgreSQL reservation seals actual revision identity, replays one operation, and atomically enqueues', async () => {
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const assessment = await createAssessmentDraft(ctx, { title: 'Print snapshot fixture' });
      try {
        const initial = await getAssessment(ctx, assessment.id);
        if (!initial) expect.unreachable();
        const saved = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: initial.parts[0].id,
          draft: {
            type: 'single_select',
            title: 'STAFF_TITLE',
            itemLanguage: newAuthoringItemLanguage(),
            bodyHtml: '<p>Choose.</p>',
            maximumScore: 2,
            choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }],
            correctId: 'B',
          },
        });
        if (!saved.ok) expect.unreachable();
        const deps = {
          database: db,
          storage: createMemoryObjectStorage(),
          now: () => new Date('2026-10-29T10:00:00Z'),
          newId: () => crypto.randomUUID(),
        };
        const operation = crypto.randomUUID();
        const result = await createPrintPreview(ctx, assessment.id, operation, configuration, deps);
        expect(result.ok).toBe(true);
        if (!result.ok || !result.value.pack) expect.unreachable();
        const pack = result.value.pack;
        expect(pack.state).toBe('queued');
        const placement = pack.snapshot.source.parts[0].placements[0];
        expect(placement.kind).toBe('question');
        if (placement.kind !== 'question') expect.unreachable();
        expect(placement.revisionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(placement.revision).toBe(1);
        expect(await createPrintPreview(ctx, assessment.id, operation, configuration, deps))
          .toEqual(result);
        expect(
          await createPrintPreview(ctx, assessment.id, operation, {
            ...configuration,
            title: 'Changed',
          }, deps),
        ).toEqual({ ok: false, code: 'operation_conflict' });
        const dispatches = await db.select().from(workflowDispatches).where(
          eq(workflowDispatches.jobId, pack.id),
        );
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toMatchObject({
          kind: 'assessment_print',
          state: 'pending',
          id: pack.workflowExecutionId,
        });
        // A process stopped after reservation: replay must enqueue the same form/execution.
        await db.delete(workflowDispatches).where(eq(workflowDispatches.jobId, pack.id));
        await db.update(assessmentPrintPacks).set({ state: 'preparing' }).where(
          eq(assessmentPrintPacks.id, pack.id),
        );
        const resumed = await createPrintPreview(
          ctx,
          assessment.id,
          operation,
          configuration,
          deps,
        );
        expect(resumed).toEqual(result);
        expect(
          await db.select().from(workflowDispatches).where(eq(workflowDispatches.jobId, pack.id)),
        ).toHaveLength(1);
        const older = {
          ...pack.snapshot,
          rendererId: 'retained-older-compiler',
          templateVersion: 'retained-older-template',
        };
        const oldDigest = await printSourceDigest(
          older.source,
          older.configuration,
          older.assets,
          older,
        );
        expect(
          await printPackIdentityValid({
            ...pack,
            snapshot: { ...older, sourceDigest: oldDigest },
          }),
        ).toBe(true);
        expect(oldDigest).not.toBe(
          await printSourceDigest(older.source, older.configuration, older.assets),
        );
        const before = await inspectPrint(ctx, assessment.id, configuration, deps);
        await db.update(assessments).set({ title: 'Changed source metadata' }).where(
          eq(assessments.id, assessment.id),
        );
        const after = await inspectPrint(ctx, assessment.id, configuration, deps);
        expect(before.ok && after.ok && before.value.digest !== after.value.digest).toBe(true);
        expect(
          await getPrintPreview(
            { ...ctx, tenantId: crypto.randomUUID() },
            assessment.id,
            pack.id,
            deps,
          ),
        ).toEqual({ ok: false, code: 'forbidden' });
        expect(await createPrintPreview(ctx, assessment.id, operation, configuration, deps))
          .toEqual(result);
        const corrupt = structuredClone(pack.snapshot);
        const question = corrupt.source.parts[0].placements[0];
        if (question.kind !== 'question') expect.unreachable();
        const poisoned = {
          ...corrupt,
          source: { ...corrupt.source, assessmentTitle: 'CORRUPTED_SEALED_SOURCE' },
        };
        await db.update(assessmentPrintPacks).set({ snapshot: poisoned }).where(
          eq(assessmentPrintPacks.id, pack.id),
        );
        expect(await getPrintPreview(ctx, assessment.id, pack.id, deps)).toEqual({
          ok: false,
          code: 'snapshot_corrupt',
        });
        expect(parsePrintConfirmation(null)).toBeNull();
        expect(parsePrintConfirmation({ candidateDigest: 'a'.repeat(64) })).toBeNull();
      } finally {
        await db.delete(assessmentPrintPacks).where(
          eq(assessmentPrintPacks.assessmentId, assessment.id),
        );
        await deleteAssessment(ctx, assessment.id);
      }
    });
  } finally {
    await shutdownDb();
  }
});

test('an already adopted same-operation reservation is neither failed nor cleaned up by a later preparation result', async () => {
  const { readFile } = await import('node:fs/promises');
  const image = await readFile(new URL('./fixtures/print/metadata-alpha.png', import.meta.url));
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const assessment = await createAssessmentDraft(ctx, { title: 'Adoption guard fixture' });
      try {
        const initial = await getAssessment(ctx, assessment.id);
        if (!initial) expect.unreachable();
        const saved = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: initial.parts[0].id,
          draft: {
            type: 'single_select',
            title: 'Guard',
            itemLanguage: newAuthoringItemLanguage(),
            bodyHtml: `<p>Diagram.</p><img src="data:image/png;base64,${
              image.toString('base64')
            }" alt="Diagram"/>`,
            maximumScore: 1,
            choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }],
            correctId: 'A',
          },
        });
        if (!saved.ok) expect.unreachable();
        const objects = createMemoryObjectStorage();
        let adoptedId: string | null = null;
        const storage = {
          ...objects,
          async putObject(input: Parameters<typeof objects.putObject>[0]) {
            await objects.putObject(input);
            if (adoptedId) return;
            const [reservation] = await db.select().from(assessmentPrintPacks).where(
              eq(assessmentPrintPacks.assessmentId, assessment.id),
            );
            if (!reservation?.workflowExecutionId) expect.unreachable();
            const executionId = reservation.workflowExecutionId;
            adoptedId = reservation.id;
            // Simulate a second accepted caller's actual SQL adoption while this caller owns no lock.
            await db.transaction(async (tx) => {
              await tx.update(assessmentPrintPacks).set({ state: 'queued' }).where(
                eq(assessmentPrintPacks.id, reservation.id),
              );
              await tx.insert(workflowDispatches).values({
                id: executionId,
                kind: 'assessment_print',
                jobId: reservation.id,
                tenantId: ctx.tenantId,
                state: 'pending',
              });
              await tx.update(assessments).set({ title: 'Live source changed after adoption' })
                .where(eq(assessments.id, assessment.id));
            });
          },
        };
        const deps = {
          database: db,
          storage,
          now: () => new Date('2026-10-29T10:00:00Z'),
          newId: () => crypto.randomUUID(),
        };
        expect(
          await createPrintPreview(ctx, assessment.id, crypto.randomUUID(), configuration, deps),
        ).toEqual({ ok: false, code: 'not_ready' });
        if (!adoptedId) expect.unreachable();
        const retained = await getPrintPreview(ctx, assessment.id, adoptedId, deps);
        if (!retained.ok) expect.unreachable();
        expect(retained.value.state).toBe('queued');
        expect(retained.value.snapshot.assets).toHaveLength(1);
        for (const asset of retained.value.snapshot.assets) {
          expect((await objects.readObject(asset.sourceKey)).length).toBe(image.length);
          expect((await objects.readObject(asset.key)).length).toBe(asset.byteLength);
        }
        expect(
          await db.select().from(workflowDispatches).where(eq(workflowDispatches.jobId, adoptedId)),
        ).toHaveLength(1);
      } finally {
        await db.delete(assessmentPrintPacks).where(
          eq(assessmentPrintPacks.assessmentId, assessment.id),
        );
        await deleteAssessment(ctx, assessment.id);
      }
    });
  } finally {
    await shutdownDb();
  }
});
