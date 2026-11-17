import { deleteAssessment, getAssessment } from '../../../services/assessment_records.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const recordApiRoute = defineHttpRoute('/api/assessments/:id', {
  'GET': handle,
  'DELETE': handle,
});

async function handle(ctx: HttpRequest) {
  const { req, params } = ctx;
  const id = params.id;
  const auth = requireAuthContext(ctx.state);
  if (req.method === 'GET') {
    const record = await getAssessment(auth, id);
    if (!record) return new Response('Not Found', { status: 404 });
    const placements = record.parts.flatMap((part) => part.placements ?? []);
    const payload = {
      id: record.id,
      title: record.title,
      brief: record.brief,
      gradeLevel: record.gradeLevel,
      targetCount: record.targetCount,
      attachmentId: record.attachmentId,
      tags: record.tags,
      metadata: record.metadata,
      parts: record.parts,
      placements,
    };
    return new Response(JSON.stringify(payload), {
      headers: { 'content-type': 'application/json' },
    });
  }
  if (req.method === 'DELETE') {
    const deleted = await deleteAssessment(auth, id);
    if (deleted._tag === 'Rejected') {
      return new Response(deleted.code === 'forbidden' ? 'Forbidden' : 'Not Found', {
        status: deleted.code === 'forbidden' ? 403 : 404,
      });
    }
    return new Response(null, { status: 204 });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
