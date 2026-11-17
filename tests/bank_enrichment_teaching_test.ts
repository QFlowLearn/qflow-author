import { expect, test as testCase } from 'vitest';

import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { processEnrichmentStep } from '../lib/services/bank_enrichment_processor.ts';

import { desc, eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentSchemeVersions } from '../lib/db/bank_enrichment_schema.ts';
import {
  organizationActivation,
  organizationRuns,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { parseEnrichmentDefinition } from '../lib/services/bank_enrichment_contract.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { registerOrganizationIntake } from '../lib/services/question_organization_intake.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { addEnrichmentQuestions } from './helpers/enrichment_workspace.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import {
  correctQuestions,
  currentQuestion,
  finishMutation,
  mutationJobs,
  mutations,
  mutationWorker,
} from './helpers/enrichment_mutation_fixture.ts';
import { enrichmentRuns } from '../lib/db/bank_enrichment_job_schema.ts';

const correction = (topic: 'cells' | 'energy') => ({
  subject: { state: 'assigned' as const, valueIds: [topic === 'cells' ? 'life' : 'physical'] },
  topic: { state: 'assigned' as const, valueIds: [topic] },
  difficulty: null,
});
async function latest(schemeId: string) {
  const [row] = await db.select().from(enrichmentSchemeVersions).where(
    eq(enrichmentSchemeVersions.schemeId, schemeId),
  ).orderBy(desc(enrichmentSchemeVersions.version)).limit(1);
  const definition = parseEnrichmentDefinition(row.definition);
  if (!definition) expect.unreachable('Expected definition');
  return { ...row, definition };
}

