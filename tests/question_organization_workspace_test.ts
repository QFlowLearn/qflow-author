import { expect, test as testCase } from 'vitest';

import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { withImportedOrganizationQuestions } from './helpers/imported_organization_questions.ts';

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import {
  organizationActivation,
  organizationRuns,
} from '../lib/db/question_organization_schema.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import {
  organizationConfig,
  organizationNow,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';

testCase(
  'topic-only screen flow previews without writes, reuses decisions to file, survives replay and undoes',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const home = await workspace.home(f.ctx);
      if (!(home.ok)) expect.unreachable('Expected home.ok');
      expect(home.value.activation).toStrictEqual([]);
      const operationId = crypto.randomUUID();
      const command = {
        operationId,
        collectionId: f.originId,
        expectedVersion: 1,
        definition: { ...enrichmentDefinitionFixture(), difficulty: [] },
        filing: [{ topicId: 'cells', collectionId: f.destinationId }],
        sourceMappings: [],
      };
      const preview = await workspace.preview(f.ctx, command, {
        kind: 'clef',
        config: organizationConfig,
      });
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      expect(await workspace.preview(f.ctx, command, { kind: 'clef', config: organizationConfig }))
        .toStrictEqual(preview);
      expect(
        await workspace.preview(f.ctx, {
          ...command,
          definition: { ...command.definition, name: 'Different' },
        }, { kind: 'clef', config: organizationConfig }),
      ).toStrictEqual({ ok: false, code: 'conflict' });
      let calls = 0;
      const finish = async (id: string) => {
        const [run] = await db.select().from(organizationRuns).where(eq(organizationRuns.id, id));
        return await processOrganizationStep({ jobId: id, workflowExecutionId: run.executionId }, {
          database: db,
          now: organizationNow,
          newId: () => crypto.randomUUID(),
          provider: () =>
            fixtureClefProvider(() => {
              calls++;
              return Promise.resolve({
                ok: true,
                value: {
                  topicId: 'cells',
                  confidence: 0.99,
                  probabilities: { cells: 0.99, energy: 0.01, __no_match__: 0 },
                  model: 'clef',
                  inputTokens: 700,
                  outputTokens: 41,
                },
              });
            }),
        });
      };
      if (!((await finish(preview.value)).ok)) {
        expect.unreachable('Expected (await finish(preview.value)).ok');
      }
      expect(calls).toStrictEqual(3);
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
      expect(
        (await db.select().from(organizationActivation).where(
          eq(organizationActivation.collectionId, f.originId),
        )).length,
      ).toStrictEqual(0);
      const sample = await workspace.run(f.ctx, preview.value);
      if (!(sample.ok)) expect.unreachable('Expected sample.ok');
      expect(sample.value.sample.length).toStrictEqual(3);
      expect(sample.value.counts).toStrictEqual([{ state: 'previewed', count: 3 }]);
      expect(sample.value.definition.difficulty).toStrictEqual([]);
      const commandApply = {
        id: crypto.randomUUID(),
        setupId: sample.value.setupId,
        mode: 'apply' as const,
      };
      const apply = await workspace.queue(f.ctx, commandApply);
      if (!(apply.ok)) expect.unreachable('Expected apply.ok');
      expect(await workspace.queue(f.ctx, commandApply)).toStrictEqual(apply);
      if (!((await finish(apply.value)).ok)) {
        expect.unreachable('Expected (await finish(apply.value)).ok');
      }
      expect(calls, 'Applying a current preview must not repeat inference').toStrictEqual(3);
      expect(
        (await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.collectionId, f.destinationId),
        )).length,
      ).toStrictEqual(3);
      if (
        !((await completeOrganizationUndoForTest(db, f.ctx, apply.value, organizationNow())).ok)
      ) {
        expect.unreachable(
          'Expected (await completeOrganizationUndoForTest(db, f.ctx, apply.value, organizationNow())).ok',
        );
      }
      expect(
        (await db.select().from(bankCollectionItems).where(
          eq(bankCollectionItems.collectionId, f.destinationId),
        )).length,
      ).toStrictEqual(0);
    }, { activation: 'disabled', clef: true, difficulty: 'none' });
  },
);

