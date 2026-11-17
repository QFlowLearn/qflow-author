import { saveAssessmentParts } from '../../../services/assessment_arrangement_save.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { parseAssessmentArrangeHttpRequest } from '../../assessment_arrange_request.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const arrangeApiRoute = defineHttpRoute('/api/assessments/:id/arrange', { 'POST': handle });

async function handle(ctx: HttpRequest) {
  const { req, params } = ctx;

  const auth = requireAuthContext(ctx.state);
  const id = params.id;
  const parsed = await parseAssessmentArrangeHttpRequest(req);
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.error._tag, message: parsed.error.message },
      { status: 400, headers: { 'cache-control': 'private, no-store' } },
    );
  }

  try {
    const result = await saveAssessmentParts(auth, id, parsed.request);
    return Response.json(result, {
      status: result.ok ? 200 : result.error.status,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'assessment_parts_save_failed',
      assessmentId: id,
      cause: safeErrorSummary(cause),
    }));
    return new Response('Failed to save assessment parts', {
      status: 500,
      headers: { 'cache-control': 'private, no-store' },
    });
  }
}
