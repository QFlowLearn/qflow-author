import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
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
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment, saveAssessment } from './assessment_fixture.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { changeQuestionPresentation } from '../lib/question_presentation.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { Draft } from '../lib/types/draft.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

testCase('a stale presentation save cannot replace a newer question revision', async () => {
  requireQaDatabaseUrl(process.env['DATABASE_URL']);
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const assessment = await createAssessmentDraft(ctx, {
        title: 'Stale presentation acceptance',
      });
      try {
        const view = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(view);
        const initial: Draft = {
          type: 'single_select',
          itemLanguage: newAuthoringItemLanguage(),
          title: 'Initial wording',
          bodyHtml: '<p>Choose Alpha.</p>',
          choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
          correctId: 'A',
          maximumScore: 3.125,
        };
        const created = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: view.parts[0].id,
          draft: initial,
        });
        if (!(created.ok)) expect.unreachable('Expected created.ok');
        const converted = changeQuestionPresentation(initial);
        if (!(converted.ok)) expect.unreachable('Expected converted.ok');
        const identity = {
          _tag: 'Revise' as const,
          itemId: created.value.itemId,
          placementId: created.value.placementId,
          expectedParentRevision: created.value.revision,
        };
        const firstTab = { ...identity, draft: { ...initial, title: 'Newer saved wording' } };
        const secondTab = { ...identity, draft: converted.draft };
        const saved = await saveAssessmentQuestion(ctx, assessment.id, firstTab);
        if (!(saved.ok)) expect.unreachable('Expected saved.ok');
        const before = await getAssessment(ctx, assessment.id);
        const beforeRevision = await getQuestionRevision(
          ctx,
          created.value.itemId,
          saved.value.revision,
        );
        const rejected = await saveAssessmentQuestion(ctx, assessment.id, secondTab);
        if (rejected.ok) {
          expect.unreachable(
            'The older tab must be rejected instead of creating an overwriting revision.',
          );
        }
        expect(rejected.status).toStrictEqual(409);
        expect(rejected.error.error).toStrictEqual('stale_parent_revision');
        expect(await getAssessment(ctx, assessment.id)).toStrictEqual(before);
        expect(await getQuestionRevision(ctx, created.value.itemId)).toStrictEqual(beforeRevision);
        expect(
          (await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, created.value.itemId),
          )).length,
        ).toStrictEqual(2);
        expect(secondTab.draft).toStrictEqual(converted.draft);
        const missing = await saveAssessmentQuestion(ctx, assessment.id, {
          ...identity,
          itemId: crypto.randomUUID(),
          placementId: crypto.randomUUID(),
          draft: initial,
        });
        if (missing.ok) expect.unreachable('Expected !missing.ok');
        expect(missing.status).toStrictEqual(404);
        expect(await getAssessment(ctx, assessment.id)).toStrictEqual(before);
        const contenders = await Promise.all([
          saveAssessmentQuestion(ctx, assessment.id, {
            ...identity,
            expectedParentRevision: saved.value.revision,
            draft: { ...initial, title: 'Concurrent choice save' },
          }),
          saveAssessmentQuestion(ctx, assessment.id, {
            ...identity,
            expectedParentRevision: saved.value.revision,
            draft: { ...converted.draft, title: 'Concurrent dropdown save' },
          }),
        ]);
        expect(contenders.filter((result) => result.ok).length).toStrictEqual(1);
        const conflict = contenders.find((result) => !result.ok);
        if (!(conflict && !conflict.ok)) expect.unreachable('Expected conflict && !conflict.ok');
        expect(conflict.status).toStrictEqual(409);
        expect(conflict.error.error).toStrictEqual('stale_parent_revision');
        expect(
          (await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, created.value.itemId),
          )).length,
        ).toStrictEqual(3);
        expect(await getQuestionRevision(ctx, created.value.itemId, saved.value.revision))
          .toStrictEqual(beforeRevision);
      } finally {
        await deleteAssessment(ctx, assessment.id);
      }
    });
  } finally {
    await shutdownDb();
  }
});

