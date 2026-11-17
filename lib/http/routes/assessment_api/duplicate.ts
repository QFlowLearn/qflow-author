import { duplicateAssessment } from '../../../services/assessment_records.ts';
import { defineHttpRoute } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const duplicateApiRoute = defineHttpRoute('/api/assessments/:id/duplicate', {
  '*': async (ctx) => {
    const { params } = ctx;
    if (ctx.req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const id = params.id;
    const auth = requireAuthContext(ctx.state);
    const result = await duplicateAssessment(auth, id);
    if (result._tag === 'Rejected') {
      return Response.json({
        error: result.code,
      }, {
        status: result.code === 'forbidden'
          ? 403
          : result.code === 'assessment_not_found'
          ? 404
          : 409,
        headers: { 'cache-control': 'private, no-store' },
      });
    }
    return Response.json(
      { id: result.id },
      { headers: { 'cache-control': 'private, no-store' }, status: 201 },
    );
  },
});
