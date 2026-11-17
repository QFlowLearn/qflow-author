import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentParts,
  assessmentPlacements,
  assessments,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { applyQuestionBankBulkCommand } from '../lib/services/question_bank_bulk.ts';
import { duplicateAssessment, getAssessment } from '../lib/services/assessment_records.ts';
import { saveAssessment } from './assessment_fixture.ts';
import {
  pinPlacementToLatest,
  setPlacementFollowLatest,
  updateAssessmentBlueprint,
} from '../lib/services/assessment_structure.ts';
import { prepareQuestionPublication } from '../lib/services/publish.ts';
import {
  getQuestionRevision,
  saveVariantQuestionRevisionInTransaction,
} from '../lib/services/questions.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import type { RequestContext } from '../lib/tenants.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createQuestionVariantDraft, parseQuestionVariantDraft } from '../lib/question_variants.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';

const AUTHORED_ITEM_LANGUAGE = newAuthoringItemLanguage();

testCase(
  'assessment question saves are atomic and revise only the selected placement',
  async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    let assessmentId: string | null = null;
    let duplicateAssessmentId: string | null = null;

    try {
      const email = `author-${tenantId.slice(0, 8)}@example.com`;
      await db.insert(tenants).values({
        id: tenantId,
        slug: `t-${tenantId.slice(0, 8)}`,
        name: 'Authoring transaction tenant',
      });
      await db.insert(users).values({ id: userId, email, emailNormalized: email });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      const assessment = await saveAssessment(ctx, {
        blueprint: testAssessmentBlueprint([
          { id: 'choice-target', questionType: 'single_select', count: 1 },
        ]),
        title: 'Atomic authoring assessment',
        parts: [{ title: 'Part 1', placements: [] }],
      });
      assessmentId = assessment.id;
      const initial = await getAssessment(ctx, assessment.id);
      if (!initial) throw new Error('Expected assessment fixture.');
      const partId = initial.parts[0].id;

      const created = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Create',
        partId,
        draft: questionDraft('Original question'),
        blueprintTargetId: 'choice-target',
      });
      if (!created.ok) throw new Error(created.error.message);
      const createdRevision = await getQuestionRevision(ctx, created.value.itemId, 1);
      if (!createdRevision) throw new Error('Expected the created item revision.');
      await expect(
        Promise.resolve().then(() =>
          updateAssessmentBlueprint(
            ctx,
            assessment.id,
            testAssessmentBlueprint([
              { id: 'replacement-target', questionType: 'single_select', count: 1 },
            ]),
          )
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error &&
        caught.message.includes('Reassign questions that use targets you removed or changed')
      );
      await expect(
        Promise.resolve().then(() =>
          saveQuestionRevisionFixture(ctx, {
            questionId: created.value.itemId,
            title: 'Invalid authored descendant',
            body: { type: 'single_select', title: 'Invalid authored descendant' },
            provenance: { _tag: 'Authored' },
            qtiXml: createdRevision.qtiXml,
            draftState: 'published',
          })
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error &&
        caught.message.includes('Later question revisions require explicit revision provenance.')
      );

      await saveQuestionRevisionFixture(ctx, {
        questionId: created.value.itemId,
        title: 'Incompatible latest revision',
        body: {
          type: 'multi_select',
          itemLanguage: AUTHORED_ITEM_LANGUAGE,
          title: 'Incompatible latest revision',
          bodyHtml: '<p>Select both capitals.</p>',
          choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Stockholm' }],
          correctIds: ['A', 'B'],
        },
        provenance: {
          _tag: 'Revision',
          operation: 'revised',
          expectedParentRevision: 1,
        },
        qtiXml: createdRevision.qtiXml,
        draftState: 'published',
      });
      await expect(
        Promise.resolve().then(() =>
          pinPlacementToLatest(ctx, assessment.id, created.value.placementId)
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('requires single_select')
      );
      await expect(
        Promise.resolve().then(() =>
          setPlacementFollowLatest(ctx, assessment.id, created.value.placementId)
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('requires single_select')
      );
      const incompatibleRevision = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Revise',
        expectedParentRevision: 2,
        placementId: created.value.placementId,
        itemId: created.value.itemId,
        draft: {
          type: 'multi_select',
          itemLanguage: AUTHORED_ITEM_LANGUAGE,
          title: 'Incompatible placement revision',
          bodyHtml: '<p>Select both capitals.</p>',
          choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Stockholm' }],
          correctIds: ['A', 'B'],
        },
      });
      expect(incompatibleRevision.ok).toStrictEqual(false);
      if (!incompatibleRevision.ok) expect(incompatibleRevision.status).toStrictEqual(400);

      const secondPlacementId = crypto.randomUUID();
      await db.insert(assessmentPlacements).values({
        id: secondPlacementId,
        assessmentPartId: partId,
        questionId: created.value.itemId,
        pinnedRevision: 1,
        position: 2,
      });

      const revised = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Revise',
        expectedParentRevision: 2,
        placementId: created.value.placementId,
        itemId: created.value.itemId,
        draft: questionDraft('Revised question'),
      });
      if (!revised.ok) throw new Error(revised.error.message);
      expect(revised.value.revision).toStrictEqual(3);

      expect(
        await applyQuestionBankBulkCommand(ctx, {
          _tag: 'Archive',
          questionIds: [created.value.itemId],
        }),
      ).toStrictEqual({ ok: true, changed: 1 });
      const archivedRevision = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Revise',
        expectedParentRevision: revised.value.revision,
        placementId: created.value.placementId,
        itemId: created.value.itemId,
        draft: questionDraft('Archived item revision'),
      });
      expect(archivedRevision.ok).toStrictEqual(false);
      if (!archivedRevision.ok) {
        expect(archivedRevision.status).toStrictEqual(409);
        expect(archivedRevision.error.error).toStrictEqual('item_archived');
      }
      expect(
        await applyQuestionBankBulkCommand(ctx, {
          _tag: 'Restore',
          questionIds: [created.value.itemId],
        }),
      ).toStrictEqual({ ok: true, changed: 1 });

      const variant = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Variant',
        requestId: crypto.randomUUID(),
        partId,
        sourcePlacementId: created.value.placementId,
        sourceItemId: created.value.itemId,
        sourceRevision: revised.value.revision,
        targetType: 'multi_select',
      });
      if (!variant.ok) throw new Error(variant.error.message);
      const variantRevision = await getQuestionRevision(ctx, variant.value.itemId, 1);
      expect(variantRevision?.provenance.origin).toStrictEqual({
        _tag: 'Variant',
        source: {
          questionId: created.value.itemId,
          revision: revised.value.revision,
        },
        transformation: {
          kind: 'compatible_type_transform',
          fromType: 'single_select',
          toType: 'multi_select',
        },
      });

      const afterVariant = await getAssessment(ctx, assessment.id);
      expect(afterVariant?.parts[0].placements.map((placement) => placement.id)).toStrictEqual([
        created.value.placementId,
        variant.value.placementId,
        secondPlacementId,
      ]);
      const copy = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Variant',
        requestId: crypto.randomUUID(),
        partId,
        sourcePlacementId: secondPlacementId,
        sourceItemId: created.value.itemId,
        sourceRevision: 1,
        targetType: 'single_select',
      });
      if (!copy.ok) throw new Error(copy.error.message);
      expect(copy.value.itemId === created.value.itemId).toStrictEqual(false);
      expect(copy.value.revision).toStrictEqual(1);
      const afterCopy = await getAssessment(ctx, assessment.id);
      expect(afterCopy?.parts[0].placements.map((placement) => placement.id)).toStrictEqual([
        created.value.placementId,
        variant.value.placementId,
        secondPlacementId,
        copy.value.placementId,
      ]);
      const beforeRejectedCopies = await db.select({ id: questions.id }).from(questions)
        .where(eq(questions.tenantId, tenantId));
      for (
        const failure of [
          { sourcePlacementId: created.value.placementId, sourceRevision: 1, status: 409 },
          { sourcePlacementId: crypto.randomUUID(), sourceRevision: 3, status: 404 },
        ]
      ) {
        const rejectedCopy = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Variant',
          requestId: crypto.randomUUID(),
          partId,
          sourcePlacementId: failure.sourcePlacementId,
          sourceItemId: created.value.itemId,
          sourceRevision: failure.sourceRevision,
          targetType: 'single_select',
        });
        expect(rejectedCopy.ok).toStrictEqual(false);
        if (!rejectedCopy.ok) expect(rejectedCopy.status).toStrictEqual(failure.status);
      }
      expect(
        await db.select({ id: questions.id }).from(questions)
          .where(eq(questions.tenantId, tenantId)),
      ).toStrictEqual(beforeRejectedCopies);

      const sourceRevision = await getQuestionRevision(
        ctx,
        created.value.itemId,
        revised.value.revision,
      );
      if (!sourceRevision) throw new Error('Expected the variant source revision.');
      const preparedVariant = await prepareQuestionPublication(
        ctx,
        createQuestionVariantDraft(
          parseQuestionVariantDraft(sourceRevision.body, 'source'),
          'multi_select',
        ),
      );
      if (!preparedVariant.ok) throw new Error(preparedVariant.error.body.message);
      const forgedPreparedVariant = {
        ...preparedVariant.prepared.saveInput,
        qtiXml: '<qti-assessment-item/>',
      } as unknown as typeof preparedVariant.prepared.saveInput;
      await expect(
        Promise.resolve().then(() =>
          db.transaction((tx) =>
            saveVariantQuestionRevisionInTransaction(
              tx,
              ctx,
              forgedPreparedVariant,
              { questionId: created.value.itemId, revision: revised.value.revision },
              'multi_select',
            )
          )
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('was not prepared')
      );

      const incompatibleVariant = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Variant',
        requestId: crypto.randomUUID(),
        partId,
        sourcePlacementId: created.value.placementId,
        sourceItemId: created.value.itemId,
        sourceRevision: revised.value.revision,
        targetType: 'extended_text',
      });
      expect(incompatibleVariant.ok).toStrictEqual(false);
      if (!incompatibleVariant.ok) expect(incompatibleVariant.status).toStrictEqual(422);

      const afterRevision = await getAssessment(ctx, assessment.id);
      assertQuestionOnlyAssessmentFixture(afterRevision);
      const placements = afterRevision.parts[0].placements;
      expect(
        placements.find((placement) => placement.id === created.value.placementId)?.snapshotRev,
      ).toStrictEqual(3);
      expect(
        placements.find((placement) => placement.id === created.value.placementId)
          ?.blueprintTargetId,
      ).toStrictEqual('choice-target');
      expect(placements.find((placement) => placement.id === secondPlacementId)?.snapshotRev)
        .toStrictEqual(1);
      const duplicated = await duplicateAssessment(ctx, assessment.id);
      if (!(duplicated._tag === 'Duplicated')) {
        expect.unreachable("Expected duplicated._tag === 'Duplicated'");
      }
      duplicateAssessmentId = duplicated.id;
      const duplicate = await getAssessment(ctx, duplicateAssessmentId);
      assertQuestionOnlyAssessmentFixture(duplicate);
      expect(duplicate.parts[0].placements.map((placement) => ({
        itemId: placement.itemId,
        snapshotRev: placement.snapshotRev,
      }))).toStrictEqual(placements.map((placement) => ({
        itemId: placement.itemId,
        snapshotRev: placement.snapshotRev,
      })));
      const duplicatedPlacementRevision = duplicate.parts[0].placements[0].snapshotRev;
      if (!duplicatedPlacementRevision) {
        throw new Error('Expected duplicated placement to retain its item revision.');
      }
      const duplicatedItem = await getQuestionRevision(
        ctx,
        created.value.itemId,
        duplicatedPlacementRevision,
      );
      expect(duplicatedItem?.provenance.event.operation).toStrictEqual('revised');

      const rollbackTitle = `Must roll back ${crypto.randomUUID()}`;
      const failed = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Create',
        partId: crypto.randomUUID(),
        draft: questionDraft(rollbackTitle),
      });
      expect(failed.ok).toStrictEqual(false);
      const orphanRows = await db.select({ id: questions.id }).from(questions).where(and(
        eq(questions.tenantId, tenantId),
        eq(questions.title, rollbackTitle),
      ));
      expect(orphanRows).toStrictEqual([]);
    } finally {
      try {
        for (const id of [duplicateAssessmentId, assessmentId]) {
          if (!id) continue;
          const parts = await db.select({ id: assessmentParts.id }).from(assessmentParts).where(
            eq(assessmentParts.assessmentId, id),
          );
          for (const part of parts) {
            await db.delete(assessmentPlacements).where(
              eq(assessmentPlacements.assessmentPartId, part.id),
            );
          }
          await db.delete(assessmentParts).where(eq(assessmentParts.assessmentId, id));
          await db.delete(assessments).where(eq(assessments.id, id));
        }
        const tenantQuestions = await db.select({ id: questions.id }).from(questions).where(
          eq(questions.tenantId, tenantId),
        );
        for (const question of tenantQuestions) {
          await db.delete(questionRevisions).where(eq(questionRevisions.questionId, question.id));
        }
        await db.delete(questions).where(eq(questions.tenantId, tenantId));
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      } catch (_cause: unknown) {
        // Ignore cleanup errors after an unavailable database.
      }
      await shutdownDb().catch(() => {});
    }
  },
);

function questionDraft(title: string): Draft {
  return {
    type: 'single_select',
    itemLanguage: AUTHORED_ITEM_LANGUAGE,
    title,
    bodyHtml: '<p>What is the capital of France?</p>',
    choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
    correctId: 'A',
  };
}
