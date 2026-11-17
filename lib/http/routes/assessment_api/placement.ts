import { parsePlacementRemovalCommand } from '../../../assessment_placement_removal.ts';
import { placementRemovalResponse } from '../../assessment_placement_removal.ts';
import { assessmentPlacementRemovalService } from '../../../services/assessment_placement_removal.ts';
import { parseCanonicalUuid } from '../../../uuid.ts';
import {
  AssessmentStructureError,
  pinPlacementToLatest,
  setPlacementFollowLatest,
  updatePlacementBlueprintTarget,
} from '../../../services/assessment_structure.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { AdaptiveAssessmentMembershipError } from '../../../services/assessment_membership.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const placementApiRoute = defineHttpRoute('/api/assessments/:id/placements/:pid', {
  'DELETE': handle,
  'PATCH': handle,
});

async function handle(ctx: HttpRequest) {
  const { req, params, url } = ctx;
  const id = params.id;
  const pid = params.pid;
  const auth = requireAuthContext(ctx.state);
  if (req.method === 'DELETE') {
    const assessmentId = parseCanonicalUuid(id), placementId = parseCanonicalUuid(pid);
    const command = parsePlacementRemovalCommand(await req.json().catch(() => null));
    if (!assessmentId || !placementId || !command) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    return placementRemovalResponse(
      await assessmentPlacementRemovalService.remove(auth, assessmentId, placementId, command),
    );
  }

  const action = url.searchParams.get('action') || '';

  try {
    if (action === 'upgrade' || action === 'pin-latest') {
      await pinPlacementToLatest(auth, id, pid);
    } else if (action === 'follow-latest') {
      await setPlacementFollowLatest(auth, id, pid);
    } else if (action === 'align-blueprint-target') {
      const value: unknown = await req.json().catch(() => null);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return Response.json({ error: 'Alignment must be a JSON object.' }, { status: 400 });
      }
      const input = value as Record<string, unknown>;
      if (
        Object.keys(input).length !== 1 || typeof input.blueprintTargetId !== 'string' ||
        !input.blueprintTargetId.trim()
      ) {
        return Response.json({ error: 'Choose a blueprint target.' }, { status: 400 });
      }
      await updatePlacementBlueprintTarget(auth, id, pid, input.blueprintTargetId.trim());
    } else {
      return new Response('Unknown action', { status: 400 });
    }
  } catch (cause: unknown) {
    if (
      cause instanceof AssessmentStructureError ||
      cause instanceof AdaptiveAssessmentMembershipError
    ) {
      return new Response(cause.message, { status: cause.status });
    }
    console.error(JSON.stringify({
      event: 'assessment_placement_update_failed',
      assessmentId: id,
      placementId: pid,
      action,
      cause: safeErrorSummary(cause),
    }));
    return new Response('Failed to update placement', { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
}