testCase(
  'imported source structure maps through preview and apply without AI; unmapped questions stay unchanged',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      await withImportedOrganizationQuestions(f.ctx, f.originId, async () => {
        const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
        const home = await workspace.home(f.ctx);
        if (!(home.ok)) expect.unreachable('Expected home.ok');
        expect(home.value.sources.limited).toStrictEqual(false);
        expect(home.value.sources.sections.length).toStrictEqual(1);
        const section = home.value.sources.sections[0];
        expect(section.count).toStrictEqual(2);
        expect(section.collectionId).toStrictEqual(f.originId);
        expect(section.filename).toStrictEqual('word-visible-numbering.docx');
        expect(section.title).toStrictEqual('word-visible-numbering');
        const foreign = await workspace.home({ ...f.ctx, tenantId: crypto.randomUUID() });
        expect(foreign).toStrictEqual({ ok: false, code: 'forbidden' });
        const preview = await workspace.preview(f.ctx, {
          operationId: crypto.randomUUID(),
          collectionId: f.originId,
          expectedVersion: 1,
          definition: { ...enrichmentDefinitionFixture(), difficulty: [] },
          filing: [{ topicId: 'cells', collectionId: f.destinationId }],
          sourceMappings: [{
            sourceId: section.sourceId,
            sectionKey: section.sectionKey,
            topicId: 'cells',
          }],
        }, { kind: 'source_only' });
        if (!(preview.ok)) expect.unreachable('Expected preview.ok');
        const finish = async (id: string) => {
          const [run] = await db.select().from(organizationRuns).where(eq(organizationRuns.id, id));
          const result = await processOrganizationStep({
            jobId: id,
            workflowExecutionId: run.executionId,
          }, {
            database: db,
            now: organizationNow,
            newId: () => crypto.randomUUID(),
            provider: () => {
              throw new Error('Accepted mappings and unmapped questions must not call AI');
            },
          });
          if (!(result.ok && result.value.state === 'completed')) {
            expect.unreachable("Expected result.ok && result.value.state === 'completed'");
          }
        };
        await finish(preview.value);
        expect(
          (await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.tenantId, f.ctx.tenantId),
          )).length,
        ).toStrictEqual(0);
        const previewState = await workspace.run(f.ctx, preview.value);
        if (!(previewState.ok)) expect.unreachable('Expected previewState.ok');
        expect(previewState.value.sample.filter((q) => q.topic === 'Cells').length).toStrictEqual(
          2,
        );
        const apply = await workspace.queue(f.ctx, {
          id: crypto.randomUUID(),
          setupId: previewState.value.setupId,
          mode: 'apply',
        });
        if (!(apply.ok)) expect.unreachable('Expected apply.ok');
        await finish(apply.value);
        const changes = await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.operationId, apply.value),
        );
        expect(changes.length).toStrictEqual(4);
        if (!(changes.every((c) => c.origin === 'source' && !f.ids.includes(c.questionId)))) {
          expect.unreachable(
            "Expected changes.every((c) => c.origin === 'source' && !f.ids.includes(c.questionId))",
          );
        }
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          )).length,
        ).toStrictEqual(2);
        if (
          !((await completeOrganizationUndoForTest(db, f.ctx, apply.value, organizationNow())).ok)
        ) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, apply.value, organizationNow())).ok',
          );
        }
      });
    }, { count: 1, activation: 'disabled', clef: true, difficulty: 'none' });
  },
);

