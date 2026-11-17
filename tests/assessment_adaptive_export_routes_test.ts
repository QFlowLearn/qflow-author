import { expect, test as testCase } from 'vitest';

import { organizationMemberships } from '../lib/db/principal_schema.ts';

import { eq, inArray } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentAdaptivePlans,
  assessmentExportReceipts,
  assessmentParts,
  assessmentPlacements,
  assessments,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { adaptivePlanDocument } from '../lib/assessment_adaptive_plan.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { saveAssessment } from './assessment_fixture.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { packageApiRoute as packageHandlerEndpoint } from '../lib/http/routes/assessment_api/package.ts';
import { validateApiRoute as validateHandlerEndpoint } from '../lib/http/routes/assessment_api/validate.ts';
import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

const packageHandler = packageHandlerEndpoint.handle;
const validateHandler = validateHandlerEndpoint.handle;

testCase(
  'saved adaptive assessment reaches Canvas Classic download after sequencing acknowledgement',
  async () => {
    const fixture = adaptiveExportFixture(15);
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const auth: RequestContext = { tenantId, userId, role: 'owner' };
    const storage = createMemoryObjectStorage();
    const questionIds: string[] = [];
    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug: tenantId,
        name: 'Adaptive export test',
      });
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        emailNormalized: `${userId}@example.com`,
        displayName: 'Adaptive export author',
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      const placements = [];
      for (const [index, placement] of fixture.part.placements.entries()) {
        const body = {
          type: 'single_select',
          title: `Pool question ${index + 1}`,
          bodyHtml: '<p>Pick one.</p>',
          choices: [{ id: 'A', text: 'Correct answer' }, { id: 'B', text: 'Other answer' }],
          correctId: 'A',
        };
        const saved = await saveQuestionRevisionFixture(auth, {
          title: body.title,
          body,
          qtiXml: exportQti3TestItemXml('single_select', body, {
            identifier: `pool_item_${index + 1}`,
          }),
          draftState: 'published',
          provenance: { _tag: 'Authored' },
        });
        questionIds.push(saved.questionId);
        placements.push({
          id: placement.id,
          itemId: saved.questionId,
          snapshotRev: saved.revision,
        });
      }
      await saveAssessment(auth, {
        id: fixture.assessment.id,
        title: fixture.assessment.title,
        blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
        targetCount: 15,
        parts: [{ id: fixture.part.id, title: fixture.part.title, placements }],
      });
      await db.insert(assessmentAdaptivePlans).values({
        assessmentId: fixture.assessment.id,
        document: adaptivePlanDocument(fixture.plan),
      });
      const assessment = await getAssessment(auth, fixture.assessment.id);
      if (!assessment) expect.unreachable('Expected assessment');
      const built = await buildAssessmentPackage({
        assessment,
        auth,
        readUploadBytes: (upload) => storage.readObject(upload.path),
        targetId: 'canvas-classic',
        requirements: strictAssessmentExportRequirements(),
      });
      if (!(built.ok)) expect.unreachable(JSON.stringify(built));
      expect(built.preflight._tag).toStrictEqual('Evaluated');
      expect(built.preflight.overallOutcome).toStrictEqual('warning');
      expect(built.preflight.items.length).toStrictEqual(30);
      if (!(built.preflight.items.every((item) => item._tag !== 'Blocked'))) {
        expect.unreachable(
          "Expected built.preflight.items.every((item) => item._tag !== 'Blocked')",
        );
      }
      if (!(built.preflight.warningCodes.includes('qflow.export.adaptive_sequence_omitted'))) {
        expect.unreachable(
          "Expected built.preflight.warningCodes.includes('qflow.export.adaptive_sequence_omitted')",
        );
      }

      const query = new URLSearchParams({
        target: 'canvas-classic',
        scoring: 'automatic',
        interaction: 'preserve',
        preflightId: built.preflight.preflightId,
      });
      const invoke = (route: typeof packageHandler | typeof validateHandler, path: string) =>
        invokeHttpRoute(
          route,
          makeHttpRequest(
            new Request(`https://qflow.example/api/assessments/${assessment.id}/${path}?${query}`),
            { params: { id: assessment.id }, auth, state: { storage } },
          ),
        );
      const checked = await invoke(validateHandler, 'validate');
      expect(checked.status).toStrictEqual(200);
      expect(await checked.text()).toContain('qflow.export.adaptive_sequence_omitted');
      const unacknowledged = await invoke(packageHandler, 'package');
      expect(unacknowledged.status).toStrictEqual(409);
      expect(await unacknowledged.text()).toContain('WarningsNotAcknowledged');
      if (!(built.preflight.acknowledgementToken)) {
        expect.unreachable('Expected built.preflight.acknowledgementToken');
      }
      query.set('acknowledgement', built.preflight.acknowledgementToken);
      const downloaded = await invoke(packageHandler, 'package');
      expect(downloaded.status).toStrictEqual(200);
      expect(downloaded.headers.get('x-qflow-export-warning-codes') ?? '').toContain(
        'qflow.export.adaptive_sequence_omitted',
      );
      const files = unzipSync(new Uint8Array(await downloaded.arrayBuffer()));
      const quiz = new TextDecoder().decode(files['assessment_qti.xml']);
      expect((quiz.match(/<item\s/g) ?? []).length).toStrictEqual(30);
    } finally {
      await db.delete(assessmentExportReceipts).where(
        eq(assessmentExportReceipts.assessmentId, fixture.assessment.id),
      );
      await db.delete(assessmentPlacements).where(
        eq(assessmentPlacements.assessmentPartId, fixture.part.id),
      );
      await db.delete(assessmentParts).where(eq(assessmentParts.id, fixture.part.id));
      await db.delete(assessments).where(eq(assessments.id, fixture.assessment.id));
      if (questionIds.length) {
        await db.update(questions).set({ latestRevisionId: null }).where(
          inArray(questions.id, questionIds),
        );
        await db.delete(questionRevisions).where(
          inArray(questionRevisions.questionId, questionIds),
        );
        await db.delete(questions).where(inArray(questions.id, questionIds));
      }
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await shutdownDb();
    }
  },
);
