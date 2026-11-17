import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import { organizationRuns } from '../lib/db/question_organization_schema.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { withImportedOrganizationQuestions } from './helpers/imported_organization_questions.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';

testCase(
  'Respondus chapter mapping requires acceptance for each source even with identical filenames',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const fixture = (label: string) => ({
        filename: 'Chapter 3 — Cells.txt',
        mime: 'text/plain',
        adapterId: 'respondus-standard',
        bytes: new TextEncoder().encode([
          `1. ${label}: first question?`,
          '*a. Yes',
          'b. No',
          '',
          `2. ${label}: second question?`,
          '*a. Yes',
          'b. No',
        ].join('\n')),
      });
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      await withImportedOrganizationQuestions(f.ctx, f.originId, async () => {
        const firstHome = await workspace.home(f.ctx);
        if (!(firstHome.ok)) expect.unreachable('Expected firstHome.ok');
        const firstSource = firstHome.value.sources.sections[0];
        const acceptedIds = (await db.select({ id: questions.id }).from(questions).where(
          eq(questions.tenantId, f.ctx.tenantId),
        )).map((q) => q.id).filter((id) => !f.ids.includes(id));
        expect(acceptedIds.length).toStrictEqual(2);
        await withImportedOrganizationQuestions(f.ctx, f.originId, async () => {
          const home = await workspace.home(f.ctx);
          if (!(home.ok)) expect.unreachable('Expected home.ok');
          const sources = home.value.sources.sections;
          expect(sources.length).toStrictEqual(2);
          expect(sources[0].sourceId).not.toStrictEqual(sources[1].sourceId);
          expect(sources.map((s) => [s.title, s.sectionKey, s.count])).toStrictEqual([
            ['Chapter 3 — Cells', 'respondus-file', 2],
            ['Chapter 3 — Cells', 'respondus-file', 2],
          ]);
          const finish = async (id: string) => {
            const [run] = await db.select().from(organizationRuns).where(
              eq(organizationRuns.id, id),
            );
            for (let step = 0; step < 4; step++) {
              const result = await processOrganizationStep({
                jobId: id,
                workflowExecutionId: run.executionId,
              }, {
                database: db,
                now: organizationNow,
                newId: () => crypto.randomUUID(),
                provider: () => {
                  throw new Error('File proposals and accepted mappings must not call AI');
                },
              });
              if (!(result.ok)) expect.unreachable('Expected result.ok');
              if (result.value.state === 'completed') return;
            }
            throw new Error('Organization did not complete within four steps');
          };
          const preview = await workspace.preview(
            f.ctx,
            {
              operationId: crypto.randomUUID(),
              collectionId: f.originId,
              expectedVersion: 1,
              definition: { ...enrichmentDefinitionFixture(), difficulty: [] },
              filing: [{ topicId: 'cells', collectionId: f.destinationId }],
              sourceMappings: [{
                sourceId: firstSource.sourceId,
                sectionKey: firstSource.sectionKey,
                topicId: 'cells',
              }],
            },
            { kind: 'source_only' },
          );
          if (!(preview.ok)) expect.unreachable('Expected preview.ok');
          await finish(preview.value);
          expect(
            (await db.select().from(enrichmentChanges).where(
              eq(enrichmentChanges.tenantId, f.ctx.tenantId),
            )).length,
          ).toStrictEqual(0);
          const sample = await workspace.run(f.ctx, preview.value);
          if (!(sample.ok)) expect.unreachable('Expected sample.ok');
          expect(sample.value.sample.filter((q) => q.topic === 'Cells').length).toStrictEqual(2);
          const apply = await workspace.queue(f.ctx, {
            id: crypto.randomUUID(),
            setupId: sample.value.setupId,
            mode: 'apply',
          });
          if (!(apply.ok)) expect.unreachable('Expected apply.ok');
          await finish(apply.value);
          const changes = await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, apply.value),
          );
          expect(changes.length).toStrictEqual(4);
          if (
            !(changes.every((c) => c.origin === 'source' && acceptedIds.includes(c.questionId)))
          ) {
            expect.unreachable(
              "Expected changes.every((c) => c.origin === 'source' && acceptedIds.includes(c.questionId))",
            );
          }
          const members = await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, f.destinationId),
          );
          expect(members.length).toStrictEqual(2);
          if (!(members.every((m) => acceptedIds.includes(m.questionId)))) {
            expect.unreachable('Expected members.every((m) => acceptedIds.includes(m.questionId))');
          }
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
        }, fixture('Unaccepted upload'));
      }, fixture('Accepted upload'));
    }, { count: 1, activation: 'disabled', clef: true, difficulty: 'none' });
  },
);
