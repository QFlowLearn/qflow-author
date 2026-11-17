import { parseCanonicalUuid } from './uuid.ts';
import { parseAssessmentBlueprintId } from './assessment_blueprint.ts';
import type { PersistedDraft } from './persisted_draft.ts';

/** Restored placement and resolved content, with its authoritative following placement. */
export type RestoredAssessmentPlacement = {
  readonly receipt: PlacementRemovalReceipt;
  readonly placement: {
    readonly id: string;
    readonly partId: string;
    readonly itemId: string;
    readonly snapshotRev: number | null;
    readonly blueprintTargetId: string | null;
    readonly fixed: boolean;
    readonly position: number;
  };
  readonly beforePlacementId: string | null;
  readonly revision: number;
  readonly draft: PersistedDraft;
};

/** A retry-safe removal of the question revision the author actually saw. */
export type PlacementRemovalCommand = {
  readonly removalId: string;
  readonly expectedRevision: number;
};

/** A durable, actor-owned recovery receipt; timestamps use canonical UTC ISO strings. */
export type PlacementRemovalReceipt = {
  readonly id: string;
  readonly placementId: string;
  readonly partId: string;
  readonly itemId: string;
  readonly snapshotRev: number | null;
  readonly blueprintTargetId: string | null;
  readonly fixed: boolean;
  readonly position: number;
  readonly title: string;
  readonly removedAt: string;
  readonly expiresAt: string;
  readonly restoredAt: string | null;
};

/** Expected failures of saved-placement removal and recovery. */
export type PlacementRemovalFailure =
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'expired'
  | 'unavailable'
  | 'adaptive_managed'
  | 'storage_failed';

/** A saved-placement operation either commits its value or reports a semantic failure. */
export type PlacementRemovalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PlacementRemovalFailure };

/** Parse the complete removal command, rejecting unknown fields and malformed identities. */
export function parsePlacementRemovalCommand(value: unknown): PlacementRemovalCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(',') !== 'expectedRevision,removalId') return null;
  const removalId = parseCanonicalUuid(Reflect.get(value, 'removalId'));
  const expectedRevision = Reflect.get(value, 'expectedRevision');
  if (!removalId || !positiveInteger(expectedRevision)) return null;
  return { removalId, expectedRevision };
}

/** Parse one protocol or persisted receipt without trusting decoded JSON. */
export function parsePlacementRemovalReceipt(value: unknown): PlacementRemovalReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = parseCanonicalUuid(Reflect.get(value, 'id'));
  const placementId = parseCanonicalUuid(Reflect.get(value, 'placementId'));
  const partId = parseCanonicalUuid(Reflect.get(value, 'partId'));
  const itemId = parseCanonicalUuid(Reflect.get(value, 'itemId'));
  const snapshotRev = Reflect.get(value, 'snapshotRev');
  const blueprintTargetId = Reflect.get(value, 'blueprintTargetId');
  const fixed = Reflect.get(value, 'fixed');
  const position = Reflect.get(value, 'position');
  const title = Reflect.get(value, 'title');
  const removedAt = isoDate(Reflect.get(value, 'removedAt'));
  const expiresAt = isoDate(Reflect.get(value, 'expiresAt'));
  const rawRestoredAt = Reflect.get(value, 'restoredAt');
  const restoredAt = rawRestoredAt === null ? null : isoDate(rawRestoredAt);
  if (
    !id || !placementId || !partId || !itemId ||
    (snapshotRev !== null && !positiveInteger(snapshotRev)) ||
    (blueprintTargetId !== null &&
      parseAssessmentBlueprintId(blueprintTargetId) !== blueprintTargetId) ||
    typeof fixed !== 'boolean' || !positiveInteger(position) || typeof title !== 'string' ||
    !removedAt || !expiresAt || expiresAt <= removedAt ||
    (rawRestoredAt !== null && (!restoredAt || restoredAt < removedAt))
  ) return null;
  return {
    id,
    placementId,
    partId,
    itemId,
    snapshotRev,
    blueprintTargetId,
    fixed,
    position,
    title,
    removedAt,
    expiresAt,
    restoredAt,
  };
}

/** Exact ordered context after removal; a changed part must not be overwritten by Undo. */
export type PlacementRemovalOrder = readonly { readonly id: string; readonly position: number }[];

/** Parse the persisted order snapshot, rejecting duplicate identities and ambiguous positions. */
export function parsePlacementRemovalOrder(value: unknown): PlacementRemovalOrder | null {
  if (!Array.isArray(value)) return null;
  const order: { id: string; position: number }[] = [];
  for (const input of value) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const id = parseCanonicalUuid(Reflect.get(input, 'id'));
    const position = Reflect.get(input, 'position');
    if (!id || !positiveInteger(position) || order.some((row) => row.id === id)) return null;
    if (order.length && order[order.length - 1].position >= position) return null;
    order.push({ id, position });
  }
  return order;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString() === value ? value : null;
}
