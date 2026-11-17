import { expect, test as testCase } from 'vitest';

import { organizationMemberships } from '../lib/db/principal_schema.ts';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessments, questionRevisions, questions, tenants, users } from '../lib/db/schema.ts';
import {
  readInstructorDefaults,
  saveInstructorDefaults,
} from '../lib/services/instructor_defaults.ts';
import { authoringPreferencesService } from '../lib/services/authoring_preferences.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { applyAuthoringPreferences } from '../lib/authoring_preferences.ts';
import { resolveAuthoringPreferences } from '../lib/instructor_defaults.ts';
import { createRailDraft } from '../islands/drivers/right_rail/rail_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';

testCase(
  'workspace instructor defaults persist, isolate identity, retain local scope and leave saved questions intact',
  async () => {
    const tenantId = crypto.randomUUID(), otherTenant = crypto.randomUUID();
    const userId = crypto.randomUUID(), otherUser = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    let initialized = false;
    try {
      await db.insert(tenants).values(
        [tenantId, otherTenant].map((id) => ({ id, slug: id, name: 'Defaults QA' })),
      );
      initialized = true;
      await db.insert(users).values(
        [userId, otherUser].map((id) => ({
          id,
          email: `${id}@example.com`,
          emailNormalized: `${id}@example.com`,
        })),
      );
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      expect(await readInstructorDefaults(ctx)).toStrictEqual(null);
      await db.transaction((tx) =>
        saveInstructorDefaults(tx, ctx, { answerChoiceOrder: 'shuffled', maximumScore: null })
      );
      expect(await readInstructorDefaults(ctx)).toStrictEqual({
        answerChoiceOrder: 'shuffled',
        maximumScore: null,
      });
      await expect(
        Promise.resolve().then(() =>
          db.transaction(async (tx) => {
            await saveInstructorDefaults(tx, ctx, {
              answerChoiceOrder: 'authored',
              maximumScore: null,
            });
            throw new Error('Abort the preference transaction');
          })
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(await readInstructorDefaults(ctx)).toStrictEqual({
        answerChoiceOrder: 'shuffled',
        maximumScore: null,
      });
      expect(await readInstructorDefaults({ ...ctx, userId: otherUser })).toStrictEqual(null);
      expect(await readInstructorDefaults({ ...ctx, tenantId: otherTenant })).toStrictEqual(null);
      const a = await createAssessmentDraft(ctx), b = await createAssessmentDraft(ctx);
      const record = await getAssessment(ctx, a.id);
      assertQuestionOnlyAssessmentFixture(record);
      const saved = await saveAssessmentQuestion(ctx, a.id, {
        _tag: 'Create',
        partId: record.parts[0].id,
        draft: {
          type: 'single_select',
          itemLanguage: newAuthoringItemLanguage(),
          title: 'Fixed answer order',
          bodyHtml: '<p>Choose one</p>',
          choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
          correctId: 'A',
          shuffle: false,
        },
        rememberedSettings: { shuffle: false },
      });
      if (!(saved.ok)) expect.unreachable('Expected saved.ok');
      const defaults = await readInstructorDefaults(ctx);
      for (const [assessmentId, expected] of [[a.id, false], [b.id, true]] as const) {
        const effective = resolveAuthoringPreferences(
          defaults,
          await authoringPreferencesService.read(ctx, assessmentId),
          null,
        );
        expect(
          applyAuthoringPreferences(createRailDraft('single_select'), 'single_select', effective)
            .shuffle,
        ).toStrictEqual(expected);
      }
      await authoringPreferencesService.reset(ctx, a.id, 'single_select');
      expect(await authoringPreferencesService.read(ctx, a.id)).toStrictEqual([{
        typeId: 'multi_select',
        settings: { shuffle: false },
      }]);
      const dropdownRecord = await getAssessment(ctx, b.id);
      assertQuestionOnlyAssessmentFixture(dropdownRecord);
      const blankDropdown = createRailDraft('inline_choice');
      const dropdownDraft = {
        ...blankDropdown,
        inlineChoices: blankDropdown.inlineChoices?.map((slot) => ({ ...slot, shuffle: false })),
      };
      const dropdown = await saveAssessmentQuestion(ctx, b.id, {
        _tag: 'Create',
        partId: dropdownRecord.parts[0].id,
        draft: dropdownDraft,
        rememberedSettings: { shuffle: false },
      });
      if (!(dropdown.ok)) expect.unreachable('Expected dropdown.ok');
      const dropdownPreferences = await authoringPreferencesService.read(ctx, b.id);
      expect(dropdownPreferences).toStrictEqual([{
        typeId: 'inline_choice',
        settings: { shuffle: false },
      }]);
      expect(
        applyAuthoringPreferences(
          blankDropdown,
          'inline_choice',
          resolveAuthoringPreferences(defaults, dropdownPreferences, null),
        )
          .inlineChoices?.map((slot) => slot.shuffle),
      ).toStrictEqual([false]);
      await authoringPreferencesService.reset(ctx, b.id, 'inline_choice');
      expect(
        applyAuthoringPreferences(
          blankDropdown,
          'inline_choice',
          resolveAuthoringPreferences(
            defaults,
            await authoringPreferencesService.read(ctx, b.id),
            null,
          ),
        )
          .inlineChoices?.map((slot) => slot.shuffle),
      ).toStrictEqual([true]);
      const reopenedDropdown = await getQuestionRevision(ctx, dropdown.value.itemId, 1);
      if (!reopenedDropdown) expect.unreachable('Expected reopenedDropdown');
      expect(
        parsePersistedDraft(reopenedDropdown.body, 'inline_choice').inlineChoices?.map((slot) =>
          slot.shuffle
        ),
      ).toStrictEqual([false]);
      await db.transaction((tx) => saveInstructorDefaults(tx, ctx, null));
      expect(await readInstructorDefaults(ctx)).toStrictEqual(null);
      const reopened = await getAssessment(ctx, a.id);
      assertQuestionOnlyAssessmentFixture(reopened);
      expect(reopened.parts[0].placements[0].id).toStrictEqual(saved.value.placementId);
      expect(reopened.parts[0].placements[0].itemId).toStrictEqual(saved.value.itemId);
      const [revision] = await db.select({ body: questionRevisions.body }).from(questionRevisions)
        .where(eq(questionRevisions.questionId, saved.value.itemId));
      if (!(revision.body && typeof revision.body === 'object' && 'shuffle' in revision.body)) {
        expect.unreachable(
          "Expected revision.body && typeof revision.body === 'object' && 'shuffle' in revision.body",
        );
      }
      expect(revision.body.shuffle).toStrictEqual(false);
      await db.delete(assessments).where(eq(assessments.tenantId, tenantId));
    } finally {
      if (initialized) {
        await db.update(questions).set({ latestRevisionId: null }).where(
          eq(questions.tenantId, tenantId),
        );
        await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
        await db.delete(questions).where(eq(questions.tenantId, tenantId));
        await db.delete(tenants).where(eq(tenants.id, tenantId));
        await db.delete(tenants).where(eq(tenants.id, otherTenant));
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(users).where(eq(users.id, otherUser));
      }
      await shutdownDb();
    }
  },
);
