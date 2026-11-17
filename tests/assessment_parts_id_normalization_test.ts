import { expect, test as testCase } from 'vitest';

import { organizationMemberships } from '../lib/db/principal_schema.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentParts,
  assessmentPlacements,
  assessments,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { saveAssessment } from './assessment_fixture.ts';
import {
  appendPlacement,
  AssessmentStructureError,
  replaceAssessmentPartsInTransaction,
} from '../lib/services/assessment_structure.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { questionXmlFixture } from './question_xml_fixture.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

testCase(
  'assessment parts reject invalid IDs and generate UUIDs only when IDs are omitted',
  async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };

    let assessmentId: string | null = null;
    let questionId: string | null = null;

    try {
      const email = `owner-${tenantId.slice(0, 8)}@example.com`;
      await db.insert(tenants).values({
        id: tenantId,
        slug: `t-${tenantId.slice(0, 8)}`,
        name: 'Tenant',
      });
      await db.insert(users).values({ id: userId, email, emailNormalized: email });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });

      const question = await saveQuestionRevisionFixture(ctx, {
        title: 'Imported question',
        body: { type: 'text_entry', title: 'Imported question' },
        qtiXml: questionXmlFixture('assessment-parts-item'),
        draftState: 'published',
        provenance: { _tag: 'Authored' },
      });
      questionId = question.questionId;

      const assessment = await saveAssessment(ctx, {
        blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
        title: 'Imported assessment',
        parts: [{ title: 'Part 1', placements: [] }],
      });
      assessmentId = assessment.id;

      await expect(
        Promise.resolve().then(() =>
          db.transaction((tx) =>
            replaceAssessmentPartsInTransaction(tx, ctx, assessment.id, [{
              id: 'part-1',
              title: 'Imported Part',
              placements: [{ id: 'placement-1', itemId: question.questionId }],
            }])
          )
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof AssessmentStructureError && caught.message.includes('must be a UUID')
      );
      await db.transaction((tx) =>
        replaceAssessmentPartsInTransaction(tx, ctx, assessment.id, [{
          title: 'Imported Part',
          placements: [{ itemId: question.questionId }],
        }])
      );

      const partRows = await db.select()
        .from(assessmentParts)
        .where(eq(assessmentParts.assessmentId, assessmentId));
      expect(partRows.length).toStrictEqual(1);
      expect(partRows[0].title).toStrictEqual('Imported Part');
      expect(partRows[0].id).toMatch(UUID_RE);

      const placementRows = await db.select()
        .from(assessmentPlacements)
        .where(eq(assessmentPlacements.assessmentPartId, partRows[0].id));
      expect(placementRows.length).toStrictEqual(1);
      expect(placementRows[0].questionId).toStrictEqual(questionId);
      expect(placementRows[0].id).toMatch(UUID_RE);

      await expect(
        Promise.resolve().then(() =>
          appendPlacement(ctx, assessment.id, {
            itemId: question.questionId,
            partId: crypto.randomUUID(),
          })
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof AssessmentStructureError &&
        caught.message.includes('Assessment part not found')
      );
      const unchangedPlacements = await db.select({ id: assessmentPlacements.id })
        .from(assessmentPlacements)
        .where(eq(assessmentPlacements.assessmentPartId, partRows[0].id));
      expect(unchangedPlacements.length).toStrictEqual(1);
    } finally {
      try {
        if (assessmentId) {
          const partRows = await db.select({ id: assessmentParts.id })
            .from(assessmentParts)
            .where(eq(assessmentParts.assessmentId, assessmentId));
          for (const part of partRows) {
            await db.delete(assessmentPlacements).where(
              eq(assessmentPlacements.assessmentPartId, part.id),
            );
          }
          await db.delete(assessmentParts).where(eq(assessmentParts.assessmentId, assessmentId));
          await db.delete(assessments).where(eq(assessments.id, assessmentId));
        }
        if (questionId) {
          await db.delete(questionRevisions).where(eq(questionRevisions.questionId, questionId));
          await db.delete(questions).where(eq(questions.id, questionId));
        }
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      } catch (_) {
        // ignore cleanup errors
      }
      await shutdownDb().catch(() => {});
    }
  },
);
