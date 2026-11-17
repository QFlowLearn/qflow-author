import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { isCanonicalUuid } from '../../../uuid.ts';
import { parseAssessmentQuestionPointDefaultCommand } from '../../../assessment_question_defaults.ts';
import {
  readAssessmentQuestionPointDefault,
  saveAssessmentQuestionPointDefault,
} from '../../../services/assessment_question_defaults.ts';

/** Shared new-question policy; authentication and same-origin CSRF use the API middleware. */
export const questionDefaultsApiRoute = defineHttpRoute(
  '/api/assessments/:id/question-defaults',
  { GET: handle, PATCH: handle },
  { methodNotAllowedHeaders: { 'cache-control': 'private, no-store' } },
);

async function handle(ctx: HttpRequest) {
  const headers = { 'cache-control': 'private, no-store' };

  const auth = requireAuthContext(ctx.state);
  if (!isCanonicalUuid(ctx.params.id)) {
    return Response.json({ error: 'invalid_assessment_id' }, { status: 400, headers });
  }
  try {
    if (ctx.req.method === 'GET') {
      const result = await readAssessmentQuestionPointDefault(auth, ctx.params.id);
      return Response.json(result, { status: result._tag === 'Found' ? 200 : 404, headers });
    }
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch (_cause: unknown) {
      return Response.json({ error: 'invalid_default' }, { status: 400, headers });
    }
    const parsed = parseAssessmentQuestionPointDefaultCommand(body);
    if (parsed._tag === 'Invalid') {
      return Response.json({ error: 'invalid_default' }, { status: 400, headers });
    }
    const result = await saveAssessmentQuestionPointDefault(auth, ctx.params.id, parsed.command);
    const status = result._tag === 'Saved'
      ? 200
      : result.code === 'forbidden'
      ? 403
      : result.code === 'assessment_not_found'
      ? 404
      : result.code === 'stale_default'
      ? 409
      : 422;
    return Response.json(result, { status, headers });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'assessment_question_default_failed',
      assessmentId: ctx.params.id,
      cause: safeErrorSummary(cause),
    }));
    return Response.json({ error: 'default_unavailable' }, { status: 500, headers });
  }
}
