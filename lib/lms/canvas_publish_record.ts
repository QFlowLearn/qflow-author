import { and, eq } from 'drizzle-orm';

import type { DbReadConnection } from '../db.ts';
import { assessmentCanvasPublishAttempts } from '../db/schema.ts';
import { parseAssessmentExportFinalReceiptId } from '../export/assessment_export_http.ts';
import { isSafeHttpsUrl, parseHttpsOrigin } from '../http_url.ts';
import type { RequestContext } from '../tenants.ts';
import { parseCanonicalUuid } from '../uuid.ts';
import { parseCanvasConnectionId } from './canvas_connection_types.ts';
import {
  type CanvasPublishAttempt,
  type CanvasPublishFailure,
  type CanvasPublishId,
  type CanvasPublishLease,
  type CanvasPublishReceipt,
  type CanvasPublishRemote,
  type CanvasPublishState,
  type CanvasRemoteIdentityResolution,
  parseCanvasPublishId,
  parseCanvasPublishReceipt,
} from './canvas_publish_contract.ts';
import { parseStoredCanvasPublishDestination } from './canvas_publish_destination_storage.ts';

/** Storage representation of one Canvas publish attempt before domain reconstruction. */
export type CanvasPublishRow = typeof assessmentCanvasPublishAttempts.$inferSelect;

/** Loads one raw Canvas publish row inside the required tenant and assessment scope. */
export async function selectCanvasPublishRow(
  db: DbReadConnection,
  auth: RequestContext,
  assessmentId: string,
  publishId: CanvasPublishId,
): Promise<CanvasPublishRow | null> {
  const rows = await db.select().from(assessmentCanvasPublishAttempts).where(and(
    eq(assessmentCanvasPublishAttempts.id, publishId),
    eq(assessmentCanvasPublishAttempts.tenantId, auth.tenantId),
    eq(assessmentCanvasPublishAttempts.assessmentId, assessmentId),
  )).limit(1);
  return rows[0] ?? null;
}

/** Reconstructs one Canvas publish aggregate and rejects contradictory persisted state. */
export function parseCanvasPublishRow(row: CanvasPublishRow): CanvasPublishAttempt {
  const id = parseCanvasPublishId(row.id);
  const connectionId = parseCanvasConnectionId(row.connectionId);
  const exportReceipt = parseAssessmentExportFinalReceiptId(row.exportReceiptId);
  const destination = parseStoredCanvasPublishDestination(row);
  const baseUrl = parseHttpsOrigin(row.connectionBaseUrl);
  const state = parseCanvasPublishState(row);
  if (
    !id ||
    !connectionId ||
    !exportReceipt.ok ||
    row.connectionName.length === 0 ||
    !baseUrl ||
    (row.targetId !== 'canvas-classic' && row.targetId !== 'canvas-new-quizzes') ||
    !destination ||
    !state ||
    !/^[0-9a-f]{64}$/.test(row.requestFingerprint) ||
    !/^[0-9a-f]{64}$/.test(row.artifactSha256) ||
    row.artifactStorageKey.length === 0 ||
    row.artifactFilename.length === 0 ||
    row.artifactMediaType.length === 0 ||
    !Number.isSafeInteger(row.artifactByteLength) ||
    row.artifactByteLength < 0 ||
    !Number.isSafeInteger(row.attemptCount) ||
    row.attemptCount < 0 ||
    (state._tag === 'Prepared' ? row.attemptCount !== 0 : row.attemptCount < 1) ||
    !isDate(row.createdAt) ||
    !isDate(row.updatedAt) ||
    (row.targetId === 'canvas-new-quizzes' && destination._tag === 'QuestionBank')
  ) throw new Error('Persisted Canvas publish attempt is invalid.');

  const attempt: CanvasPublishAttempt = {
    id,
    tenantId: row.tenantId,
    assessmentId: row.assessmentId,
    createdBy: row.createdBy,
    connection: { id: connectionId, name: row.connectionName, baseUrl },
    targetId: row.targetId,
    destination,
    requestFingerprint: row.requestFingerprint,
    exportReceiptId: exportReceipt.receiptId,
    artifact: {
      storageKey: row.artifactStorageKey,
      filename: row.artifactFilename,
      mediaType: row.artifactMediaType,
      sha256: row.artifactSha256,
      byteLength: row.artifactByteLength,
    },
    attemptCount: row.attemptCount,
    state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (state._tag === 'Published' && !receiptMatchesAttempt(state.receipt, attempt)) {
    throw new Error('Persisted Canvas publish receipt is inconsistent.');
  }
  return attempt;
}

function parseCanvasPublishState(row: CanvasPublishRow): CanvasPublishState | null {
  const lease = parseLease(row);
  const remote = parseRemote(row);
  const failure = parseFailure(row);
  const receipt = row.receipt === null ? null : parsePersistedReceipt(row.receipt);
  const startedAt = row.remoteCreationStartedAt;
  const publishedAt = row.publishedAt;
  const resolution = parseRemoteIdentityResolution(row);
  if (
    lease === undefined ||
    remote === undefined ||
    failure === undefined ||
    (startedAt !== null && !isDate(startedAt)) ||
    (publishedAt !== null && !isDate(publishedAt)) ||
    resolution === undefined
  ) return null;

  switch (row.phase) {
    case 'prepared':
      return noStateEvidence(lease, remote, failure, resolution, startedAt, receipt, publishedAt)
        ? { _tag: 'Prepared' }
        : null;
    case 'claiming-create':
      return lease && !remote && !failure && !resolution && !startedAt && !receipt && !publishedAt
        ? { _tag: 'ClaimingCreate', lease }
        : null;
    case 'creating':
      return lease && !remote && !failure && !resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'Creating', lease, startedAt }
        : null;
    case 'uploading':
      return lease && remote && !failure && !resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'Uploading', lease, remote }
        : null;
    case 'observing':
      return lease && remote && !failure && !resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'Observing', lease, remote }
        : null;
    case 'processing':
      return !lease && remote && !failure && !resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'Processing', remote }
        : null;
    case 'retry-create':
      return !lease && !remote && failure && !resolution && !startedAt && !receipt && !publishedAt
        ? { _tag: 'RetryCreate', failure }
        : null;
    case 'retry-upload':
      return !lease && remote && failure && !resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'RetryUpload', failure, remote }
        : null;
    case 'retry-observe':
      return !lease && remote && failure && !resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'RetryObserve', failure, remote }
        : null;
    case 'remote-identity-unknown':
      return !lease && !remote && failure && !resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'RemoteIdentityUnknown', failure, startedAt }
        : null;
    case 'remote-identity-resolved':
      return !lease && !remote && failure && resolution && startedAt && !receipt && !publishedAt
        ? { _tag: 'RemoteIdentityResolved', failure, startedAt, resolution }
        : null;
    case 'failed':
      return !lease && failure && !resolution && !receipt && !publishedAt
        ? { _tag: 'Failed', failure, remote, remoteCreationStartedAt: startedAt }
        : null;
    case 'published':
      return !lease && remote && !failure && !resolution && startedAt && receipt && publishedAt
        ? { _tag: 'Published', remote, receipt, publishedAt }
        : null;
    default:
      return null;
  }
}

