import {
  parseAssessmentCreateRequest,
  parseAssessmentListLimit,
} from '../../assessment_requests.ts';
import { createAssessmentDraft, listAssessments } from '../../../services/assessment_records.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const listApiRoute = defineHttpRoute('/api/assessments', { 'GET': handle, 'POST': handle });

async function handle(ctx: HttpRequest) {
  const { req, url } = ctx;
  const auth = requireAuthContext(ctx.state);
  if (req.method === 'GET') {
    // Return recent assessments for quick switching in the left nav
    const parsed = parseAssessmentListLimit(url.searchParams.get('limit'));
    if (parsed._tag === 'Invalid') return new Response(parsed.message, { status: 400 });
    const summaries = await listAssessments(auth, parsed.value);
    return new Response(JSON.stringify({ assessments: summaries }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  if (req.method === 'POST') {
    const parsed = await parseAssessmentCreateRequest(req);
    if (parsed._tag === 'Invalid') return new Response(parsed.message, { status: 400 });
    const created = await createAssessmentDraft(auth, parsed.value);
    if (created._tag === 'Rejected') {
      const status = created.code === 'forbidden'
        ? 403
        : created.code === 'assessment_not_found'
        ? 404
        : 409;
      return new Response(created.code, { status });
    }
    return new Response(JSON.stringify({ id: created.id }), {
      headers: { 'content-type': 'application/json' },
      status: 201,
    });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
