/** Explicit publisher intent; freeze alone constructs the complete revision evidence set. */
export type FreezeConfirmation = {
  readonly reason: string;
  readonly overrides: readonly { readonly revisionId: string; readonly reason: string }[];
};
function parseConfirmation(value: unknown): FreezeConfirmation | null {
  if (
    !record(value) || !exact(value, ['reason', 'overrides']) ||
    !bounded(value.reason, 4000, true) || !Array.isArray(value.overrides)
  ) return null;
  const overrides: { revisionId: string; reason: string }[] = [];
  for (const entry of value.overrides) {
    if (
      !record(entry) || !exact(entry, ['revisionId', 'reason']) || !uuid(entry.revisionId) ||
      !bounded(entry.reason, 4000, true) ||
      overrides.some((row) => row.revisionId === entry.revisionId)
    ) return null;
    overrides.push({ revisionId: entry.revisionId, reason: entry.reason.trim() });
  }
  return { reason: value.reason.trim(), overrides };
}
import { bounded, digest, exact, positive, record, uuid, uuidList } from './bank_release.ts';
/** Every mutation names its observed version and digest; operation identity is actor-bound. */
export type ReleaseCommand =
  & {
    readonly releaseId: string;
    readonly operationId: string;
    readonly version: number;
    readonly digest: string;
  }
  & (
    | { readonly action: 'refresh'; readonly label: string; readonly notes: string }
    | { readonly action: 'keep'; readonly questionIds: readonly string[] }
    | {
      readonly action: 'exclude';
      readonly questionIds: readonly string[];
      readonly reason: string;
    }
    | { readonly action: 'freeze'; readonly attestation: FreezeConfirmation | null }
    | {
      readonly action: 'withdraw';
      readonly reason: string;
      readonly replacementId: string | null;
    }
    | { readonly action: 'restore'; readonly reason: string; readonly replacementId: string | null }
  );
/** Reject extra, duplicate-at-HTTP, and malformed command fields before orchestration. */
export function parseReleaseCommand(value: unknown): ReleaseCommand | null {
  if (
    !record(value) || !uuid(value.releaseId) || !uuid(value.operationId) ||
    !positive(value.version) || !digest(value.digest)
  ) return null;
  const base = {
    releaseId: value.releaseId,
    operationId: value.operationId,
    version: value.version,
    digest: value.digest,
  };
  const keys = ['releaseId', 'operationId', 'version', 'digest', 'action'];
  switch (value.action) {
    case 'refresh':
      return exact(value, [...keys, 'label', 'notes']) && bounded(value.label, 160, true) &&
          bounded(value.notes, 4000)
        ? { ...base, action: value.action, label: value.label.trim(), notes: value.notes.trim() }
        : null;
    case 'keep':
      return exact(value, [...keys, 'questionIds']) && uuidList(value.questionIds) &&
          value.questionIds.length > 0
        ? { ...base, action: value.action, questionIds: value.questionIds }
        : null;
    case 'exclude':
      return exact(value, [...keys, 'questionIds', 'reason']) && uuidList(value.questionIds) &&
          value.questionIds.length > 0 && bounded(value.reason, 4000, true)
        ? {
          ...base,
          action: value.action,
          questionIds: value.questionIds,
          reason: value.reason.trim(),
        }
        : null;
    case 'freeze': {
      if (!exact(value, [...keys, 'attestation'])) return null;
      const attestation = value.attestation === null ? null : parseConfirmation(value.attestation);
      if (value.attestation !== null && attestation === null) return null;
      return { ...base, action: 'freeze', attestation };
    }
    case 'withdraw':
    case 'restore':
      return exact(value, [...keys, 'reason', 'replacementId']) &&
          bounded(value.reason, 4000, true) &&
          (value.replacementId === null || uuid(value.replacementId))
        ? {
          ...base,
          action: value.action,
          reason: value.reason.trim(),
          replacementId: value.replacementId,
        }
        : null;
    default:
      return null;
  }
}