function parseLease(row: CanvasPublishRow): CanvasPublishLease | null | undefined {
  if (row.leaseToken === null && row.leaseExpiresAt === null) return null;
  if (row.leaseToken === null || !isDate(row.leaseExpiresAt)) return undefined;
  return { token: row.leaseToken, expiresAt: row.leaseExpiresAt };
}

function parseRemote(row: CanvasPublishRow): CanvasPublishRemote | null | undefined {
  if (row.remoteMigrationId === null && row.remoteProgressUrl === null) return null;
  if (
    row.remoteMigrationId === null ||
    row.remoteMigrationId.length === 0 ||
    row.remoteProgressUrl === null ||
    !isSafeHttpsUrl(row.remoteProgressUrl)
  ) return undefined;
  return {
    contentMigrationId: row.remoteMigrationId,
    progressUrl: row.remoteProgressUrl,
    workflowState: row.remoteWorkflowState,
  };
}

function parseFailure(row: CanvasPublishRow): CanvasPublishFailure | null | undefined {
  if (row.failureCode === null && row.failureMessage === null) return null;
  if (
    row.failureCode === null ||
    row.failureCode.length === 0 ||
    row.failureMessage === null ||
    row.failureMessage.length === 0
  ) return undefined;
  return { code: row.failureCode, message: row.failureMessage };
}

function parseRemoteIdentityResolution(
  row: CanvasPublishRow,
): CanvasRemoteIdentityResolution | null | undefined {
  if (
    row.remoteIdentityResolution === null && row.remoteIdentityResolvedBy === null &&
    row.remoteIdentityResolvedAt === null
  ) return null;
  const resolvedBy = parseCanonicalUuid(row.remoteIdentityResolvedBy);
  if (
    (row.remoteIdentityResolution !== 'import-found' &&
      row.remoteIdentityResolution !== 'import-not-found') ||
    !resolvedBy || !isDate(row.remoteIdentityResolvedAt)
  ) return undefined;
  return {
    outcome: row.remoteIdentityResolution,
    resolvedBy,
    resolvedAt: row.remoteIdentityResolvedAt,
  };
}

function noStateEvidence(
  lease: CanvasPublishLease | null,
  remote: CanvasPublishRemote | null,
  failure: CanvasPublishFailure | null,
  resolution: CanvasRemoteIdentityResolution | null,
  startedAt: Date | null,
  receipt: CanvasPublishReceipt | null,
  publishedAt: Date | null,
): boolean {
  return !lease && !remote && !failure && !resolution && !startedAt && !receipt && !publishedAt;
}

function parsePersistedReceipt(document: string): CanvasPublishReceipt | null {
  try {
    return parseCanvasPublishReceipt(JSON.parse(document));
  } catch (_cause: unknown) {
    return null;
  }
}

function receiptMatchesAttempt(
  receipt: CanvasPublishReceipt,
  attempt: CanvasPublishAttempt,
): boolean {
  if (attempt.state._tag !== 'Published') return false;
  return receipt.publishId === attempt.id &&
    receipt.exportReceiptId === attempt.exportReceiptId &&
    receipt.assessmentId === attempt.assessmentId &&
    receipt.publishedBy === attempt.createdBy &&
    receipt.connection.id === attempt.connection.id &&
    receipt.connection.name === attempt.connection.name &&
    receipt.connection.baseUrl === attempt.connection.baseUrl &&
    receipt.targetId === attempt.targetId &&
    JSON.stringify(receipt.destination) === JSON.stringify(attempt.destination) &&
    JSON.stringify(receipt.artifact) === JSON.stringify({
        filename: attempt.artifact.filename,
        mediaType: attempt.artifact.mediaType,
        sha256: attempt.artifact.sha256,
        byteLength: attempt.artifact.byteLength,
      }) &&
    receipt.attemptCount === attempt.attemptCount &&
    receipt.remote.contentMigrationId === attempt.state.remote.contentMigrationId &&
    receipt.publishedAt === attempt.state.publishedAt.toISOString();
}

function isDate(input: unknown): input is Date {
  return input instanceof Date && !Number.isNaN(input.valueOf());
}
