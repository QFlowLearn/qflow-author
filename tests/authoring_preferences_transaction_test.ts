import { expect, test as testCase } from 'vitest';

import { organizationMemberships } from '../lib/db/principal_schema.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessments, questionRevisions, questions, tenants, users } from '../lib/db/schema.ts';
import { authoringPreferencesService } from '../lib/services/authoring_preferences.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft } from './assessment_fixture.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  'question save commits personal defaults atomically and isolates assessment, author, workspace and reset',
  async () => {
    const tenantId = crypto.randomUUID(),
      userId = crypto.randomUUID(),
      colleagueId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    const ids: string[] = [];
    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug: `prefs-${tenantId}`,
        name: 'Preferences test',
      });
      await db.insert(users).values(
        [userId, colleagueId].map((id) => ({
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
      const a = await createAssessmentDraft(ctx, {
        title: 'Remember settings',
        blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
      });
      ids.push(a.id);
      const b = await createAssessmentDraft(ctx, {
        title: 'Other assessment',
        blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
      });
      ids.push(b.id);
      const record = await getAssessment(ctx, a.id);
      if (!record) expect.unreachable('Expected record');
      const partId = record.parts[0].id;
      const draft = {
        type: 'single_select' as const,
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Capital',
        bodyHtml: '<p>Capital of France?</p>',
        choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
        correctId: 'A',
        shuffle: true,
      };
      const first = await saveAssessmentQuestion(ctx, a.id, {
        _tag: 'Create',
        partId: partId,
        draft,
        rememberedSettings: { shuffle: true },
      });
      if (!(first.ok)) expect.unreachable('Expected first.ok');
      expect(
        (await authoringPreferencesService.read(ctx, a.id)).find((p) =>
          p.typeId === 'single_select'
        )
          ?.settings,
      ).toStrictEqual({ shuffle: true });
      expect(await authoringPreferencesService.read({ ...ctx, userId: colleagueId }, a.id))
        .toStrictEqual([]);
      expect(await authoringPreferencesService.read(ctx, b.id)).toStrictEqual([]);
      expect(
        await authoringPreferencesService.read({ ...ctx, tenantId: crypto.randomUUID() }, a.id),
      ).toStrictEqual([]);
      const failed = await saveAssessmentQuestion(ctx, a.id, {
        _tag: 'Create',
        partId: crypto.randomUUID(),
        draft,
        rememberedSettings: { shuffle: false },
      });
      if (failed.ok) expect.unreachable('Expected !failed.ok');
      expect(
        (await authoringPreferencesService.read(ctx, a.id)).find((p) =>
          p.typeId === 'single_select'
        )
          ?.settings,
      ).toStrictEqual({ shuffle: true });
      const exception = await saveAssessmentQuestion(ctx, a.id, {
        _tag: 'Create',
        partId: partId,
        draft: { ...draft, shuffle: false },
      });
      if (!(exception.ok)) expect.unreachable('Expected exception.ok');
      expect(
        (await authoringPreferencesService.read(ctx, a.id)).find((p) =>
          p.typeId === 'single_select'
        )
          ?.settings,
      ).toStrictEqual({ shuffle: true });
      const merged = await saveAssessmentQuestion(ctx, a.id, {
        _tag: 'Revise',
        expectedParentRevision: first.value.revision,
        itemId: first.value.itemId,
        placementId: first.value.placementId,
        draft,
        rememberedSettings: { labelStyle: 'decimal' },
      });
      if (!(merged.ok)) expect.unreachable('Expected merged.ok');
      expect(
        (await authoringPreferencesService.read(ctx, a.id)).find((p) =>
          p.typeId === 'single_select'
        )
          ?.settings,
      ).toStrictEqual({ shuffle: true, labelStyle: 'decimal' });
      expect(
        await authoringPreferencesService.reset(
          { ...ctx, tenantId: crypto.randomUUID() },
          a.id,
          'single_select',
        ),
      ).toStrictEqual(false);
      expect(await authoringPreferencesService.reset(ctx, a.id, 'single_select')).toStrictEqual(
        true,
      );
      expect(await authoringPreferencesService.reset(ctx, a.id, 'single_select')).toStrictEqual(
        true,
      );
      expect((await authoringPreferencesService.read(ctx, a.id)).map((p) => p.typeId))
        .toStrictEqual([
          'multi_select',
        ]);
    } finally {
      for (const id of ids) await db.delete(assessments).where(eq(assessments.id, id));
      await db.update(questions).set({ latestRevisionId: null }).where(
        eq(questions.tenantId, tenantId),
      );
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, colleagueId));
      await shutdownDb();
    }
  },
);
