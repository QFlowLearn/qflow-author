import { isCanonicalUuid } from './uuid.ts';

declare const DRAFT_SESSION_ID: unique symbol;

/** Canonical UUID that identifies one author-owned working draft. */
export type DraftSessionId = string & { readonly [DRAFT_SESSION_ID]: true };

/** Parses an untrusted working-draft identifier. */
export function parseDraftSessionId(value: unknown): DraftSessionId | null {
  if (!isCanonicalUuid(value)) return null;
  // SAFETY: isCanonicalUuid established the DraftSessionId representation.
  return value as DraftSessionId;
}

/** Creates a new canonical working-draft identifier. */
export function createDraftSessionId(): DraftSessionId {
  const id = parseDraftSessionId(crypto.randomUUID());
  if (!id) throw new Error('Generated working-draft identifier is invalid.');
  return id;
}
