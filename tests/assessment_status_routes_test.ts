import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessments, organizationMemberships } from '../lib/db/schema.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { deleteAssessment, saveAssessment } from './assessment_fixture.ts';
import { signDeliveryValue } from '../lib/delivery_signature.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { publicationStatusApiRoute as publicationEndpoint } from '../lib/http/routes/assessment_api/publication_status.ts';
import { deliveryStatusApiRoute as deliveryEndpoint } from '../lib/http/routes/assessment_api/delivery_status.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';

const publication = publicationEndpoint.handle;
const delivery = deliveryEndpoint.handle;

function request(
  handler: typeof publication,
  auth: RequestContext,
  id: string,
  review = false,
  storage = false,
) {
  const req = new Request(
    `http://localhost/api/assessments/${id}/status${review ? '?review=1' : ''}`,
  );
  return invokeHttpMethod(
    handler,
    'GET',
    makeHttpRequest(req, {
      auth,
      params: { id },
      state: storage ? { storage: createMemoryObjectStorage() } : {},
    }),
  );
}

testCase('status routes reject invalid IDs before resolving request resources', async () => {
  for (const handler of [publication, delivery]) {
    const response = await invokeHttpMethod(
      handler,
      'GET',
      makeHttpRequest(
        new Request('http://localhost/api/assessments/invalid/status'),
        { omitAuth: true, params: { id: 'invalid' } },
      ),
    );
    expect(response.status).toStrictEqual(404);
    expect(await response.text()).toStrictEqual('Not found');
  }
});

testCase(
  'status routes retain tenant isolation, current membership checks and unpublished responses',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const assessment = await saveAssessment(auth, {
          title: 'Status boundary test',
          blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
        });
        try {
          for (const review of [false, true]) {
            const response = await request(publication, auth, assessment.id, review, review);
            expect(response.status).toStrictEqual(200);
            expect(response.headers.get('cache-control')).toStrictEqual('no-store');
            expect(await response.json()).toStrictEqual({ status: 'unavailable' });
          }
          const unpublished = await request(delivery, auth, assessment.id);
          expect(unpublished.status).toStrictEqual(409);
          expect(await unpublished.text()).toStrictEqual('Not published');
          await withEnrichmentWorkspace(async (other) => {
            for (
              const [handler, review] of [
                [publication, false],
                [publication, true],
                [delivery, false],
              ] as const
            ) {
              const response = await request(handler, other, assessment.id, review);
              expect(response.status).toStrictEqual(404);
              expect(await response.text()).toStrictEqual('Not found');
            }
          });
          await db.delete(organizationMemberships).where(
            eq(organizationMemberships.userId, auth.userId),
          );
          for (
            const [handler, review] of [
              [publication, false],
              [publication, true],
              [delivery, false],
            ] as const
          ) {
            // The stale owner context must not bypass revoked membership or resolve review storage.
            const response = await request(handler, auth, assessment.id, review);
            expect(response.status).toStrictEqual(403);
            expect(await response.text()).toStrictEqual('Forbidden');
          }
        } finally {
          // Fixture cleanup owns this assessment even after its actor's membership is revoked.
          await db.delete(assessments).where(eq(assessments.id, assessment.id));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'delivery route queries the exact published version over signed HTTP and preserves unavailable responses',
  async () => {
    const secret = 'local-status-route-test';
    const previousUrl = process.env['QFLOW_DELIVERY_STATE_URL'];
    const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
    let reply: 'valid' | 'http_failure' | 'wrong_version' | 'malformed' = 'valid';
    const received: unknown[] = [];
    const server = await startFetchServer(async (req) => {
      const body = await req.text();
      expect(req.headers.get('x-harbor-qflow-signature')).toStrictEqual(
        await signDeliveryValue(body, secret),
      );
      received.push(JSON.parse(body));
      if (reply === 'http_failure') {
        return new Response('private upstream diagnostic', { status: 500 });
      }
      if (reply === 'malformed') return new Response('{');
      return Response.json({
        assessmentVersionId: reply === 'wrong_version' ? 'wrong' : 'published-v1',
        draft: 2,
        active: 3,
        closed: 4,
      });
    });
    process.env['QFLOW_DELIVERY_STATE_URL'] = `http://127.0.0.1:${server.port}/status`;
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = secret;
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const assessment = await saveAssessment(auth, {
          title: 'Published status boundary test',
          blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
          metadata: {
            delivery: {
              latestPublish: {
                assessmentVersionId: 'published-v1',
                publishedAt: '2026-09-28T12:00:00Z',
              },
            },
          },
        });
        try {
          const response = await request(delivery, auth, assessment.id);
          expect(response.status).toStrictEqual(200);
          expect(response.headers.get('cache-control')).toStrictEqual('no-store');
          expect(await response.json()).toStrictEqual({
            assessmentVersionId: 'published-v1',
            draft: 2,
            active: 3,
            closed: 4,
          });
          expect(received).toStrictEqual([{
            scope: 'assessment-version',
            qflowTenantId: auth.tenantId,
            qflowAssessmentId: assessment.id,
            assessmentVersionId: 'published-v1',
          }]);
          for (const failure of ['http_failure', 'wrong_version', 'malformed'] as const) {
            reply = failure;
            const failed = await request(delivery, auth, assessment.id);
            expect(failed.status).toStrictEqual(502);
            expect(failed.headers.get('cache-control')).toStrictEqual('no-store');
            expect(await failed.json()).toStrictEqual({ error: 'delivery_status_unavailable' });
          }
          await db.update(assessments).set({ metadata: {} }).where(
            eq(assessments.id, assessment.id),
          );
          const unpublished = await request(delivery, auth, assessment.id);
          expect(unpublished.status).toStrictEqual(409);
          await unpublished.text();
          expect(received.length, 'An unpublished assessment never contacts delivery')
            .toStrictEqual(4);
        } finally {
          await deleteAssessment(auth, assessment.id);
        }
      });
    } finally {
      await server.close();
      await shutdownDb();
      if (previousUrl === undefined) delete process.env['QFLOW_DELIVERY_STATE_URL'];
      else process.env['QFLOW_DELIVERY_STATE_URL'] = previousUrl;
      if (previousSecret === undefined) delete process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
      else process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = previousSecret;
    }
  },
);
