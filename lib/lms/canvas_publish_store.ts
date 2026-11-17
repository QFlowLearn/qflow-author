import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { assessmentCanvasPublishAttempts } from '../db/schema.ts';
import type { MaterializedAssessmentExport } from '../export/assessment_export_artifact.ts';
import { persistMaterializedAssessmentExportInTransaction } from '../export/assessment_export_receipt_store.ts';
import type { RequestContext } from '../tenants.ts';
import type { CanvasConnection, CanvasPublishTargetId } from './canvas_connection_types.ts';
import {
  CANVAS_PUBLISH_ACTION_REQUIRED_PHASES,
  CANVAS_PUBLISH_TERMINAL_PHASES,
  type CanvasPublishAttempt,
  type CanvasPublishDestination,
  type CanvasPublishId,
  type CanvasPublishTerminalCursor,
} from './canvas_publish_contract.ts';
import { canvasPublishDestinationColumns } from './canvas_publish_destination_storage.ts';
import {
  type CanvasPublishPersistenceFailure,
  canvasPublishPersistenceFailure,
} from './canvas_publish_persistence_failure.ts';
import type { RuntimeSource } from '../runtime.ts';
import {
  type CanvasPublishRow,
  parseCanvasPublishRow,
  selectCanvasPublishRow,
} from './canvas_publish_record.ts';

/** Result of loading one tenant- and assessment-scoped Canvas publish. */
export type FindCanvasPublishAttemptResult =
  | { readonly ok: true; readonly attempt: CanvasPublishAttempt }
  | { readonly ok: false; readonly error: { readonly _tag: 'CanvasPublishNotFound' } }
  | { readonly ok: false; readonly error: CanvasPublishPersistenceFailure };

/** Result of loading lossless recovery work and one page of terminal Canvas history. */
export type ListCanvasPublishAttemptsResult =
  | {
    readonly ok: true;
    readonly actionRequired: readonly CanvasPublishAttempt[];
    readonly terminal: readonly CanvasPublishAttempt[];
    readonly nextTerminalCursor: CanvasPublishTerminalCursor | null;
  }
  | { readonly ok: false; readonly error: CanvasPublishPersistenceFailure };

/** Options for terminal Canvas publish pagination and persistence runtime selection. */
export type ListCanvasPublishAttemptsOptions = {
  readonly terminalCursor?: CanvasPublishTerminalCursor | null;
  readonly runtime?: RuntimeSource;
};

/** Result of atomically persisting an export receipt and its first Canvas publish state. */
export type PrepareCanvasPublishAttemptResult =
  | {
    readonly ok: true;
    readonly disposition: 'created' | 'replayed';
    readonly attempt: CanvasPublishAttempt;
  }
  | {
    readonly ok: false;
    readonly error:
      | {
        readonly _tag: 'CanvasPublishIdempotencyConflict';
        readonly message: 'The Idempotency-Key was already used for another Canvas publish.';
      }
      | CanvasPublishPersistenceFailure;
  };

/** Atomically persists one export receipt and its package-backed Canvas publish aggregate. */
export async function prepareCanvasPublishAttempt(
  auth: RequestContext,
  input: {
    readonly publishId: CanvasPublishId;
    readonly assessmentId: string;
    readonly connection: CanvasConnection;
    readonly targetId: 'canvas-classic' | 'canvas-new-quizzes';
    readonly destination: CanvasPublishDestination;
    readonly requestFingerprint: string;
    readonly export: MaterializedAssessmentExport;
  },
  runtime?: RuntimeSource,
): Promise<PrepareCanvasPublishAttemptResult> {
  const db = getDb(runtime);
  try {
    return await db.transaction(async (tx) => {
      const existing = await selectCanvasPublishRow(
        tx,
        auth,
        input.assessmentId,
        input.publishId,
      );
      if (existing) return replayOrConflict(existing, input.requestFingerprint);

      await persistMaterializedAssessmentExportInTransaction(
        tx,
        auth,
        input.export,
      );
      const exportReceipt = input.export.receipt;
      const artifact = input.export.artifact;
      const destination = canvasPublishDestinationColumns(input.destination);
      const createdAt = new Date(exportReceipt.createdAt);
      const inserted = await tx.insert(assessmentCanvasPublishAttempts).values({
        id: input.publishId,
        tenantId: auth.tenantId,
        assessmentId: input.assessmentId,
        createdBy: auth.userId,
        connectionId: input.connection.id,
        connectionName: input.connection.name,
        connectionBaseUrl: input.connection.baseUrl,
        targetId: input.targetId,
        destinationKind: destination.destinationKind,
        courseId: input.destination.courseId,
        questionBankId: destination.questionBankId,
        questionBankName: destination.questionBankName,
        requestFingerprint: input.requestFingerprint,
        exportReceiptId: exportReceipt.receiptId,
        artifactStorageKey: artifact.storageKey,
        artifactFilename: artifact.filename,
        artifactMediaType: artifact.mediaType,
        artifactSha256: artifact.sha256,
        artifactByteLength: artifact.byteLength,
        phase: 'prepared',
        attemptCount: 0,
        createdAt,
        updatedAt: createdAt,
      }).onConflictDoNothing({ target: assessmentCanvasPublishAttempts.id }).returning();
      if (!inserted[0]) throw new ConcurrentCanvasPublishReplay();
      return {
        ok: true,
        disposition: 'created',
        attempt: parseCanvasPublishRow(inserted[0]),
      };
    });
  } catch (cause: unknown) {
    if (cause instanceof ConcurrentCanvasPublishReplay) {
      try {
        const existing = await selectCanvasPublishRow(
          db,
          auth,
          input.assessmentId,
          input.publishId,
        );
        return existing
          ? replayOrConflict(existing, input.requestFingerprint)
          : canvasPublishPersistenceFailure(cause);
      } catch (lookupCause: unknown) {
        return canvasPublishPersistenceFailure(lookupCause);
      }
    }
    return canvasPublishPersistenceFailure(cause);
  }
}

