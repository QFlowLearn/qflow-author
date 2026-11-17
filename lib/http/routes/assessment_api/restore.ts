import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { placementRemovalResponse } from '../../assessment_placement_removal.ts';
import { assessmentPlacementRemovalService } from '../../../services/assessment_placement_removal.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { parseCanonicalUuid } from '../../../uuid.ts';

/** Restore through the authorized structure transaction; retry never creates a second placement. */
export const restoreApiRoute = defineHttpRoute('/api/assessments/:id/removals/:rid', {
  'POST': handle,
});

async function handle(ctx: HttpRequest) {
  const id = parseCanonicalUuid(ctx.params.id), rid = parseCanonicalUuid(ctx.params.rid);
  if (!id || !rid) return Response.json({ error: 'invalid_request' }, { status: 400 });
  return placementRemovalResponse(
    await assessmentPlacementRemovalService.restore(requireAuthContext(ctx.state), id, rid),
  );
}
