import {
  parsePlacementRemovalReceipt,
  type PlacementRemovalCommand,
  type PlacementRemovalFailure,
  type PlacementRemovalReceipt,
  type RestoredAssessmentPlacement,
} from '../assessment_placement_removal.ts';
import { parseCanonicalUuid } from '../uuid.ts';
import { parseValidPersistedDraft } from '../persisted_draft.ts';

/** A transport failure leaves the mutation's outcome uncertain until retry or reload. */
export type PlacementRecoveryClientFailure =
  | PlacementRemovalFailure
  | 'request_failed'
  | 'invalid_response';
/** Parsed recovery outcomes, never trusted decoded JSON. */
export type PlacementRecoveryClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PlacementRecoveryClientFailure };

/** Remove the selected revision with one stable command identity. */
export async function requestPlacementRemoval(
  assessmentId: string,
  placementId: string,
  command: PlacementRemovalCommand,
  signal: AbortSignal,
): Promise<PlacementRecoveryClientResult<PlacementRemovalReceipt>> {
  return await request(`/api/assessments/${assessmentId}/placements/${placementId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
    signal,
  }, (raw) => {
    const receipt = parsePlacementRemovalReceipt(raw);
    return receipt?.id === command.removalId && receipt.placementId === placementId &&
        receipt.restoredAt === null
      ? receipt
      : null;
  });
}

/** Read active actor-owned receipts without resetting their persisted expiry. */
export async function requestPlacementRemovalHistory(
  assessmentId: string,
  signal: AbortSignal,
): Promise<PlacementRecoveryClientResult<readonly PlacementRemovalReceipt[]>> {
  return await request(`/api/assessments/${assessmentId}/removals`, { signal }, (raw) => {
    if (!Array.isArray(raw)) return null;
    const receipts: PlacementRemovalReceipt[] = [];
    for (const input of raw) {
      const receipt = parsePlacementRemovalReceipt(input);
      if (
        !receipt || receipt.restoredAt !== null || receipts.some((row) => row.id === receipt.id)
      ) return null;
      receipts.push(receipt);
    }
    return receipts;
  });
}

/** Restore persisted membership; retry replays a committed restoration. */
export async function requestPlacementRestoration(
  assessmentId: string,
  removalId: string,
  signal: AbortSignal,
): Promise<PlacementRecoveryClientResult<RestoredAssessmentPlacement>> {
  return await request(`/api/assessments/${assessmentId}/removals/${removalId}`, {
    method: 'POST',
    signal,
  }, (raw) => {
    const restored = parseRestoredAssessmentPlacement(raw);
    return restored?.receipt.id === removalId ? restored : null;
  });
}

/** Parse the complete restoration projection, including its canonical draft and insertion anchor. */
export function parseRestoredAssessmentPlacement(raw: unknown): RestoredAssessmentPlacement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const receipt = parsePlacementRemovalReceipt(Reflect.get(raw, 'receipt'));
  const placement = Reflect.get(raw, 'placement');
  const before = Reflect.get(raw, 'beforePlacementId');
  const beforePlacementId = before === null ? null : parseCanonicalUuid(before);
  const revision = Reflect.get(raw, 'revision');
  if (
    !receipt?.restoredAt || !placement || typeof placement !== 'object' ||
    Array.isArray(placement) ||
    (before !== null && !beforePlacementId) ||
    typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
  ) return null;
  const selected = parsePlacementRemovalReceipt({
    ...receipt,
    placementId: Reflect.get(placement, 'id'),
    partId: Reflect.get(placement, 'partId'),
    itemId: Reflect.get(placement, 'itemId'),
    snapshotRev: Reflect.get(placement, 'snapshotRev'),
    blueprintTargetId: Reflect.get(placement, 'blueprintTargetId'),
    fixed: Reflect.get(placement, 'fixed'),
    position: Reflect.get(placement, 'position'),
  });
  if (
    !selected || selected.placementId !== receipt.placementId ||
    selected.itemId !== receipt.itemId ||
    selected.fixed !== receipt.fixed ||
    beforePlacementId === selected.placementId ||
    (selected.snapshotRev !== null && selected.snapshotRev !== revision)
  ) return null;
  try {
    return {
      receipt,
      beforePlacementId,
      revision,
      draft: parseValidPersistedDraft(Reflect.get(raw, 'draft')),
      placement: {
        id: selected.placementId,
        partId: selected.partId,
        itemId: selected.itemId,
        snapshotRev: selected.snapshotRev,
        blueprintTargetId: selected.blueprintTargetId,
        fixed: selected.fixed,
        position: selected.position,
      },
    };
  } catch (_cause: unknown) {
    return null;
  }
}

async function request<T>(
  url: string,
  init: RequestInit,
  parse: (raw: unknown) => T | null,
): Promise<PlacementRecoveryClientResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store' });
  } catch (_cause: unknown) {
    return { ok: false, code: 'request_failed' };
  }
  // Authentication/role middleware can reject before the recovery JSON adapter runs.
  const raw: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) return { ok: false, code: 'forbidden' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_response' };
  }
  if (Reflect.get(raw, 'ok') === false && !response.ok) {
    const code = Reflect.get(raw, 'code');
    switch (code) {
      case 'forbidden':
      case 'not_found':
      case 'conflict':
      case 'expired':
      case 'unavailable':
      case 'adaptive_managed':
      case 'storage_failed':
        return { ok: false, code };
    }
  }
  if (Reflect.get(raw, 'ok') === true && response.ok) {
    const value = parse(Reflect.get(raw, 'value'));
    if (value !== null) return { ok: true, value };
  }
  return { ok: false, code: 'invalid_response' };
}
