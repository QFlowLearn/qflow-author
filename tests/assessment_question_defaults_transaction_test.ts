import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessments, organizationMemberships, questionRevisions } from '../lib/db/schema.ts';
import { assessmentAdaptivePlans } from '../lib/db/assessment_schema.ts';
import { assessmentQuestionDefaults } from '../lib/db/assessment_question_defaults_schema.ts';
import {
  readAssessmentQuestionPointDefault,
  saveAssessmentQuestionPointDefault,
} from '../lib/services/assessment_question_defaults.ts';
import { duplicateAssessment, getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';
import { adaptivePlanDocument } from '../lib/assessment_adaptive_plan.ts';

testCase(
  'shared assessment point defaults persist zero/fractions, reject stale saves and leave saved question scoring intact',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await withEnrichmentWorkspace(async (other) => {
          const assessment = await createAssessmentDraft(ctx, {
            title: 'Shared new-question points',
          });
          try {
            expect(await readAssessmentQuestionPointDefault(ctx, assessment.id)).toStrictEqual({
              _tag: 'Found',
              value: null,
            });
            expect(await readAssessmentQuestionPointDefault(other, assessment.id)).toStrictEqual({
              _tag: 'NotFound',
            });
            expect(
              await saveAssessmentQuestionPointDefault(other, assessment.id, {
                expected: null,
                desired: 2,
              }),
            ).toStrictEqual({ _tag: 'Rejected', code: 'assessment_not_found' });
            const initial = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(initial);
            const saved = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type: 'single_select',
                title: 'Existing five-point question',
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Select Paris.</p>',
                choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                correctId: 'A',
                maximumScore: 5,
              },
            });
            if (!(saved.ok)) expect.unreachable('Expected saved.ok');
            const before = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(before);
            const revisions = await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, ctx.tenantId),
            );
            for (const [expected, desired] of [[null, 0], [0, 3.125]] as const) {
              expect(
                await saveAssessmentQuestionPointDefault(ctx, assessment.id, {
                  expected,
                  desired,
                }),
              ).toStrictEqual({ _tag: 'Saved', value: desired });
              expect(await readAssessmentQuestionPointDefault(ctx, assessment.id)).toStrictEqual({
                _tag: 'Found',
                value: desired,
              });
              const [stamp] = await db.select({ updatedAt: assessments.updatedAt }).from(
                assessments,
              )
                .where(eq(assessments.id, assessment.id));
              expect(
                await saveAssessmentQuestionPointDefault(ctx, assessment.id, {
                  expected,
                  desired,
                }),
              ).toStrictEqual({ _tag: 'Saved', value: desired });
              expect(
                await db.select({ updatedAt: assessments.updatedAt }).from(assessments)
                  .where(eq(assessments.id, assessment.id)),
              ).toStrictEqual([stamp]);
            }
            expect(
              await saveAssessmentQuestionPointDefault(ctx, assessment.id, {
                expected: 0,
                desired: 2,
              }),
            ).toStrictEqual({ _tag: 'Rejected', code: 'stale_default' });
            for (const maximumScore of [-1, Infinity, NaN]) {
              await expect(
                Promise.resolve().then(() =>
                  db.update(assessmentQuestionDefaults).set({ maximumScore })
                    .where(eq(assessmentQuestionDefaults.assessmentId, assessment.id))
                ),
              ).rejects.toBeInstanceOf(Error);
              expect(await readAssessmentQuestionPointDefault(ctx, assessment.id)).toStrictEqual({
                _tag: 'Found',
                value: 3.125,
              });
            }
            expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(before.parts);
            expect(
              await db.select().from(questionRevisions).where(
                eq(questionRevisions.tenantId, ctx.tenantId),
              ),
            ).toStrictEqual(revisions);
            const copied = await duplicateAssessment(ctx, assessment.id);
            if (!(copied._tag === 'Duplicated')) {
              expect.unreachable("Expected copied._tag === 'Duplicated'");
            }
            try {
              expect(await readAssessmentQuestionPointDefault(ctx, copied.id)).toStrictEqual({
                _tag: 'Found',
                value: 3.125,
              });
              const copy = await getAssessment(ctx, copied.id);
              assertQuestionOnlyAssessmentFixture(copy);
              expect(copy.parts[0].placements.map((p) => [p.itemId, p.snapshotRev])).toStrictEqual(
                before.parts[0].placements.map((p) => [p.itemId, p.snapshotRev]),
              );
              if (!(copy.parts[0].id !== before.parts[0].id)) {
                expect.unreachable('Expected copy.parts[0].id !== before.parts[0].id');
              }
              if (!(copy.parts[0].placements[0].id !== before.parts[0].placements[0].id)) {
                expect.unreachable(
                  'Expected copy.parts[0].placements[0].id !== before.parts[0].placements[0].id',
                );
              }
            } finally {
              await deleteAssessment(ctx, copied.id);
            }
            expect(
              await saveAssessmentQuestionPointDefault(ctx, assessment.id, {
                expected: 3.125,
                desired: null,
              }),
            ).toStrictEqual({ _tag: 'Saved', value: null });
            expect(
              await db.select().from(assessmentQuestionDefaults).where(
                eq(assessmentQuestionDefaults.assessmentId, assessment.id),
              ),
            ).toStrictEqual([]);
            const resetCopy = await duplicateAssessment(ctx, assessment.id);
            if (!(resetCopy._tag === 'Duplicated')) {
              expect.unreachable("Expected resetCopy._tag === 'Duplicated'");
            }
            try {
              expect(await readAssessmentQuestionPointDefault(ctx, resetCopy.id)).toStrictEqual({
                _tag: 'Found',
                value: null,
              });
            } finally {
              await deleteAssessment(ctx, resetCopy.id);
            }
          } finally {
            await deleteAssessment(ctx, assessment.id);
          }
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'assessment default writers serialize, check revoked authority before retry and refuse adaptive scope',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx);
        try {
          const commands = [{ expected: null, desired: 2 }, { expected: null, desired: 3.125 }];
          const results = await Promise.all(
            commands.map((command) =>
              saveAssessmentQuestionPointDefault(ctx, assessment.id, command)
            ),
          );
          expect(results.filter((result) => result._tag === 'Saved').length).toStrictEqual(1);
          expect(
            results.filter((result) =>
              result._tag === 'Rejected' && result.code === 'stale_default'
            )
              .length,
          ).toStrictEqual(1);
          const winner = results.find((result) => result._tag === 'Saved');
          if (!(winner && winner._tag === 'Saved')) {
            expect.unreachable("Expected winner && winner._tag === 'Saved'");
          }
          expect(await readAssessmentQuestionPointDefault(ctx, assessment.id)).toStrictEqual({
            _tag: 'Found',
            value: winner.value,
          });
          await db.insert(assessmentAdaptivePlans).values({
            assessmentId: assessment.id,
            document: adaptivePlanDocument(adaptiveExportFixture().plan),
          });
          expect(
            await saveAssessmentQuestionPointDefault(ctx, assessment.id, {
              expected: winner.value,
              desired: 0,
            }),
          ).toStrictEqual({ _tag: 'Rejected', code: 'adaptive_managed' });
          expect(await duplicateAssessment(ctx, assessment.id)).toStrictEqual({
            _tag: 'Rejected',
            code: 'adaptive_managed',
          });
          await db.delete(assessmentAdaptivePlans).where(
            eq(assessmentAdaptivePlans.assessmentId, assessment.id),
          );
          await db.delete(organizationMemberships).where(and(
            eq(organizationMemberships.tenantId, ctx.tenantId),
            eq(organizationMemberships.userId, ctx.userId),
          ));
          expect(
            await saveAssessmentQuestionPointDefault(ctx, assessment.id, {
              expected: null,
              desired: winner.value,
            }),
          ).toStrictEqual({ _tag: 'Rejected', code: 'forbidden' });
          expect(await readAssessmentQuestionPointDefault(ctx, assessment.id)).toStrictEqual({
            _tag: 'Found',
            value: winner.value,
          });
          const beforeDuplication = await db.select({ id: assessments.id }).from(assessments).where(
            eq(assessments.tenantId, ctx.tenantId),
          );
          expect(await duplicateAssessment(ctx, assessment.id)).toStrictEqual({
            _tag: 'Rejected',
            code: 'forbidden',
          });
          expect(
            await db.select({ id: assessments.id }).from(assessments).where(
              eq(assessments.tenantId, ctx.tenantId),
            ),
          ).toStrictEqual(beforeDuplication);
        } finally {
          // Fixture cleanup owns this record after membership revocation.
          await db.delete(assessments).where(eq(assessments.id, assessment.id));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
