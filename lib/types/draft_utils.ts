import type { Draft } from './draft.ts';
import {
  type DriverDraft,
  hydrateDriverDraft,
  type NormalizedTypeDriver,
  type QuestionTypeId,
  TYPE_DRIVERS,
} from './registry.ts';

export function resolveDriver(
  draft: Draft,
): { typeId: QuestionTypeId; driver: NormalizedTypeDriver } {
  const typeId = draft.type;
  if (!typeId) {
    throw new Error('Draft is missing required field: type');
  }
  const driver = TYPE_DRIVERS[typeId];
  if (!driver) {
    throw new Error(`Unsupported question type: ${typeId}`);
  }
  return { typeId, driver };
}

export function normalizeDraftForDriver<K extends QuestionTypeId>(
  typeId: K,
  rawDraft: Draft,
): DriverDraft<K> {
  return hydrateDriverDraft(typeId, { ...rawDraft, type: typeId });
}

/** Authoring UI fields that must not be stored on question revision bodies. */
export const RAIL_ONLY_DRAFT_FIELDS = ['allowPins', 'textEntryShowIdentifiers'] as const;

type RailOnlyDraftField = (typeof RAIL_ONLY_DRAFT_FIELDS)[number];

export const RAIL_ONLY_DRAFT_FIELD_SET: ReadonlySet<RailOnlyDraftField> = new Set(
  RAIL_ONLY_DRAFT_FIELDS,
);

/** Remove rail-only authoring UI fields before persistence or strict draft parsing. */
export function stripRailOnlyDraftFields(draft: Draft): Draft {
  let stripped: Draft | undefined;
  for (const field of RAIL_ONLY_DRAFT_FIELDS) {
    if (!Object.hasOwn(draft, field)) continue;
    stripped ??= { ...draft };
    Reflect.deleteProperty(stripped, field);
  }
  return stripped ?? draft;
}
