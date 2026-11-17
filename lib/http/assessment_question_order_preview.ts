import { getDb } from '../db.ts';
import type { HttpHandler } from './route.ts';
import { requireAuthContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { AssessmentQuestionOrderPreviews } from '../services/assessment_question_order_preview.ts';

/** Generate a fresh author-only example for an exact saved version, without attempt persistence. */
export const questionOrderPreviewHandlers = {
  async GET(ctx) {
    const query = new URL(ctx.req.url).searchParams;
    const version = query.get('version');
    const headers = { 'cache-control': 'private, no-store' };
    if (
      !isCanonicalUuid(ctx.params.id) || !version || !/^[a-f0-9]{64}$/.test(version) ||
      query.getAll('version').length !== 1 || [...query.keys()].some((key) => key !== 'version')
    ) return Response.json({ error: 'invalid_input' }, { status: 400, headers });
    const result = await new AssessmentQuestionOrderPreviews(getDb(ctx)).preview(
      requireAuthContext(ctx.state),
      ctx.params.id,
      version,
      { seed: crypto.randomUUID(), signal: ctx.req.signal },
    );
    if (result.ok) return Response.json(result.value, { headers });
    const status = {
      forbidden: 403,
      assessment_not_found: 404,
      adaptive_managed: 422,
      stale_arrangement: 409,
      empty_assessment: 422,
      invalid_assessment: 422,
      ordering_unsupported: 422,
      cancelled: 408,
      preview_failed: 503,
    };
    return Response.json({ error: result.code }, { status: status[result.code], headers });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
