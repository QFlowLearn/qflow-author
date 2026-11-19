import { inspect } from 'node:util';
import { diagnosticConsole } from './helpers/diagnostic_console.ts';
import { expect, test as testCase } from 'vitest';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessments,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  uploadsTable,
  users,
} from '../lib/db/schema.ts';
import { saveAssessment } from './assessment_fixture.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import { assessmentArrangementCommandFixture } from './helpers/assessment_arrangement.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { requireContentWrite } from '../lib/services/roles.ts';
import { getQuestionRevisionHistory } from '../lib/services/questions.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { getUpload } from '../lib/uploads.ts';
import { uploadContentBankRoute as uploadHandlerEndpoint } from '../lib/http/routes/bank_api/upload_content.ts';
import { packageApiRoute as packageHandlerEndpoint } from '../lib/http/routes/assessment_api/package.ts';
import type { RequestContext } from '../lib/tenants.ts';
import type { ObjectStreamReader } from '../lib/storage_contract.ts';
import {
  type HttpEndpoint,
  invokeHttpMethod,
  invokeHttpRoute,
  makeHttpRequest,
} from './helpers/http_route.ts';
import { questionXmlFixture } from './question_xml_fixture.ts';

const uploadHandler = uploadHandlerEndpoint.handle;
const packageHandler = packageHandlerEndpoint.handle;

testCase('role enforcement blocks content writes for read-only roles', () => {
  const req = new Request('http://local/api/assessments/example/questions', { method: 'POST' });
  const denied = requireContentWrite('teaching_assistant', req);
  if (!(denied instanceof Response)) expect.unreachable('Expected denied instanceof Response');
  expect(denied.status).toStrictEqual(403);
  expect(requireContentWrite('instructor', req)).toStrictEqual(null);
});

