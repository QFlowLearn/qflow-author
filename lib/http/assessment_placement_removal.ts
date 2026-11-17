import type { PlacementRemovalResult } from '../assessment_placement_removal.ts';

/** Translate the recovery service's closed failures without disclosing stored question data. */
export function placementRemovalResponse<T>(result: PlacementRemovalResult<T>): Response {
  if (result.ok) return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  const statuses = {
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    expired: 410,
    unavailable: 422,
    adaptive_managed: 409,
    storage_failed: 503,
  } as const;
  return Response.json(result, {
    status: statuses[result.code],
    headers: { 'cache-control': 'no-store' },
  });
}
