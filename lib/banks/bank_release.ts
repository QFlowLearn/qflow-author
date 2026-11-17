import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { projectRevisionEligibility, type RevisionEligibility } from '../publication_evidence.ts';

/** Explicit selection records whether a later latest revision must invalidate confirmation. */
export type ReleaseItem = {
  readonly questionId: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly title: string;
  readonly selection: 'current' | 'historical';
  readonly eligibility: RevisionEligibility;
  readonly previouslyShipped: boolean;
};
/** Complete ordered selection; pagination never participates in this document. */
export type ReleaseManifest = {
  readonly schema: 'qflow.bank-release.v1';
  readonly label: string;
  readonly notes: string;
  readonly collections: readonly { readonly id: string; readonly name: string }[];
  readonly items: readonly ReleaseItem[];
  readonly exclusions: readonly { readonly questionId: string; readonly reason: string }[];
  readonly preparation: null | {
    readonly id: string;
    readonly sha256: string;
    readonly byteLength: number;
  };
};
/** Expected failures at edition command boundaries. */
export type ReleaseFailureCode =
  | 'manifest_changed'
  | 'wrong_revision_set'
  | 'invalid_transition'
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'label_exists'
  | 'operation_conflict'
  | 'stale_preview'
  | 'invalid_selection'
  | 'frozen'
  | 'not_frozen'
  | 'withdrawn'
  | 'preparation_required'
  | 'preparation_conflict'
  | 'storage_failed'
  | 'technical_blocker'
  | 'attestation_required'
  | 'override_required';
/** Explicit service result with no ambiguous null failure. */
export type ReleaseResult<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly code: ReleaseFailureCode;
};
/** Bound all selection operations to a complete pilot-sized manifest, never a visible page. */
export const MAX_RELEASE_ITEMS = 1000;
/** Validated draft creation input. */
export type CreateRelease = {
  readonly id: string;
  readonly operationId: string;
  readonly label: string;
  readonly notes: string;
  readonly collectionIds: readonly string[];
  readonly questionIds: readonly string[];
};
/** Parse exact creation fields before any database work. */
export function parseCreateRelease(input: unknown): CreateRelease | null {
  if (
    !record(input) ||
    !exact(input, ['id', 'operationId', 'label', 'notes', 'collectionIds', 'questionIds']) ||
    !uuid(input.id) || !uuid(input.operationId) || !bounded(input.label, 160, true) ||
    !bounded(input.notes, 4000) ||
    !uuidList(input.collectionIds) || !uuidList(input.questionIds) ||
    input.collectionIds.length + input.questionIds.length === 0
  ) return null;
  return {
    id: input.id,
    operationId: input.operationId,
    label: input.label.trim(),
    notes: input.notes.trim(),
    collectionIds: input.collectionIds,
    questionIds: input.questionIds,
  };
}
/** Stable canonical digest includes labels, exact revisions, evidence, exclusions and retained bytes. */
export async function releaseManifestDigest(manifest: ReleaseManifest): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(canonicalJsonStringify(manifest)));
}
/** Parse retained JSON before it becomes a domain manifest. Corrupt persistence is a defect. */
export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (
    !record(value) || value.schema !== 'qflow.bank-release.v1' ||
    !bounded(value.label, 160, true) ||
    !bounded(value.notes, 4000) || !Array.isArray(value.collections) ||
    !Array.isArray(value.items) ||
    value.items.length === 0 || value.items.length > MAX_RELEASE_ITEMS ||
    !Array.isArray(value.exclusions)
  ) throw new Error('Invalid release manifest.');
  const collections = value.collections.map((row) => {
    if (!record(row) || !uuid(row.id) || !bounded(row.name, 160, true)) {
      throw new Error('Invalid release collection.');
    }
    return { id: row.id, name: row.name };
  });
  const items = value.items.map((row): ReleaseItem => {
    if (
      !record(row) || !uuid(row.questionId) || !uuid(row.revisionId) || !positive(row.revision) ||
      typeof row.title !== 'string' ||
      (row.selection !== 'current' && row.selection !== 'historical') ||
      typeof row.previouslyShipped !== 'boolean'
    ) throw new Error('Invalid release item.');
    const eligibility = parseEligibility(row.eligibility);
    if (eligibility.questionId !== row.questionId || eligibility.revisionId !== row.revisionId) {
      throw new Error('Release evidence references another revision.');
    }
    return {
      questionId: row.questionId,
      revisionId: row.revisionId,
      revision: row.revision,
      title: row.title,
      selection: row.selection,
      previouslyShipped: row.previouslyShipped,
      eligibility,
    };
  });
  if (new Set(items.map((row) => row.questionId)).size !== items.length) {
    throw new Error('Duplicate release question.');
  }
  const exclusions = value.exclusions.map((row) => {
    if (
      !record(row) || !uuid(row.questionId) || !bounded(row.reason, 4000, true) ||
      items.some((item) => item.questionId === row.questionId)
    ) throw new Error('Invalid release exclusion.');
    return { questionId: row.questionId, reason: row.reason };
  });
  let preparation: ReleaseManifest['preparation'] = null;
  const prep = value.preparation;
  if (prep !== null) {
    if (!record(prep) || !uuid(prep.id) || !digest(prep.sha256) || !positive(prep.byteLength)) {
      throw new Error('Invalid retained source identity.');
    }
    preparation = { id: prep.id, sha256: prep.sha256, byteLength: prep.byteLength };
  }
  return {
    schema: 'qflow.bank-release.v1',
    label: value.label,
    notes: value.notes,
    collections,
    items,
    exclusions,
    preparation,
  };
}

