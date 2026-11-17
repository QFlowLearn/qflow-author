import { expect, test as testCase } from 'vitest';

import { assessments } from '../lib/db/assessment_schema.ts';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { and, eq } from 'drizzle-orm';
import { parseQtiFixedTestOrdering, prepareQtiFixedTestOrder } from '@longsightgroup/qti3-core';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentParts, organizationMemberships, questionRevisions } from '../lib/db/schema.ts';
import { assessmentAdaptivePlans } from '../lib/db/assessment_schema.ts';
import { adaptivePlanDocument } from '../lib/assessment_adaptive_plan.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import { duplicateAssessment, getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import {
  buildValidatedQti3Assessment,
  toAssessmentExportSelectionDocument,
} from '../lib/export/assessment.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assessmentArrangementCommandFixture } from './helpers/assessment_arrangement.ts';
import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';

testCase(
  'saved question shuffling retains placement/revision identity, retries exactly and reaches canonical export',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await withEnrichmentWorkspace(async (other) => {
          const assessment = await createAssessmentDraft(ctx, { title: 'Part question order' });
          let copyId: string | undefined;
          try {
            const initial = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(initial);
            for (const title of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
              if (
                !((await saveAssessmentQuestion(ctx, assessment.id, {
                  _tag: 'Create',
                  partId: initial.parts[0].id,
                  draft: {
                    type: 'single_select',
                    title,
                    itemLanguage: newAuthoringItemLanguage(),
                    bodyHtml: `<p>${title}: choose Paris.</p>`,
                    choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                    correctId: 'A',
                    maximumScore: 3.125,
                  },
                })).ok)
              ) {
                expect.unreachable(
                  "Expected (await saveAssessmentQuestion(ctx, assessment.id, { _tag: 'Create', partId: initial.parts[",
                );
              }
            }
            const authored = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(authored);
            const part = authored.parts[0];
            const setup = await assessmentArrangementCommandFixture(ctx, assessment.id, [
              {
                ...part,
                placements: part.placements.slice(0, 3),
                options: { instructionsHtml: '<p>Keep instructions.</p>' },
              },
              {
                id: crypto.randomUUID(),
                title: 'Second part',
                placements: part.placements.slice(3),
                options: { timeLimits: { maxTime: 300 } },
              },
            ]);
            if (!((await saveAssessmentParts(ctx, assessment.id, setup)).ok)) {
              expect.unreachable(
                'Expected (await saveAssessmentParts(ctx, assessment.id, setup)).ok',
              );
            }
            const before = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(before);
            const revisions = await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, ctx.tenantId),
            ).orderBy(questionRevisions.id);
            const command = await assessmentArrangementCommandFixture(
              ctx,
              assessment.id,
              before.parts.map((p, index) => ({
                ...p,
                options: { ...p.options, shuffleQuestions: index === 0 },
              })),
            );
            const foreign = await saveAssessmentParts(other, assessment.id, command);
            if (foreign.ok) expect.unreachable('Expected !foreign.ok');
            expect(foreign.error.code).toStrictEqual('assessment_not_found');
            const result = await saveAssessmentParts(ctx, assessment.id, command);
            if (!(result.ok)) expect.unreachable('Expected result.ok');
            const saved = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(saved);
            expect(saved.parts.map((p) => p.placements)).toStrictEqual(
              before.parts.map((p) => p.placements),
            );
            expect(saved.parts.map((p) => p.options)).toStrictEqual(
              before.parts.map((p, index) => ({
                ...p.options,
                shuffleQuestions: index === 0,
              })),
            );
            expect(saved.targetCount).toStrictEqual(6);
            expect(
              await db.select().from(questionRevisions).where(
                eq(questionRevisions.tenantId, ctx.tenantId),
              ).orderBy(questionRevisions.id),
            ).toStrictEqual(revisions);
            if (!((await saveAssessmentParts(ctx, assessment.id, command)).ok)) {
              expect.unreachable(
                'Expected (await saveAssessmentParts(ctx, assessment.id, command)).ok',
              );
            }
            expect(await getAssessment(ctx, assessment.id)).toStrictEqual(saved);

            const exported = await loadAssessmentItemExports(
              db,
              ctx,
              toAssessmentExportSelectionDocument(saved),
            );
            const built = await buildValidatedQti3Assessment(exported.document);
            if (!(built.validation.ok)) expect.unreachable(JSON.stringify(built.validation));
            const parsed = parseQtiFixedTestOrdering(built.xml);
            if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
            expect(parsed.value.sections.map((s) => s.shuffle)).toStrictEqual([true, false]);
            const order = prepareQtiFixedTestOrder(parsed.value, {
              kind: 'new',
              seed: 'QA attempt',
            });
            if (!(order.ok)) expect.unreachable('Expected order.ok');
            const restored = prepareQtiFixedTestOrder(parsed.value, {
              kind: 'restore',
              state: order.value,
            });
            if (!(restored.ok)) expect.unreachable('Expected restored.ok');
            expect(restored.value).toStrictEqual(order.value);
            expect(order.value.sections[1].itemRefs).toStrictEqual(
              parsed.value.sections[1].items.map((item) => item.identifier),
            );
            expect(Object.values(exported.itemsXml).sort()).toStrictEqual(
              revisions.map((row) => row.qtiXml).sort(),
            );

            const copy = await duplicateAssessment(ctx, assessment.id);
            if (!(copy._tag === 'Duplicated')) {
              expect.unreachable("Expected copy._tag === 'Duplicated'");
            }
            copyId = copy.id;
            const duplicated = await getAssessment(ctx, copy.id);
            assertQuestionOnlyAssessmentFixture(duplicated);
            expect(duplicated.parts.map((p) => p.options)).toStrictEqual(
              saved.parts.map((p) => p.options),
            );
            expect(duplicated.parts.map((p) => p.id)).not.toStrictEqual(
              saved.parts.map((p) => p.id),
            );
            expect(
              duplicated.parts.map((p) =>
                p.placements.map(({ itemId, snapshotRev, blueprintTargetId }) => ({
                  itemId,
                  snapshotRev,
                  blueprintTargetId,
                }))
              ),
            ).toStrictEqual(
              saved.parts.map((p) =>
                p.placements.map(({ itemId, snapshotRev, blueprintTargetId }) => ({
                  itemId,
                  snapshotRev,
                  blueprintTargetId,
                }))
              ),
            );

            const reset = await assessmentArrangementCommandFixture(
              ctx,
              assessment.id,
              saved.parts.map((p) => ({
                ...p,
                options: { ...p.options, shuffleQuestions: false },
              })),
            );
            if (!((await saveAssessmentParts(ctx, assessment.id, reset)).ok)) {
              expect.unreachable(
                'Expected (await saveAssessmentParts(ctx, assessment.id, reset)).ok',
              );
            }
            const stale = await saveAssessmentParts(ctx, assessment.id, command);
            if (stale.ok) expect.unreachable('Expected !stale.ok');
            expect(stale.error.code).toStrictEqual('stale_structure');
            const current = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(current);
            expect(current.parts.map((p) => p.placements)).toStrictEqual(
              before.parts.map((p) => p.placements),
            );

            const partRows = await db.select().from(assessmentParts).where(
              eq(assessmentParts.assessmentId, assessment.id),
            ).orderBy(assessmentParts.position);
            await db.insert(assessmentAdaptivePlans).values({
              assessmentId: assessment.id,
              document: adaptivePlanDocument(adaptiveExportFixture().plan),
            });
            const adaptive = await saveAssessmentParts(ctx, assessment.id, command);
            if (adaptive.ok) expect.unreachable('Expected !adaptive.ok');
            expect(adaptive.error.code).toStrictEqual('adaptive_managed');
            expect(
              await db.select().from(assessmentParts).where(
                eq(assessmentParts.assessmentId, assessment.id),
              ).orderBy(assessmentParts.position),
            ).toStrictEqual(partRows);
            await db.delete(assessmentAdaptivePlans).where(
              eq(assessmentAdaptivePlans.assessmentId, assessment.id),
            );
            expect(await getAssessment(ctx, assessment.id)).toStrictEqual(current);
            await db.delete(organizationMemberships).where(
              and(
                eq(organizationMemberships.tenantId, ctx.tenantId),
                eq(organizationMemberships.userId, ctx.userId),
              ),
            );
            const revoked = await saveAssessmentParts(ctx, assessment.id, reset);
            if (revoked.ok) expect.unreachable('Expected !revoked.ok');
            expect(revoked.error.code).toStrictEqual('forbidden');
            expect(await getAssessment(ctx, assessment.id)).toStrictEqual(current);
          } finally {
            // Fixture cleanup owns these records after membership revocation.
            if (copyId) await db.delete(assessments).where(eq(assessments.id, copyId));
            await db.delete(assessments).where(eq(assessments.id, assessment.id));
          }
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);
