import { expect, test as testCase } from 'vitest';

import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';
import { prepareQuestionRevision } from '../lib/question_revision_preparation.ts';
import { saveQuestionRevisionInTransaction } from '../lib/services/questions.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import {
  enrichmentAssignments,
  enrichmentChanges,
  enrichmentSchemeVersions,
} from '../lib/db/bank_enrichment_schema.ts';
import {
  organizationActivation,
  organizationRuns,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import {
  parsePreviewTeachingCommand,
  teachOrganizationPreview,
} from '../lib/services/question_organization_preview_teaching.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { saveOrganizationSetup } from '../lib/services/question_organization_store.ts';
import { loadOrganizationRun } from '../lib/services/question_organization_read.ts';

async function finish(id: string, taught?: string) {
  const [run] = await db.select().from(organizationRuns).where(eq(organizationRuns.id, id));
  const result = await processOrganizationStep(
    { jobId: id, workflowExecutionId: run.executionId },
    {
      database: db,
      now: organizationNow,
      newId: () => crypto.randomUUID(),
      provider: () =>
        fixtureClefProvider((_question, _definition, examples) => {
          if (taught) {
            if (!(examples.some((e) => e.topicId === taught))) {
              expect.unreachable('New preview must receive the submitted teaching example');
            }
          }
          return Promise.resolve({
            ok: true,
            value: {
              topicId: taught ?? 'cells',
              confidence: 0.99,
              probabilities: {
                cells: taught ? 0.01 : 0.99,
                energy: taught ? 0.99 : 0.01,
                __no_match__: 0,
              },
              model: 'clef',
              inputTokens: 700,
              outputTokens: 41,
            },
          });
        }),
    },
  );
  if (!(result.ok && result.value.state === 'completed')) {
    expect.unreachable("Expected result.ok && result.value.state === 'completed'");
  }
}

testCase('preview teaching parser accepts only bounded explicit unique lessons', () => {
  const operationId = crypto.randomUUID();
  const correction = {
    questionId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    topicId: 'energy',
  };
  if (!(parsePreviewTeachingCommand({ operationId, corrections: [correction] }))) {
    expect.unreachable(
      'Expected parsePreviewTeachingCommand({ operationId, corrections: [correction] })',
    );
  }
  for (
    const invalid of [
      { operationId, corrections: [] },
      { operationId, corrections: [correction, correction] },
      { operationId, corrections: [{ ...correction, acceptAll: true }] },
      {
        operationId,
        corrections: Array.from(
          { length: 21 },
          () => ({ ...correction, questionId: crypto.randomUUID() }),
        ),
      },
      { operationId: 'bad', corrections: [correction] },
      { operationId, corrections: [{ ...correction, topicId: null }] },
    ]
  ) expect(parsePreviewTeachingCommand(invalid)).toStrictEqual(null);
});

testCase(
  'preview corrections teach a new preview atomically, replay once, preserve activation and leave the bank untouched',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const preview = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: f.setupId,
        mode: 'preview',
      });
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      await finish(preview.value);
      const view = await workspace.run(f.ctx, preview.value);
      if (!(view.ok && view.value.sample.every((s) => s.canTeach))) {
        expect.unreachable('Expected view.ok && view.value.sample.every((s) => s.canTeach)');
      }
      const sample = view.value.sample[0];
      const command = parsePreviewTeachingCommand({
        operationId: crypto.randomUUID(),
        corrections: [{
          questionId: sample.questionId,
          revisionId: sample.revisionId,
          topicId: 'energy',
        }],
      });
      if (!command) expect.unreachable('Expected command');
      const beforeActivation = await db.select().from(organizationActivation).where(
        eq(organizationActivation.tenantId, f.ctx.tenantId),
      );
      const corrected = await teachOrganizationPreview(
        db,
        f.ctx,
        preview.value,
        command,
        organizationNow(),
      );
      if (!(corrected.ok)) expect.unreachable('Expected corrected.ok');
      expect(await teachOrganizationPreview(db, f.ctx, preview.value, command, organizationNow()))
        .toStrictEqual(corrected);
      expect(
        await teachOrganizationPreview(db, f.ctx, preview.value, {
          ...command,
          corrections: [{ ...command.corrections[0], topicId: 'cells' }],
        }, organizationNow()),
      ).toStrictEqual({ ok: false, code: 'conflict' });
      const queued = await workspace.run(f.ctx, corrected.value);
      if (!(queued.ok)) expect.unreachable('Expected queued.ok');
      expect(queued.value.definition.examples).toStrictEqual([{
        questionId: sample.questionId,
        revisionId: sample.revisionId,
        classification: {
          subject: { state: 'assigned', valueIds: ['physical'] },
          topic: { state: 'assigned', valueIds: ['energy'] },
          difficulty: null,
        },
      }]);
      expect(
        (await db.select().from(organizationSetups).where(
          eq(organizationSetups.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(2);
      expect(
        (await db.select().from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(2);
      expect(
        await db.select().from(organizationActivation).where(
          eq(organizationActivation.tenantId, f.ctx.tenantId),
        ),
      ).toStrictEqual(beforeActivation);
      expect(
        (await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(0);
      expect(
        (await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.collectionId, f.destinationId),
        )).length,
      ).toStrictEqual(0);
      const original = await workspace.run(f.ctx, preview.value);
      if (!(original.ok)) expect.unreachable('Expected original.ok');
      expect(original.value.definition.examples).toStrictEqual([]);
      expect(original.value.sample[0].topic).toStrictEqual('Cells');
      expect(
        await workspace.queue(f.ctx, {
          id: crypto.randomUUID(),
          setupId: f.setupId,
          mode: 'apply',
        }),
      ).toStrictEqual({ ok: false, code: 'conflict' });
      await finish(corrected.value, 'energy');
      const apply = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: queued.value.setupId,
        mode: 'apply',
      });
      if (!(apply.ok)) expect.unreachable('Expected apply.ok');
      await finish(apply.value, 'energy');
      expect(
        (await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.operationId, apply.value),
        )).length,
      ).toStrictEqual(6);
      expect(
        await workspace.queue(f.ctx, {
          id: apply.value,
          setupId: queued.value.setupId,
          mode: 'apply',
        }),
      ).toStrictEqual(apply);
    }, { clef: true, difficulty: 'none' });
  },
);

