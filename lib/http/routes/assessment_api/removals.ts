import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { placementRemovalResponse } from '../../assessment_placement_removal.ts';
import { assessmentPlacementRemovalService } from '../../../services/assessment_placement_removal.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { parseCanonicalUuid } from '../../../uuid.ts';

/** Read this author's recent persisted receipts so reload does not lose Undo. */
export const removalsApiRoute = defineHttpRoute('/api/assessments/:id/removals', { 'GET': handle });

async function handle(ctx: HttpRequest) {
  const id = parseCanonicalUuid(ctx.params.id);
  if (!id) return Response.json({ error: 'invalid_request' }, { status: 400 });
  return placementRemovalResponse(
    await assessmentPlacementRemovalService.list(requireAuthContext(ctx.state), id),
  );
}