for (const format of ['moodle', 'qti', 'qti_ambiguous', 'blackboard', 'imscc'] as const) {
  testCase(
    `${format} groups organize imported questions without model inference or ambiguous assignments`,
    async () => {
      await withOrganizationWorkspace(async (f) => {
        await withImportedOrganizationQuestions(f.ctx, f.originId, async (imported) => {
          const readLabels = () =>
            db.select({ id: questions.id, tags: questions.tags, body: questionRevisions.body })
              .from(questions).innerJoin(
                questionRevisions,
                eq(questionRevisions.id, questions.latestRevisionId),
              )
              .where(eq(questions.tenantId, f.ctx.tenantId)).orderBy(questions.id);
          const labelsBefore = await readLabels();
          const ambiguous = format === 'qti_ambiguous';
          const expectedCount = ambiguous ? 1 : 2;
          if (format === 'qti' || format === 'qti_ambiguous') {
            expect(imported.parts.length).toStrictEqual(1);
            expect(imported.parts[0]).toMatchObject({
              options: {
                timeLimits: { maxTime: 900 },
                navigationMode: 'nonlinear',
                submissionMode: 'individual',
              },
            });
            expect(imported.organizationGroups.map((g) => g.title)).toStrictEqual([
              'Biology / Cells',
              'Physics / Energy',
            ]);
          }
          const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
          const home = await workspace.home(f.ctx);
          if (!(home.ok)) expect.unreachable('Expected home.ok');
          const sections = home.value.sources.sections;
          expect(sections.map((s) => s.title.replaceAll(' / ', '/')).sort()).toStrictEqual(
            ambiguous ? ['Physics/Energy'] : ['Biology/Cells', 'Physics/Energy'],
          );
          if (!(sections.every((s) => s.count === 1))) {
            expect.unreachable('Expected sections.every((s) => s.count === 1)');
          }
          const preview = await workspace.preview(f.ctx, {
            operationId: crypto.randomUUID(),
            collectionId: f.originId,
            expectedVersion: 1,
            definition: { ...enrichmentDefinitionFixture(), difficulty: [] },
            filing: [{ topicId: 'cells', collectionId: f.destinationId }, {
              topicId: 'energy',
              collectionId: f.destinationId,
            }],
            sourceMappings: sections.map((s) => ({
              sourceId: s.sourceId,
              sectionKey: s.sectionKey,
              topicId: s.title.replaceAll(' / ', '/') === 'Biology/Cells' ? 'cells' : 'energy',
            })),
          }, { kind: 'source_only' });
          if (!(preview.ok)) expect.unreachable('Expected preview.ok');
          const finish = async (id: string) => {
            const [run] = await db.select().from(organizationRuns).where(
              eq(organizationRuns.id, id),
            );
            const result = await processOrganizationStep({
              jobId: id,
              workflowExecutionId: run.executionId,
            }, {
              database: db,
              now: organizationNow,
              newId: () => crypto.randomUUID(),
              provider: () => {
                throw new Error('Source categories must not invoke AI, including for essays');
              },
            });
            if (!(result.ok && result.value.state === 'completed')) {
              expect.unreachable("Expected result.ok && result.value.state === 'completed'");
            }
          };
          await finish(preview.value);
          const review = await workspace.run(f.ctx, preview.value);
          if (!(review.ok)) expect.unreachable('Expected review.ok');
          expect(review.value.sample.filter((q) => q.topic).map((q) => [q.title, q.topic]).sort())
            .toStrictEqual(
              ambiguous
                ? [['Energy explanation', 'Energy']]
                : format === 'imscc'
                ? [['Shared question', 'Cells'], ['Shared question', 'Energy']]
                : [['Cell nucleus', 'Cells'], ['Energy explanation', 'Energy']],
            );
          expect(
            (await db.select().from(enrichmentChanges).where(
              eq(enrichmentChanges.tenantId, f.ctx.tenantId),
            )).length,
          ).toStrictEqual(0);
          const apply = await workspace.queue(f.ctx, {
            id: crypto.randomUUID(),
            setupId: review.value.setupId,
            mode: 'apply',
          });
          if (!(apply.ok)) expect.unreachable('Expected apply.ok');
          await finish(apply.value);
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            )).length,
          ).toStrictEqual(expectedCount);
          const changes = await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, apply.value),
          );
          expect(changes.length).toStrictEqual(expectedCount * 2);
          if (!(changes.every((change) => change.origin === 'source'))) {
            expect.unreachable("Expected changes.every((change) => change.origin === 'source')");
          }
          expect(await readLabels()).toStrictEqual(labelsBefore);
          if (
            !((await completeOrganizationUndoForTest(db, f.ctx, apply.value, organizationNow())).ok)
          ) {
            expect.unreachable(
              'Expected (await completeOrganizationUndoForTest(db, f.ctx, apply.value, organizationNow())).ok',
            );
          }
          expect(await readLabels()).toStrictEqual(labelsBefore);
        }, format);
      }, { count: 1, activation: 'disabled', clef: true, difficulty: 'none' });
    },
  );
}