testCase(
  'preview teaching refuses non-model, foreign, invalid and stale corrections without partial writes',
  async () => {
    for (const clef of [false, true]) {
      await withOrganizationWorkspace(async (f) => {
        const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
        const preview = await workspace.queue(f.ctx, {
          id: crypto.randomUUID(),
          setupId: f.setupId,
          mode: 'preview',
        });
        if (!(preview.ok)) expect.unreachable('Expected preview.ok');
        await finish(preview.value);
        const view = await workspace.run(f.ctx, preview.value);
        if (!(view.ok)) expect.unreachable('Expected view.ok');
        const sample = view.value.sample[0];
        const command = parsePreviewTeachingCommand({
          operationId: crypto.randomUUID(),
          corrections: [{
            questionId: sample.questionId,
            revisionId: sample.revisionId,
            topicId: 'energy',
          }],
        });
        if (!command) expect.unreachable('Expected command');
        expect(
          await teachOrganizationPreview(
            db,
            { ...f.ctx, tenantId: crypto.randomUUID() },
            preview.value,
            command,
            organizationNow(),
          ),
        ).toStrictEqual({ ok: false, code: 'forbidden' });
        expect(await teachOrganizationPreview(db, f.ctx, f.runId, command, organizationNow()))
          .toStrictEqual({
            ok: false,
            code: 'conflict',
          });
        if (!clef) {
          expect(sample.canTeach).toStrictEqual(false);
          expect(
            await teachOrganizationPreview(db, f.ctx, preview.value, command, organizationNow()),
          ).toStrictEqual({ ok: false, code: 'conflict' });
          return;
        }
        for (
          const correction of [{ ...command.corrections[0], topicId: 'missing' }, {
            ...command.corrections[0],
            questionId: crypto.randomUUID(),
          }, { ...command.corrections[0], revisionId: crypto.randomUUID() }]
        ) {
          expect(
            await teachOrganizationPreview(db, f.ctx, preview.value, {
              ...command,
              corrections: [correction],
            }, organizationNow()),
          ).toStrictEqual({ ok: false, code: 'invalid_input' });
        }
        await db.update(questions).set({
          lifecycleState: 'archived',
          archivedAt: organizationNow(),
          archivedBy: f.ctx.userId,
        }).where(eq(questions.id, sample.questionId));
        expect(await teachOrganizationPreview(db, f.ctx, preview.value, command, organizationNow()))
          .toStrictEqual({ ok: false, code: 'conflict' });
        expect(
          (await db.select().from(organizationSetups).where(
            eq(organizationSetups.tenantId, f.ctx.tenantId),
          )).length,
        ).toStrictEqual(1);
        expect(
          (await db.select().from(enrichmentSchemeVersions).where(
            eq(enrichmentSchemeVersions.tenantId, f.ctx.tenantId),
          )).length,
        ).toStrictEqual(1);
      }, { clef, activation: 'disabled', difficulty: 'none' });
    }
  },
);

