import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isQuestionTypeId } from '../../../types/registry.ts';
import { isCanonicalUuid } from '../../../uuid.ts';
import { authoringPreferencesService } from '../../../services/authoring_preferences.ts';
import { safeErrorSummary } from '../../../error_summary.ts';

export const preferencesApiRoute = defineHttpRoute('/api/assessments/:id/authoring-preferences', {
  'DELETE': handle,
});

async function handle(ctx: HttpRequest) {
  const input: unknown = await ctx.req.json().catch(() => null);
  if (
    !isCanonicalUuid(ctx.params.id) || !input || typeof input !== 'object' ||
    Array.isArray(input) || Object.keys(input).length !== 1 || !('typeId' in input) ||
    !isQuestionTypeId(input.typeId)
  ) return Response.json({ error: 'invalid_request' }, { status: 400 });
  try {
    const found = await authoringPreferencesService.reset(
      requireAuthContext(ctx.state),
      ctx.params.id,
      input.typeId,
    );
    return new Response(null, { status: found ? 204 : 404 });
  } catch (cause: unknown) {
    console.error('Authoring preferences reset failed', safeErrorSummary(cause));
    return Response.json({ error: 'reset_failed' }, { status: 500 });
  }
}
