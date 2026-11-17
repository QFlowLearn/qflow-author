import { isCanonicalUuid } from './uuid.ts';

/** A final review is reusable only for its recorded revision and recorded people. */
export type EditorialReviewEvidence = {
  readonly kind: 'editorial_review';
  readonly requestId: string;
  readonly revisionId: string;
  readonly reviewerId: string;
  readonly revisionAuthorId: string;
  readonly decidedAt: string;
  readonly independence: 'self_review' | 'independent_review';
};
export type RevisionReviewDecision = {
  readonly revisionId: string;
  readonly requestId: string;
  readonly state: 'open' | 'approved' | 'changes_requested';
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
};
export type RevisionEligibility =
  & {
    readonly questionId: string;
    readonly revisionId: string;
    readonly revisionAuthorId: string;
    readonly intake: {
      readonly migrationRunId: string;
      readonly artifactId: string;
      readonly contentHash: string;
    } | null;
  }
  & (
    | { readonly kind: 'reviewed'; readonly evidence: EditorialReviewEvidence }
    | { readonly kind: 'attestation_required'; readonly review: RevisionReviewDecision | null }
  );

/** Conversion acceptance and prior edition attestations are deliberately not approval inputs. */
export function projectRevisionEligibility(input: {
  readonly questionId: string;
  readonly revisionId: string;
  readonly revisionAuthorId: string;
  readonly intake: RevisionEligibility['intake'];
  readonly review: RevisionReviewDecision | null;
}): RevisionEligibility {
  const { review, ...revision } = input;
  if (review && review.revisionId !== input.revisionId) {
    throw new Error('Review evidence must reference the exact revision.');
  }
  if (review?.state !== 'approved') return { ...revision, kind: 'attestation_required', review };
  return {
    ...revision,
    kind: 'reviewed',
    evidence: approvedReviewEvidence(input.revisionAuthorId, review),
  };
}

/** Reject incomplete approved decisions before either display or publication uses them. */
export function approvedReviewEvidence(
  revisionAuthorId: string,
  review: RevisionReviewDecision,
): EditorialReviewEvidence {
  if (review.state !== 'approved' || !review.decidedBy || !review.decidedAt) {
    throw new Error('Approved review is missing its recorded decision.');
  }
  return {
    kind: 'editorial_review',
    requestId: review.requestId,
    revisionId: review.revisionId,
    reviewerId: review.decidedBy,
    revisionAuthorId,
    decidedAt: review.decidedAt,
    independence: classifyReviewIndependence(revisionAuthorId, review.decidedBy),
  };
}

/** Exact set submitted once with freeze; no standing batch-review command accepts this contract. */
export type ManifestAttestation = {
  readonly operationId: string;
  readonly manifestDigest: string;
  readonly reason: string;
  readonly revisionIds: readonly string[];
  readonly overrides: readonly { readonly revisionId: string; readonly reason: string }[];
};
export type AttestationValidation =
  | { readonly ok: true; readonly attestation: ManifestAttestation }
  | {
    readonly ok: false;
    readonly code:
      | 'invalid_input'
      | 'manifest_changed'
      | 'wrong_revision_set'
      | 'override_required'
      | 'technical_blocker';
  };

/** Validate the whole server-owned manifest, not the visible page or a live bank query. */
export function validateManifestAttestation(input: unknown, manifest: {
  readonly digest: string;
  readonly revisions: readonly RevisionEligibility[];
  readonly technicalBlockers: readonly string[];
}): AttestationValidation {
  if (
    !object(input) ||
    !exact(input, ['operationId', 'manifestDigest', 'reason', 'revisionIds', 'overrides']) ||
    typeof input.operationId !== 'string' || !isCanonicalUuid(input.operationId) ||
    typeof input.manifestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.manifestDigest) ||
    !reason(input.reason) || !Array.isArray(input.revisionIds) || !Array.isArray(input.overrides)
  ) return { ok: false, code: 'invalid_input' };
  if (input.manifestDigest !== manifest.digest) return { ok: false, code: 'manifest_changed' };
  if (manifest.technicalBlockers.length) return { ok: false, code: 'technical_blocker' };
  const revisionIds: string[] = [];
  for (const id of input.revisionIds) {
    if (typeof id !== 'string' || !isCanonicalUuid(id) || revisionIds.includes(id)) {
      return { ok: false, code: 'invalid_input' };
    }
    revisionIds.push(id);
  }
  const required = manifest.revisions.filter((row) => row.kind === 'attestation_required');
  if (
    revisionIds.length !== required.length ||
    required.some((row) => !revisionIds.includes(row.revisionId))
  ) return { ok: false, code: 'wrong_revision_set' };
  const overrides: { revisionId: string; reason: string }[] = [];
  for (const entry of input.overrides) {
    if (
      !object(entry) || !exact(entry, ['revisionId', 'reason']) ||
      typeof entry.revisionId !== 'string' ||
      !isCanonicalUuid(entry.revisionId) || !reason(entry.reason) ||
      overrides.some((row) => row.revisionId === entry.revisionId)
    ) return { ok: false, code: 'invalid_input' };
    overrides.push({ revisionId: entry.revisionId, reason: entry.reason.trim() });
  }
  const changesRequested = required.filter((row) =>
    row.kind === 'attestation_required' && row.review?.state === 'changes_requested'
  );
  if (
    overrides.length !== changesRequested.length ||
    changesRequested.some((row) =>
      !overrides.some((override) => override.revisionId === row.revisionId)
    )
  ) return { ok: false, code: 'override_required' };
  return {
    ok: true,
    attestation: {
      operationId: input.operationId,
      manifestDigest: input.manifestDigest,
      reason: input.reason.trim(),
      revisionIds: revisionIds.sort(),
      overrides: overrides.sort((a, b) => a.revisionId.localeCompare(b.revisionId)),
    },
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function reason(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 4000;
}

/** Compare recorded people, never current ownership or grant administration. */
export function classifyReviewIndependence(
  authorId: string,
  reviewerId: string,
): EditorialReviewEvidence['independence'] {
  if (!authorId || !reviewerId) throw new Error('Review evidence requires recorded people.');
  return authorId === reviewerId ? 'self_review' : 'independent_review';
}

/** Immutable record persisted with the frozen edition by step 05, in the same transaction. */
export type PublisherAttestationEvidence = {
  readonly kind: 'publisher_attestation';
  readonly editionId: string;
  readonly actorId: string;
  readonly attestedAt: string;
  readonly confirmation: ManifestAttestation;
  readonly revisions: readonly {
    readonly questionId: string;
    readonly revisionId: string;
    readonly revisionAuthorId: string;
    readonly intake: RevisionEligibility['intake'];
  }[];
};