testCase(
  'group corrections teach bounded topics to future intake, preserve queued runs, and remove undone examples',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const id = await correctQuestions(f.ctx, f.versionId, f.ids, correction('cells'));
        const learned = await latest(f.schemeId);
        expect(learned.version).toStrictEqual(2);
        const staleEdit = await new BankEnrichmentStore(db, organizationNow).saveVersion(f.ctx, {
          id: crypto.randomUUID(),
          schemeId: f.schemeId,
          expectedVersion: 1,
          definition: learned.definition,
        });
        expect(staleEdit).toStrictEqual({ ok: false, code: 'version_conflict' });
        if (!(learned.definition.examples.length > 0 && learned.definition.examples.length <= 20)) {
          expect.unreachable(
            'Expected learned.definition.examples.length > 0 && learned.definition.examples.length <= 20',
          );
        }
        if (!(learned.definition.examples.every((e) => e.classification.difficulty === null))) {
          expect.unreachable(
            'Expected learned.definition.examples.every((e) => e.classification.difficulty === null)',
          );
        }
        const status = await new BankEnrichmentJobRead(db, organizationNow).get(f.ctx, id);
        if (!(status.ok && status.value.kind === 'correct')) {
          expect.unreachable("Expected status.ok && status.value.kind === 'correct'");
        }
        expect(status.value.teachingExampleCount).toStrictEqual(learned.definition.examples.length);
        const [active] = await db.select().from(organizationActivation).where(
          eq(organizationActivation.collectionId, f.originId),
        );
        if (!(active.setupId && active.setupId !== f.setupId)) {
          expect.unreachable('Expected active.setupId && active.setupId !== f.setupId');
        }
        const [setup] = await db.select().from(organizationSetups).where(
          eq(organizationSetups.id, active.setupId),
        );
        expect(setup.versionId).toStrictEqual(learned.id);
        expect((await db.select().from(organizationRuns).where(
          eq(organizationRuns.tenantId, f.ctx.tenantId),
        )).map((r) => r.setupId)).toStrictEqual([f.setupId]);
        // Re-delivery cannot create another vocabulary or policy version.
        const [operation] = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id));
        if (!(operation.workflowExecutionId)) {
          expect.unreachable('Expected operation.workflowExecutionId');
        }
        await finishMutation(id, operation.workflowExecutionId);
        expect((await latest(f.schemeId)).id).toStrictEqual(learned.id);
        const [fresh] = await addEnrichmentQuestions(f.ctx, 1);
        await db.transaction((tx) =>
          registerOrganizationIntake(
            tx,
            f.ctx,
            f.originId,
            [{ questionId: fresh, source: null }],
            organizationNow(),
          )
        );
        const runs = await db.select().from(organizationRuns).where(
          eq(organizationRuns.setupId, setup.id),
        );
        expect(runs.length).toStrictEqual(1);
        let calls = 0;
        const processed = await processOrganizationStep({
          jobId: runs[0].id,
          workflowExecutionId: runs[0].executionId,
        }, {
          database: db,
          now: organizationNow,
          newId: () => crypto.randomUUID(),
          provider: () =>
            fixtureClefProvider((question, _definition, examples) => {
              calls++;
              expect(question.questionId).toStrictEqual(fresh);
              expect(examples.length).toStrictEqual(learned.definition.examples.length);
              if (!(examples.every((e) => e.topicId === 'cells'))) {
                expect.unreachable("Expected examples.every((e) => e.topicId === 'cells')");
              }
              return Promise.resolve({
                ok: true,
                value: {
                  topicId: 'cells',
                  confidence: 1,
                  probabilities: { cells: 1, energy: 0, __no_match__: 0 },
                  model: 'clef',
                  inputTokens: 500,
                  outputTokens: 0,
                },
              });
            }),
        });
        if (!(processed.ok)) expect.unreachable('Expected processed.ok');
        expect(calls).toStrictEqual(1);
        expect((await currentQuestion(f.ctx, f.schemeId, fresh)).topic?.value).toStrictEqual(
          correction('cells').topic,
        );
        const later = await correctQuestions(f.ctx, learned.id, [
          learned.definition.examples[0].questionId,
        ], correction('energy'));
        const undo = crypto.randomUUID(), execution = crypto.randomUUID();
        if (!((await mutations.undo(f.ctx, undo, id)).ok)) {
          expect.unreachable('Expected (await mutations.undo(f.ctx, undo, id)).ok');
        }
        if (!((await mutationJobs.queueMutation(f.ctx, undo, execution)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueMutation(f.ctx, undo, execution)).ok',
          );
        }
        await finishMutation(undo, execution);
        const after = await latest(f.schemeId);
        expect(after.definition.examples.length).toStrictEqual(1);
        expect(after.definition.examples[0].classification.topic).toStrictEqual(
          correction('energy').topic,
        );
        expect(
          (await currentQuestion(f.ctx, f.schemeId, after.definition.examples[0].questionId)).topic
            ?.operationId,
        ).toStrictEqual(later);
      }, { count: 25, difficulty: 'none', clef: true });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'teaching preserves disabled activation and stops at a concurrent vocabulary edit',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        await correctQuestions(f.ctx, f.versionId, f.ids, correction('cells'));
        const learned = await latest(f.schemeId);
        expect(learned.definition.examples.length).toStrictEqual(2);
        expect(
          await db.select().from(organizationActivation).where(
            eq(organizationActivation.collectionId, f.originId),
          ),
        ).toStrictEqual([]);
        const edited = await new BankEnrichmentStore(db, organizationNow).saveVersion(f.ctx, {
          id: crypto.randomUUID(),
          schemeId: f.schemeId,
          expectedVersion: learned.version,
          definition: { ...learned.definition, audience: 'A different audience' },
        });
        if (!(edited.ok)) expect.unreachable('Expected edited.ok');
        await correctQuestions(f.ctx, f.versionId, f.ids, correction('energy'));
        expect((await latest(f.schemeId)).id).toStrictEqual(edited.value.id);
        expect((await currentQuestion(f.ctx, f.schemeId, f.ids[0])).topic?.value).toStrictEqual(
          correction('energy').topic,
        );
      }, { count: 2, activation: 'disabled', clef: true });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'teaching completion and policy advancement roll back together and retry once',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const snapshotId = crypto.randomUUID(),
          id = crypto.randomUUID(),
          execution = crypto.randomUUID();
        if (
          !((await new BankEnrichmentScopes(db, organizationNow).capture(f.ctx, snapshotId, {
            _tag: 'Selected',
            questionIds: f.ids,
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await new BankEnrichmentScopes(db, organizationNow).capture(f.ctx, snapshotId, { _tag: 'S",
          );
        }
        if (
          !((await mutations.correct(f.ctx, id, {
            snapshotId,
            versionId: f.versionId,
            values: correction('cells'),
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await mutations.correct(f.ctx, id, { snapshotId, versionId: f.versionId, values: correcti',
          );
        }
        if (!((await mutationJobs.queueMutation(f.ctx, id, execution)).ok)) {
          expect.unreachable(
            'Expected (await mutationJobs.queueMutation(f.ctx, id, execution)).ok',
          );
        }
        const first = await processEnrichmentStep(
          { jobId: id, workflowExecutionId: execution },
          mutationWorker,
        );
        if (!(first.ok && first.value.state === 'more')) {
          expect.unreachable("Expected first.ok && first.value.state === 'more'");
        }
        await db.execute(
          sql`CREATE FUNCTION qflow_test_fail_teaching() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''teaching failure fixture''; END'`,
        );
        try {
          await db.execute(
            sql`CREATE TRIGGER qflow_test_fail_teaching BEFORE INSERT ON question_organization_setups FOR EACH ROW EXECUTE FUNCTION qflow_test_fail_teaching()`,
          );
          const failed = await processEnrichmentStep(
            { jobId: id, workflowExecutionId: execution },
            mutationWorker,
          );
          expect(failed).toStrictEqual({ ok: false, code: 'storage_failed' });
          expect((await latest(f.schemeId)).id).toStrictEqual(f.versionId);
          const [active] = await db.select().from(organizationActivation).where(
            eq(organizationActivation.collectionId, f.originId),
          );
          expect(active.setupId).toStrictEqual(f.setupId);
        } finally {
          await db.execute(
            sql`DROP TRIGGER IF EXISTS qflow_test_fail_teaching ON question_organization_setups`,
          );
          await db.execute(sql`DROP FUNCTION qflow_test_fail_teaching()`);
        }
        await finishMutation(id, execution);
        expect((await latest(f.schemeId)).version).toStrictEqual(2);
        await finishMutation(id, execution);
        expect((await latest(f.schemeId)).version).toStrictEqual(2);
      }, { count: 1, clef: true });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'new correction samples stay bounded and a clear removes its prior teaching example',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        await correctQuestions(f.ctx, f.versionId, f.ids.slice(0, 20), correction('cells'));
        await correctQuestions(f.ctx, f.versionId, f.ids.slice(20), correction('energy'));
        const learned = await latest(f.schemeId);
        if (!(learned.definition.examples.length > 0 && learned.definition.examples.length <= 20)) {
          expect.unreachable(
            'Expected learned.definition.examples.length > 0 && learned.definition.examples.length <= 20',
          );
        }
        const exampleToClear = learned.definition.examples[0].questionId;
        if (!(f.ids.slice(20).includes(exampleToClear))) {
          expect.unreachable('Expected f.ids.slice(20).includes(exampleToClear)');
        }
        await correctQuestions(f.ctx, learned.id, [exampleToClear], {
          subject: null,
          topic: { state: 'unassigned', reason: 'outside_scheme' },
          difficulty: null,
        });
        const after = await latest(f.schemeId);
        expect(after.definition.examples.length).toStrictEqual(
          learned.definition.examples.length - 1,
        );
        if (after.definition.examples.some((e) => e.questionId === exampleToClear)) {
          expect.unreachable(
            'Expected !after.definition.examples.some((e) => e.questionId === exampleToClear)',
          );
        }
        expect((await currentQuestion(f.ctx, f.schemeId, exampleToClear)).topic?.origin)
          .toStrictEqual('human');
      }, { count: 41, activation: 'disabled', clef: true });
    } finally {
      await shutdownDb();
    }
  },
);