testCase(
  'presentation changes save immutable revisions of the same question and placement',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const tenantId = crypto.randomUUID(), userId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    let assessmentId: string | undefined;
    let questionId: string | undefined;
    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug: `presentation-${tenantId}`,
        name: 'Presentation transaction',
      });
      const email = `presentation-${userId}@example.com`;
      await db.insert(users).values({ id: userId, email, emailNormalized: email });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      const assessment = await saveAssessment(ctx, {
        title: 'Presentation test',
        blueprint: { _tag: 'Unspecified', version: 1 },
        parts: [{ title: 'Questions', placements: [] }],
      });
      assessmentId = assessment.id;
      const structure = await getAssessment(ctx, assessment.id);
      assertQuestionOnlyAssessmentFixture(structure);
      const part = structure.parts[0];
      if (!part) expect.unreachable('Expected part');
      const initial: Draft = {
        type: 'single_select',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Capital',
        bodyHtml: '<p>Choose a capital.</p>',
        promptHtml: 'One answer.',
        choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Rome', fixed: true }],
        correctId: 'B',
        shuffle: true,
        required: false,
      };
      const created = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Create',
        partId: part.id,
        draft: initial,
      });
      if (!(created.ok)) expect.unreachable('Expected created.ok');
      questionId = created.value.itemId;
      const toDropdown = changeQuestionPresentation(initial);
      if (!(toDropdown.ok)) expect.unreachable('Expected toDropdown.ok');
      const changed = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Revise',
        expectedParentRevision: created.value.revision,
        itemId: questionId,
        placementId: created.value.placementId,
        draft: toDropdown.draft,
      });
      if (!(changed.ok)) expect.unreachable('Expected changed.ok');
      expect(changed.value.itemId).toStrictEqual(questionId);
      expect(changed.value.placementId).toStrictEqual(created.value.placementId);
      expect(changed.value.revision).toStrictEqual(2);
      const savedDropdown = await getQuestionRevision(ctx, questionId, 2);
      if (!savedDropdown) expect.unreachable('Expected savedDropdown');
      const persisted = parsePersistedDraft(savedDropdown.body, 'inline_choice');
      expect(persisted.inlineChoices?.[0].correctId).toStrictEqual('B');
      expect(persisted.inlineChoices?.[0].shuffle).toStrictEqual(true);
      expect(persisted.inlineChoices?.[0].required).toStrictEqual(false);
      const toChoices = changeQuestionPresentation(persisted);
      if (!(toChoices.ok)) expect.unreachable('Expected toChoices.ok');
      const changedBack = await saveAssessmentQuestion(ctx, assessment.id, {
        _tag: 'Revise',
        expectedParentRevision: changed.value.revision,
        itemId: questionId,
        placementId: created.value.placementId,
        draft: toChoices.draft,
      });
      if (!(changedBack.ok)) expect.unreachable('Expected changedBack.ok');
      expect(changedBack.value.itemId).toStrictEqual(questionId);
      expect(changedBack.value.placementId).toStrictEqual(created.value.placementId);
      expect(changedBack.value.revision).toStrictEqual(3);
      const original = await getQuestionRevision(ctx, questionId, 1);
      if (!original) expect.unreachable('Expected original');
      expect(original.body.type).toStrictEqual('single_select');
      expect(original.body.choices).toStrictEqual(initial.choices);
      const reopened = await getAssessment(ctx, assessment.id);
      assertQuestionOnlyAssessmentFixture(reopened);
      expect(reopened.parts[0].placements.length).toStrictEqual(1);
      expect(reopened.parts[0].placements[0].itemId).toStrictEqual(questionId);
      expect(reopened.parts[0].placements[0].snapshotRev).toStrictEqual(3);
      expect(
        (await db.select({ id: questions.id }).from(questions).where(
          eq(questions.tenantId, tenantId),
        )).length,
      ).toStrictEqual(1);
    } finally {
      try {
        if (assessmentId) {
          const parts = await db.select({ id: assessmentParts.id }).from(assessmentParts).where(
            eq(assessmentParts.assessmentId, assessmentId),
          );
          for (const part of parts) {
            await db.delete(assessmentPlacements).where(
              eq(assessmentPlacements.assessmentPartId, part.id),
            );
          }
          await db.delete(assessmentParts).where(eq(assessmentParts.assessmentId, assessmentId));
          await db.delete(assessments).where(eq(assessments.id, assessmentId));
        }
        if (questionId) {
          await db.delete(questionRevisions).where(eq(questionRevisions.questionId, questionId));
        }
        await db.delete(questions).where(eq(questions.tenantId, tenantId));
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      } catch (_cause: unknown) {
        // Cleanup may also fail when the configured database is unavailable before fixture creation.
      }
      await shutdownDb().catch(() => {});
    }
  },
);