testCase('a newer collection setup wins over preview corrections', async () => {
  await withOrganizationWorkspace(async (f) => {
    const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
    const preview = await workspace.queue(f.ctx, {
      id: crypto.randomUUID(),
      setupId: f.setupId,
      mode: 'preview',
    });
    if (!(preview.ok)) expect.unreachable('Expected preview.ok');
    await finish(preview.value);
    const [run] = await db.select().from(organizationRuns).where(
      eq(organizationRuns.id, preview.value),
    );
    const context = await loadOrganizationRun(db, run.id, run.executionId, {
      kind: 'request',
      ctx: f.ctx,
    });
    if (!context) expect.unreachable('Expected context');
    if (
      !((await saveOrganizationSetup(db, f.ctx, {
        id: crypto.randomUUID(),
        collectionId: f.originId,
        expectedVersion: 1,
        policy: { ...context.policy, filing: [] },
      }, organizationNow())).ok)
    ) {
      expect.unreachable(
        'Expected (await saveOrganizationSetup(db, f.ctx, { id: crypto.randomUUID(), collectionId: f.originI',
      );
    }
    const view = await workspace.run(f.ctx, preview.value);
    if (!(view.ok)) expect.unreachable('Expected view.ok');
    const sample = view.value.sample[0];
    const command = parsePreviewTeachingCommand({
      operationId: crypto.randomUUID(),
      corrections: [{
        questionId: sample.questionId,
        revisionId: sample.revisionId,
        topicId: 'energy',
      }],
    });
    if (!command) expect.unreachable('Expected command');
    expect(await teachOrganizationPreview(db, f.ctx, preview.value, command, organizationNow()))
      .toStrictEqual({ ok: false, code: 'conflict' });
    expect(
      (await db.select().from(enrichmentSchemeVersions).where(
        eq(enrichmentSchemeVersions.tenantId, f.ctx.tenantId),
      )).length,
    ).toStrictEqual(1);
  }, { clef: true, difficulty: 'none' });
});