function parseEligibility(value: unknown): RevisionEligibility {
  if (
    !record(value) || !uuid(value.questionId) || !uuid(value.revisionId) ||
    !uuid(value.revisionAuthorId)
  ) throw new Error('Invalid release eligibility.');
  let intake: RevisionEligibility['intake'] = null;
  const rawIntake = value.intake;
  if (rawIntake !== null) {
    if (
      !record(rawIntake) || !uuid(rawIntake.migrationRunId) ||
      typeof rawIntake.artifactId !== 'string' || !digest(rawIntake.contentHash)
    ) throw new Error('Invalid intake evidence.');
    intake = {
      migrationRunId: rawIntake.migrationRunId,
      artifactId: rawIntake.artifactId,
      contentHash: rawIntake.contentHash,
    };
  }
  const revision = {
    questionId: value.questionId,
    revisionId: value.revisionId,
    revisionAuthorId: value.revisionAuthorId,
    intake,
  };
  if (value.kind === 'reviewed') {
    const e = value.evidence;
    if (
      !record(e) || e.kind !== 'editorial_review' || !uuid(e.requestId) ||
      e.revisionId !== revision.revisionId || e.revisionAuthorId !== revision.revisionAuthorId ||
      !uuid(e.reviewerId) || typeof e.decidedAt !== 'string' ||
      !Number.isFinite(Date.parse(e.decidedAt))
    ) throw new Error('Invalid approved evidence.');
    const projected = projectRevisionEligibility({
      ...revision,
      review: {
        revisionId: revision.revisionId,
        requestId: e.requestId,
        state: 'approved',
        decidedBy: e.reviewerId,
        decidedAt: e.decidedAt,
        note: null,
      },
    });
    if (projected.kind !== 'reviewed' || projected.evidence.independence !== e.independence) {
      throw new Error('Invalid review independence.');
    }
    return projected;
  }
  if (value.kind !== 'attestation_required') throw new Error('Invalid eligibility kind.');
  const r = value.review;
  if (r === null) return projectRevisionEligibility({ ...revision, review: null });
  if (
    !record(r) || r.revisionId !== revision.revisionId || !uuid(r.requestId) ||
    (r.state !== 'open' && r.state !== 'changes_requested') ||
    (r.decidedBy !== null && !uuid(r.decidedBy)) ||
    (r.decidedAt !== null &&
      (typeof r.decidedAt !== 'string' || !Number.isFinite(Date.parse(r.decidedAt)))) ||
    (r.note !== null && typeof r.note !== 'string')
  ) throw new Error('Invalid pending evidence.');
  return projectRevisionEligibility({
    ...revision,
    review: {
      revisionId: revision.revisionId,
      requestId: r.requestId,
      state: r.state,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt,
      note: r.note,
    },
  });
}
/** Bounded comparison reads saved manifests, independent of live bank edits. */
export function compareReleases(a: ReleaseManifest, b: ReleaseManifest) {
  const left = new Map(a.items.map((item, index) => [item.questionId, { item, index }]));
  const right = new Map(b.items.map((item, index) => [item.questionId, { item, index }]));
  return {
    added: b.items.filter((item) => !left.has(item.questionId)),
    removed: a.items.filter((item) => !right.has(item.questionId)),
    changed: b.items.flatMap((item) => {
      const before = left.get(item.questionId)?.item;
      return before && before.revisionId !== item.revisionId ? [{ before, after: item }] : [];
    }),
    reordered: b.items.filter((item, index) => {
      const before = left.get(item.questionId);
      return before && before.index !== index;
    }),
    metadataChanged: canonicalJsonStringify([a.label, a.notes, a.collections]) !==
      canonicalJsonStringify([b.label, b.notes, b.collections]),
  };
}
/** Shared primitive guards for the release boundary parsers. */
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && isCanonicalUuid(value);
}
export function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
export function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function bounded(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.trim().length <= max &&
    (!required || value.trim().length > 0);
}
export function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
export function uuidList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_RELEASE_ITEMS && value.every(uuid) &&
    new Set(value).size === value.length;
}
