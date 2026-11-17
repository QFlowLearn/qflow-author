import { isCanonicalUuid } from './uuid.ts';

/** Only current, unread apply-run outcomes reach the notification surface. */
export type OrganizationNotice = {
  readonly runId: string;
  readonly executionId: string;
  readonly collection: string;
  readonly state: 'completed' | 'failed';
};
/** The response is bounded to five notices; total counts all current unread outcomes. */
export type OrganizationNoticeSnapshot = {
  readonly total: number;
  readonly notices: readonly OrganizationNotice[];
};
/** An acknowledgement names the exact execution the author saw. */
export type OrganizationNoticeAck = { readonly runId: string; readonly executionId: string };

/** Parse a bounded notification response before it reaches the UI. */
export function parseOrganizationNoticeSnapshot(raw: unknown): OrganizationNoticeSnapshot | null {
  if (
    typeof raw !== 'object' || raw === null ||
    Object.keys(raw).sort().join(',') !== 'notices,total' ||
    !('total' in raw) || typeof raw.total !== 'number' || !Number.isSafeInteger(raw.total) ||
    raw.total < 0 ||
    !('notices' in raw) || !Array.isArray(raw.notices) || raw.notices.length > 5 ||
    raw.total < raw.notices.length ||
    (raw.total > 0 && raw.notices.length === 0)
  ) return null;
  const notices: OrganizationNotice[] = [];
  for (const row of raw.notices) {
    if (typeof row !== 'object' || row === null || !('runId' in row) || !('executionId' in row)) {
      return null;
    }
    const ack = parseOrganizationNoticeAck({ runId: row.runId, executionId: row.executionId });
    if (
      !ack || typeof row !== 'object' || row === null || !('collection' in row) ||
      typeof row.collection !== 'string' || row.collection.length > 2000 || !('state' in row) ||
      (row.state !== 'completed' && row.state !== 'failed') ||
      Object.keys(row).sort().join(',') !== 'collection,executionId,runId,state'
    ) return null;
    notices.push({ ...ack, collection: row.collection, state: row.state });
  }
  if (new Set(notices.map((n) => n.executionId)).size !== notices.length) return null;
  return { total: raw.total, notices };
}

/** Reject unknown command fields and invalid identities at the HTTP boundary. */
export function parseOrganizationNoticeAck(
  raw: unknown,
): OrganizationNoticeAck | null {
  if (
    typeof raw !== 'object' || raw === null ||
    Object.keys(raw).sort().join(',') !== 'executionId,runId' ||
    !('runId' in raw) || typeof raw.runId !== 'string' || !isCanonicalUuid(raw.runId) ||
    !('executionId' in raw) || typeof raw.executionId !== 'string' ||
    !isCanonicalUuid(raw.executionId)
  ) return null;
  return { runId: raw.runId, executionId: raw.executionId };
}