testCase(
  'simultaneous preview corrections commit one candidate and stale unedited sample items roll back all writes',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const preview = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: f.setupId,
        mode: 'preview',
      });
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      await finish(preview.value);
      const view = await workspace.run(f.ctx, preview.value);
      if (!(view.ok)) expect.unreachable('Expected view.ok');
      const sample = view.value.sample[0], other = view.value.sample[1];
      const command = parsePreviewTeachingCommand({
        operationId: crypto.randomUUID(),
        corrections: [{
          questionId: sample.questionId,
          revisionId: sample.revisionId,
          topicId: 'energy',
        }],
      });
      if (!command) expect.unreachable('Expected command');
      await db.update(questions).set({
        lifecycleState: 'archived',
        archivedAt: organizationNow(),
        archivedBy: f.ctx.userId,
      }).where(eq(questions.id, other.questionId));
      expect(await teachOrganizationPreview(db, f.ctx, preview.value, command, organizationNow()))
        .toStrictEqual({ ok: false, code: 'conflict' });
      expect(
        (await db.select().from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(1);
      expect(
        (await db.select().from(organizationSetups).where(
          eq(organizationSetups.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(1);
      expect(
        (await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, command.operationId),
        ))
          .length,
      ).toStrictEqual(0);
      await db.update(questions).set({
        lifecycleState: 'active',
        archivedAt: null,
        archivedBy: null,
      })
        .where(eq(questions.id, other.questionId));
      const results = await Promise.all(
        [command, { ...command, operationId: crypto.randomUUID() }].map((input) =>
          teachOrganizationPreview(db, f.ctx, preview.value, input, organizationNow())
        ),
      );
      expect(results.filter((r) => r.ok).length).toStrictEqual(1);
      expect(results.filter((r) => !r.ok && r.code === 'conflict').length).toStrictEqual(1);
      expect(
        (await db.select().from(organizationSetups).where(
          eq(organizationSetups.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(2);
    }, { clef: true, difficulty: 'none' });
  },
);

testCase(
  'a human classification after preview is protected from teaching based on stale predictions',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const preview = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: f.setupId,
        mode: 'preview',
      });
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      await finish(preview.value);
      const view = await workspace.run(f.ctx, preview.value);
      if (!(view.ok)) expect.unreachable('Expected view.ok');
      const sample = view.value.sample[0];
      const changeId = crypto.randomUUID();
      await db.insert(enrichmentChanges).values({
        id: changeId,
        tenantId: f.ctx.tenantId,
        questionId: sample.questionId,
        revisionId: sample.revisionId,
        schemeId: f.schemeId,
        versionId: f.versionId,
        dimension: 'topic',
        value: { state: 'unassigned', reason: 'outside_scheme' },
        origin: 'human',
        operationId: crypto.randomUUID(),
        createdBy: f.ctx.userId,
        createdAt: organizationNow(),
      });
      await db.insert(enrichmentAssignments).values({
        tenantId: f.ctx.tenantId,
        questionId: sample.questionId,
        schemeId: f.schemeId,
        dimension: 'topic',
        changeId,
      });
      const command = parsePreviewTeachingCommand({
        operationId: crypto.randomUUID(),
        corrections: [{
          questionId: sample.questionId,
          revisionId: sample.revisionId,
          topicId: 'energy',
        }],
      });
      if (!command) expect.unreachable('Expected command');
      expect(await teachOrganizationPreview(db, f.ctx, preview.value, command, organizationNow()))
        .toStrictEqual({ ok: false, code: 'conflict' });
      expect(
        (await db.select().from(enrichmentAssignments).where(
          eq(enrichmentAssignments.questionId, sample.questionId),
        ))[0].changeId,
      ).toStrictEqual(changeId);
    }, { clef: true, difficulty: 'none' });
  },
);

testCase(
  'submitted lessons that exceed the Clef input budget are rejected without dropping corrections',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      for (const questionId of f.ids) {
        const body = {
          type: 'single_select',
          title: 'Long teaching passage',
          itemLanguage: newAuthoringItemLanguage(),
          bodyHtml: '<p>' + 'cell '.repeat(1800) + '</p>',
          promptHtml: '<p>Which structure contains DNA?</p>',
          choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
          correctId: 'a',
          shuffle: false,
        };
        const revision = await prepareQuestionRevision({
          questionId,
          title: body.title,
          body,
          tags: [],
          qtiXml: exportQti3TestItemXml('single_select', body, {
            identifier: 'long-' + questionId,
          }),
          provenance: {
            _tag: 'Revision',
            operation: 'revised',
            expectedParentRevision: 1,
          } as const,
          draftState: 'published' as const,
        });
        await db.transaction((tx) => saveQuestionRevisionInTransaction(tx, f.ctx, revision));
      }
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const preview = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: f.setupId,
        mode: 'preview',
      });
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      await finish(preview.value);
      const view = await workspace.run(f.ctx, preview.value);
      if (!(view.ok)) expect.unreachable('Expected view.ok');
      const command = parsePreviewTeachingCommand({
        operationId: crypto.randomUUID(),
        corrections: view.value.sample.map((sample) => ({
          questionId: sample.questionId,
          revisionId: sample.revisionId,
          topicId: 'energy',
        })),
      });
      if (!command) expect.unreachable('Expected command');
      expect(await teachOrganizationPreview(db, f.ctx, preview.value, command, organizationNow()))
        .toStrictEqual({ ok: false, code: 'input_too_large' });
      expect(
        (await db.select().from(organizationSetups).where(
          eq(organizationSetups.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(1);
      expect(
        (await db.select().from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(1);
    }, { clef: true, difficulty: 'none', count: 2 });
  },
);