/** Loads one durable Canvas publish without contacting Canvas. */
export async function findCanvasPublishAttempt(
  auth: RequestContext,
  assessmentId: string,
  publishId: CanvasPublishId,
  runtime?: RuntimeSource,
): Promise<FindCanvasPublishAttemptResult> {
  try {
    const row = await selectCanvasPublishRow(getDb(runtime), auth, assessmentId, publishId);
    return row
      ? { ok: true, attempt: parseCanvasPublishRow(row) }
      : { ok: false, error: { _tag: 'CanvasPublishNotFound' } };
  } catch (cause: unknown) {
    return canvasPublishPersistenceFailure(cause);
  }
}

/** Loads every action-required publish plus one stable page of terminal history. */
export async function listCanvasPublishAttempts(
  auth: RequestContext,
  assessmentId: string,
  targetId: CanvasPublishTargetId,
  options: ListCanvasPublishAttemptsOptions = {},
): Promise<ListCanvasPublishAttemptsResult> {
  try {
    const db = getDb(options.runtime);
    const scope = [
      eq(assessmentCanvasPublishAttempts.tenantId, auth.tenantId),
      eq(assessmentCanvasPublishAttempts.assessmentId, assessmentId),
      eq(assessmentCanvasPublishAttempts.targetId, targetId),
    ] as const;
    const terminalCursor = options.terminalCursor ?? null;
    const [actionRequiredRows, terminalRows] = await Promise.all([
      db.select().from(assessmentCanvasPublishAttempts).where(and(
        ...scope,
        inArray(assessmentCanvasPublishAttempts.phase, CANVAS_PUBLISH_ACTION_REQUIRED_PHASES),
      )).orderBy(
        desc(assessmentCanvasPublishAttempts.createdAt),
        desc(assessmentCanvasPublishAttempts.id),
      ),
      db.select().from(assessmentCanvasPublishAttempts).where(and(
        ...scope,
        inArray(assessmentCanvasPublishAttempts.phase, CANVAS_PUBLISH_TERMINAL_PHASES),
        terminalCursor === null ? undefined : or(
          lt(assessmentCanvasPublishAttempts.createdAt, terminalCursor.createdAt),
          and(
            eq(assessmentCanvasPublishAttempts.createdAt, terminalCursor.createdAt),
            lt(assessmentCanvasPublishAttempts.id, terminalCursor.publishId),
          ),
        ),
      )).orderBy(
        desc(assessmentCanvasPublishAttempts.createdAt),
        desc(assessmentCanvasPublishAttempts.id),
      ).limit(21),
    ]);
    const actionRequired = actionRequiredRows.map(parseCanvasPublishRow);
    const terminal = terminalRows.slice(0, 20).map(parseCanvasPublishRow);
    const lastTerminal = terminal[terminal.length - 1];
    return {
      ok: true,
      actionRequired,
      terminal,
      nextTerminalCursor: terminalRows.length > terminal.length && lastTerminal
        ? { createdAt: lastTerminal.createdAt, publishId: lastTerminal.id }
        : null,
    };
  } catch (cause: unknown) {
    return canvasPublishPersistenceFailure(cause);
  }
}

function replayOrConflict(
  row: CanvasPublishRow,
  requestFingerprint: string,
): PrepareCanvasPublishAttemptResult {
  if (row.requestFingerprint !== requestFingerprint) return idempotencyConflict();
  return { ok: true, disposition: 'replayed', attempt: parseCanvasPublishRow(row) };
}

function idempotencyConflict(): PrepareCanvasPublishAttemptResult {
  return {
    ok: false,
    error: {
      _tag: 'CanvasPublishIdempotencyConflict',
      message: 'The Idempotency-Key was already used for another Canvas publish.',
    },
  };
}

class ConcurrentCanvasPublishReplay extends Error {}
