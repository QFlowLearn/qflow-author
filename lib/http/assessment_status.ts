import type { HttpHandler, HttpRequest } from './route.ts';
import { getDb } from '../db.ts';
import { requireAuthContext } from '../tenants.ts';
import { resolveStorage } from '../storage.ts';
import { fetchDeliveryAssessmentStatus } from '../delivery_launch.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { AssessmentStatusQueries } from '../services/assessment_status_queries.ts';

const headers = { 'cache-control': 'no-store' };

/** Resolve request-owned resources and translate the existing delivery adapter's rejection. */
function statusQueries(ctx: HttpRequest) {
  return new AssessmentStatusQueries(getDb(ctx), () => resolveStorage(ctx), async (input) => {
    try {
      return { ok: true, value: await fetchDeliveryAssessmentStatus(input) };
    } catch {
      // Preserve the status endpoint's existing unavailable response, without exposing remote errors.
      return { ok: false, code: 'delivery_unavailable' };
    }
  });
}

function accessFailure(code: 'forbidden' | 'not_found'): Response {
  return code === 'forbidden'
    ? new Response('Forbidden', { status: 403 })
    : new Response('Not found', { status: 404 });
}

/** Parse HTTP input and project the authorized publication result without persistence in routes. */
export const publicationStatusHandlers = {
  async GET(ctx) {
    const id = ctx.params.id;
    if (!isCanonicalUuid(id)) return new Response('Not found', { status: 404 });
    const auth = requireAuthContext(ctx.state);
    const mode = ctx.url.searchParams.get('review') === '1' ? 'review' : 'status';
    const result = await statusQueries(ctx).publication(auth, id, mode);
    return result.ok ? Response.json(result.value, { headers }) : accessFailure(result.code);
  },
} satisfies Readonly<Record<string, HttpHandler>>;

/** Keep delivery success and expected failure responses stable at the HTTP boundary. */
export const deliveryStatusHandlers = {
  async GET(ctx) {
    const id = ctx.params.id;
    if (!isCanonicalUuid(id)) return new Response('Not found', { status: 404 });
    const auth = requireAuthContext(ctx.state);
    const result = await statusQueries(ctx).delivery(auth, id);
    if (result.ok) return Response.json(result.value, { headers });
    switch (result.code) {
      case 'forbidden':
      case 'not_found':
        return accessFailure(result.code);
      case 'not_published':
        return new Response('Not published', { status: 409 });
      case 'delivery_unavailable':
        return Response.json({ error: 'delivery_status_unavailable' }, { status: 502, headers });
    }
  },
} satisfies Readonly<Record<string, HttpHandler>>;
