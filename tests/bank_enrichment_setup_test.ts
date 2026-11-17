import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  enrichmentAssignments,
  enrichmentChanges,
  enrichmentSchemeVersions,
} from '../lib/db/bank_enrichment_schema.ts';
import { enrichmentRuns } from '../lib/db/bank_enrichment_job_schema.ts';
import { questionRevisions } from '../lib/db/question_schema.ts';
import { BankEnrichmentSetup } from '../lib/services/bank_enrichment_setup.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { uuidV5 } from '../lib/uuid_v5.ts';
import { enrichmentConfigFixture as config } from './helpers/enrichment_provider_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { finishTestEnrichment } from './helpers/enrichment_test_worker.ts';
import {
  enrichmentDraftForSave,
  keepEnrichmentExample,
  removeEnrichmentCategory,
} from '../lib/bank_enrichment_editor.ts';

testCase(
  'setup freezes more than a page, previews without writes, and starts exactly one saved version/run',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await addEnrichmentQuestions(ctx, 105);
        const setup = new BankEnrichmentSetup(db, () => new Date());
        const read = new BankEnrichmentJobRead(db, () => new Date());
        const operationId = crypto.randomUUID();
        const scope = { _tag: 'Filtered', queryString: 'tags=source-science&page=2&pageSize=100' };
        expect(await new BankEnrichmentScopes(db, () => new Date()).inspect(ctx, scope))
          .toStrictEqual({
            ok: true,
            value: 105,
          });
        const begin = await setup.begin(ctx, operationId, scope, 'Grade 6 science', null, config);
        if (!(begin.ok)) expect.unreachable(JSON.stringify(begin));
        await addEnrichmentQuestions(ctx, 1);
        expect(await setup.begin(ctx, operationId, scope, 'Grade 6 science', null, config))
          .toStrictEqual(begin);
        expect(
          (await finishTestEnrichment(operationId, await uuidV5(operationId, 'execution')))._tag,
        ).toStrictEqual('Completed');
        const preview = await read.get(ctx, operationId);
        if (
          !(preview.ok && preview.value.kind === 'preview' && preview.value.result &&
            preview.value.sample)
        ) {
          expect.unreachable(
            "Expected preview.ok && preview.value.kind === 'preview' && preview.value.result && preview.value.sa",
          );
        }
        expect(preview.value.scopeCount).toStrictEqual(105);
        expect(
          (await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.tenantId, ctx.tenantId),
          )).length,
        ).toStrictEqual(0);
        expect(preview.value.result.definition.examples).toStrictEqual([]);
        const withExamples = preview.value.result.examples.reduce(
          (draft, example) => keepEnrichmentExample(draft, example),
          preview.value.result.definition,
        );
        const changed = enrichmentDraftForSave(
          removeEnrichmentCategory(withExamples, 'subject', 'physical', 'life'),
          null,
        );
        const secondId = crypto.randomUUID();
        if (
          !((await setup.preview(ctx, operationId, secondId, changed, {
            selection: 'current',
            dimensions: ['subject', 'topic', 'difficulty'],
          }, config)).ok)
        ) {
          expect.unreachable(
            "Expected (await setup.preview(ctx, operationId, secondId, changed, { selection: 'current', dimensio",
          );
        }
        expect((await finishTestEnrichment(secondId, await uuidV5(secondId, 'execution')))._tag)
          .toStrictEqual('Completed');
        const second = await read.get(ctx, secondId);
        if (!(second.ok && second.value.kind === 'preview' && second.value.sample)) {
          expect.unreachable(
            "Expected second.ok && second.value.kind === 'preview' && second.value.sample",
          );
        }
        expect(second.value.snapshotId).toStrictEqual(preview.value.snapshotId);
        expect(second.value.sample.seed).toStrictEqual(preview.value.sample.seed);
        const oversized = {
          ...changed,
          topics: [
            ...changed.topics,
            ...Array.from({ length: 200 }, (_, n) => ({
              id: `extra-${n}`,
              label: `Extra ${n}`,
              definition: 'x'.repeat(1000),
              subjectId: 'life',
            })),
          ],
        };
        expect(
          await setup.start(ctx, secondId, oversized, 'preserve_manual', [
            'subject',
            'topic',
            'difficulty',
          ], config),
        ).toStrictEqual({
          ok: false,
          code: 'input_too_large',
        });
        expect(
          (await db.select().from(enrichmentSchemeVersions).where(
            eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
          )).length,
        ).toStrictEqual(0);
        const starts = await Promise.all([
          setup.start(
            ctx,
            secondId,
            changed,
            'preserve_manual',
            ['subject', 'topic', 'difficulty'],
            config,
          ),
          setup.start(
            ctx,
            secondId,
            changed,
            'preserve_manual',
            ['subject', 'topic', 'difficulty'],
            config,
          ),
        ]);
        if (!(starts[0].ok)) expect.unreachable(JSON.stringify(starts[0]));
        expect(starts[1]).toStrictEqual(starts[0]);
        expect(
          (await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.tenantId, ctx.tenantId)))
            .length,
        ).toStrictEqual(1);
        expect(
          (await db.select().from(enrichmentSchemeVersions).where(
            eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
          )).length,
        ).toStrictEqual(1);
        const before = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        );
        const runId = starts[0].value;
        expect((await finishTestEnrichment(runId, await uuidV5(runId, 'execution')))._tag)
          .toStrictEqual('Completed');
        expect(
          (await db.select().from(enrichmentAssignments).where(
            eq(enrichmentAssignments.tenantId, ctx.tenantId),
          )).length,
        ).toStrictEqual(315);
        expect(
          await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ),
        ).toStrictEqual(before);
        const home = await setup.home(ctx);
        if (!(home.ok)) expect.unreachable('Expected home.ok');
        const saved = home.value.schemes[0];
        expect(saved.definition).toStrictEqual(changed);
        const reuseId = crypto.randomUUID();
        if (
          !((await setup.begin(
            ctx,
            reuseId,
            { _tag: 'Filtered', queryString: 'q=Cell+question+104' },
            'Grade 6 science',
            saved.id,
            config,
          )).ok)
        ) {
          expect.unreachable(
            "Expected (await setup.begin( ctx, reuseId, { _tag: 'Filtered', queryString: 'q=Cell+question+104' }",
          );
        }
        expect((await finishTestEnrichment(reuseId, await uuidV5(reuseId, 'execution')))._tag)
          .toStrictEqual('Completed');
        const reused = await read.get(ctx, reuseId);
        if (!(reused.ok && reused.value.kind === 'preview' && reused.value.result)) {
          expect.unreachable(
            "Expected reused.ok && reused.value.kind === 'preview' && reused.value.result",
          );
        }
        expect(reused.value.baseVersionId).toStrictEqual(saved.id);
        const examples = await setup.examples(ctx, reused.value.result.definition);
        if (!(examples.ok)) expect.unreachable('Expected examples.ok');
        expect(examples.value.length).toStrictEqual(changed.examples.length);
        if (!(examples.value.some((q) => q.title !== 'Cell question 104'))) {
          expect.unreachable('Saved examples outside the new sample must remain visible.');
        }
        const newRun = await setup.start(
          ctx,
          reuseId,
          reused.value.result.definition,
          'preserve_manual',
          ['difficulty'],
          config,
        );
        if (!(newRun.ok)) expect.unreachable(JSON.stringify(newRun));
        expect(
          (await finishTestEnrichment(newRun.value, await uuidV5(newRun.value, 'execution')))._tag,
        ).toStrictEqual('Completed');
        const targeted = await read.get(ctx, newRun.value);
        if (!(targeted.ok && targeted.value.kind === 'classify')) {
          expect.unreachable("Expected targeted.ok && targeted.value.kind === 'classify'");
        }
        expect(targeted.value.command.dimensions).toStrictEqual(['difficulty']);
        expect(targeted.value.progress.total).toStrictEqual(1);
        const targetWrites = await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.operationId, newRun.value),
        );
        expect(targetWrites.map((w) => w.dimension)).toStrictEqual(['difficulty']);
        const versions = await db.select().from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.schemeId, saved.schemeId),
        );
        expect(versions.length).toStrictEqual(2);
        expect(await setup.begin(ctx, crypto.randomUUID(), scope, ' ', null, config)).toStrictEqual(
          {
            ok: false,
            code: 'invalid_input',
          },
        );
        await withEnrichmentWorkspace(async (other) => {
          expect(await setup.begin(other, crypto.randomUUID(), scope, 'Grade 6', saved.id, config))
            .toStrictEqual({ ok: false, code: 'not_found' });
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);