testCase(
  'tenancy isolation blocks cross-tenant access to items, uploads, and exports',
  async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    const ctxA: RequestContext = { tenantId: tenantA, userId: userA, role: 'owner' };
    const ctxB: RequestContext = { tenantId: tenantB, userId: userB, role: 'owner' };

    let assessmentId: string | null = null;
    let questionBId: string | null = null;
    let uploadId: string | null = null;

    try {
      const emailA = `owner-a-${tenantA.slice(0, 8)}@example.com`;
      const emailB = `owner-b-${tenantB.slice(0, 8)}@example.com`;
      await db.insert(tenants).values([
        { id: tenantA, slug: `t-${tenantA.slice(0, 8)}`, name: 'Tenant A' },
        { id: tenantB, slug: `t-${tenantB.slice(0, 8)}`, name: 'Tenant B' },
      ]);
      await db.insert(users).values([
        { id: userA, email: emailA, emailNormalized: emailA },
        { id: userB, email: emailB, emailNormalized: emailB },
      ]);
      await db.insert(organizationMemberships).values([
        {
          id: crypto.randomUUID(),
          tenantId: tenantA,
          userId: userA,
          role: 'owner',
        },
        {
          id: crypto.randomUUID(),
          tenantId: tenantB,
          userId: userB,
          role: 'owner',
        },
      ]);

      const questionB = await saveQuestionRevisionFixture(ctxB, {
        title: 'Question B',
        body: { type: 'text_entry', title: 'Question B' },
        qtiXml: questionXmlFixture('tenant-b-item'),
        draftState: 'published',
        provenance: { _tag: 'Authored' },
      });
      questionBId = questionB.questionId;
      const questionBHistory = await getQuestionRevisionHistory(ctxB, questionBId);
      if (!questionBHistory) throw new Error('Expected tenant B question history.');
      expect(questionBHistory.origin).toStrictEqual({ _tag: 'Authored' });
      expect(questionBHistory.revisions[0]?.event.author).toStrictEqual({
        id: userB,
        displayName: null,
        email: emailB,
      });
      await db.delete(organizationMemberships).where(and(
        eq(organizationMemberships.tenantId, tenantB),
        eq(organizationMemberships.userId, userB),
      ));
      const historyAfterMembershipRemoval = await getQuestionRevisionHistory(ctxB, questionBId);
      if (!historyAfterMembershipRemoval) {
        throw new Error('Expected item history to retain its actor snapshot.');
      }
      expect(historyAfterMembershipRemoval.origin).toStrictEqual({ _tag: 'Authored' });
      expect(historyAfterMembershipRemoval.revisions[0]?.event.author).toStrictEqual({
        id: userB,
        displayName: null,
        email: emailB,
      });

      const assessment = await saveAssessment(ctxA, {
        blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
        title: 'Assessment A',
        parts: [{ title: 'Part 1', placements: [] }],
      });
      assessmentId = assessment.id;

      const crossTenant = await saveAssessmentParts(
        ctxA,
        assessmentId,
        await assessmentArrangementCommandFixture(ctxA, assessmentId, [{
          id: crypto.randomUUID(),
          title: 'Part 1',
          placements: [{ id: crypto.randomUUID(), itemId: questionBId }],
        }]),
      );
      if (crossTenant.ok) expect.unreachable('Expected !crossTenant.ok');
      expect(crossTenant.error.code).toStrictEqual('question_not_found');

      uploadId = crypto.randomUUID();
      await db.insert(uploadsTable).values({
        id: uploadId,
        tenantId: tenantA,
        name: 'tenant-a.txt',
        mimeType: 'text/plain',
        size: 3,
        path: '/tmp/tenant-a.txt',
        url: `/uploads/${uploadId}`,
        createdAt: new Date(),
      });

      let uploadReadCount = 0;
      const storage: ObjectStreamReader = {
        readObjectStream(key) {
          uploadReadCount += 1;
          expect(key).toStrictEqual('/tmp/tenant-a.txt');
          return Promise.resolve({
            body: new Response('abc').body!,
            contentLength: 3,
            contentType: 'text/plain',
            contentSha256: null,
          });
        },
      };

      const uploadReq = new Request(`http://local/uploads/${uploadId}`, { method: 'GET' });
      const uploadRes = await invokeHttpMethod(
        uploadHandler as HttpEndpoint,
        'GET',
        makeHttpRequest(uploadReq, {
          params: { id: uploadId },
          auth: ctxB,
          state: { storage },
        }),
      );
      expect(uploadRes.status).toStrictEqual(403);
      expect(uploadReadCount).toStrictEqual(0);

      const allowedUploadRes = await invokeHttpMethod(
        uploadHandler as HttpEndpoint,
        'GET',
        makeHttpRequest(uploadReq, {
          params: { id: uploadId },
          auth: ctxA,
          state: { storage },
        }),
      );
      expect(allowedUploadRes.status).toStrictEqual(200);
      expect(await allowedUploadRes.text()).toStrictEqual('abc');
      expect(uploadReadCount).toStrictEqual(1);

      let mismatchBodyCancelled = false;
      const diagnostics = diagnosticConsole();
      const mismatchedUploadRes = await invokeHttpMethod(
        uploadHandler as HttpEndpoint,
        'GET',
        makeHttpRequest(uploadReq, {
          params: { id: uploadId },
          auth: ctxA,
          state: {
            runtime: { diagnostics: diagnostics.console },
            storage: {
              readObjectStream() {
                return Promise.resolve({
                  body: new ReadableStream<Uint8Array>({
                    cancel() {
                      mismatchBodyCancelled = true;
                    },
                  }),
                  contentLength: 4,
                  contentType: 'application/octet-stream',
                  contentSha256: null,
                });
              },
            },
          },
        }),
      );
      expect(mismatchedUploadRes.status).toStrictEqual(500);
      expect(await mismatchedUploadRes.text()).toStrictEqual('Internal Server Error');

      expect(mismatchBodyCancelled).toStrictEqual(true);
      expect(diagnostics.text().trim()).toStrictEqual(
        'upload storage metadata mismatch ' + inspect(
          {
            tenantId: tenantA,
            uploadId,
            expectedContentLength: 3,
            actualContentLength: 4,
            expectedContentType: 'text/plain',
            actualContentType: 'application/octet-stream',
          },
          { depth: null, colors: false },
        ),
      );

      const exportReq = new Request(`http://local/api/assessments/${assessmentId}/package`, {
        method: 'GET',
      });
      const exportRes = await invokeHttpRoute(
        packageHandler,
        makeHttpRequest(exportReq, {
          params: { id: assessmentId! },
          auth: ctxB,
        }),
      );
      expect(exportRes.status).toStrictEqual(404);

      const uploadLookup = await getUpload(ctxA, uploadId);
      expect(uploadLookup.status).toStrictEqual('ok');
    } finally {
      try {
        if (assessmentId) {
          await db.delete(assessments).where(eq(assessments.id, assessmentId));
        }
        if (questionBId) {
          await db.delete(questionRevisions).where(eq(questionRevisions.questionId, questionBId));
          await db.delete(questions).where(eq(questions.id, questionBId));
        }
        if (uploadId) {
          await db.delete(uploadsTable).where(eq(uploadsTable.id, uploadId));
        }
        await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userA));
        await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userB));
        await db.delete(users).where(eq(users.id, userA));
        await db.delete(users).where(eq(users.id, userB));
        await db.delete(tenants).where(eq(tenants.id, tenantA));
        await db.delete(tenants).where(eq(tenants.id, tenantB));
      } catch (_) {
        // ignore cleanup errors
      }
      await shutdownDb().catch(() => {});
    }
  },
);
