import { and, eq } from 'drizzle-orm';

import { db } from '../db.ts';
import { assessmentExportReceipts } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import {
  assessmentExportArtifactStorageKey,
  type MaterializedAssessmentExport,
  type MaterializedAssessmentExportArtifact,
} from './assessment_export_artifact.ts';
import type {
  AssessmentExportFinalReceiptId,
  AssessmentExportReceipt,
} from './assessment_export_final_receipt.ts';
import type { AssessmentExportRequirementSelection } from './assessment_export_http.ts';
import {
  parseAssessmentExportFinalReceiptId,
  parseAssessmentExportPreflightId,
} from './assessment_export_http.ts';
import {
  type AssessmentExportReceiptEvidence,
  parseAssessmentExportReceiptEvidence,
} from './assessment_export_receipt_evidence.ts';
import type { AssessmentExportPreflightId } from './assessment_export_preflight.ts';

declare const assessmentExportReceiptDocumentBrand: unique symbol;

/** JSON document whose schema and receipt identity were checked at the persistence boundary. */
export type AssessmentExportReceiptDocument = string & {
  readonly [assessmentExportReceiptDocumentBrand]: 'AssessmentExportReceiptDocument';
};

/** Transaction handle accepted by immutable materialized-export persistence. */
export type MaterializedAssessmentExportTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/** Typed persistence result for an immutable receipt and its exact package artifact. */
export type PersistMaterializedAssessmentExportResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag: 'MaterializedExportPersistenceFailed';
      readonly message: 'QFlowLearn could not record the approved export.';
      readonly cause: unknown;
    };
  };

/** Typed lookup result for one tenant-scoped immutable export receipt document. */
export type FindAssessmentExportReceiptResult =
  | { readonly ok: true; readonly document: AssessmentExportReceiptDocument }
  | { readonly ok: false; readonly error: { readonly _tag: 'ReceiptNotFound' } }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag: 'ReceiptLookupFailed';
      readonly message: 'QFlowLearn could not load the export receipt.';
      readonly cause: unknown;
    };
  };

/** Persisted, server-issued authority for the delivery runner to fetch one exact package. */
export type AssessmentExportRunnerAuthorization = {
  readonly receiptId: AssessmentExportFinalReceiptId;
  readonly preflightId: AssessmentExportPreflightId;
  readonly targetContractId: string;
  readonly warningCodes: readonly string[];
  readonly artifact: MaterializedAssessmentExportArtifact;
};

/** Typed result of resolving a receipt-bound delivery runner authorization. */
export type FindAssessmentExportRunnerAuthorizationResult =
  | { readonly ok: true; readonly authorization: AssessmentExportRunnerAuthorization }
  | { readonly ok: false; readonly error: { readonly _tag: 'AuthorizationNotFound' } }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag: 'AuthorizationLookupFailed';
      readonly message: 'QFlowLearn could not authorize the delivery package request.';
      readonly cause: unknown;
    };
  };

type PersistedAssessmentExportReceiptRow = {
  readonly id: string;
  readonly schema: string;
  readonly preflightId: string;
  readonly receipt: string;
};

type PersistedAssessmentExportReceipt = {
  readonly document: AssessmentExportReceiptDocument;
  readonly receiptId: AssessmentExportFinalReceiptId;
  readonly preflightId: AssessmentExportPreflightId;
  readonly evidence: AssessmentExportReceiptEvidence;
  readonly warningCodes: readonly string[];
};

/** Idempotently persists one immutable receipt and content-addressed artifact reference. */
export async function persistMaterializedAssessmentExport(
  auth: RequestContext,
  materialized: MaterializedAssessmentExport,
): Promise<PersistMaterializedAssessmentExportResult> {
  try {
    await db.transaction((tx) =>
      persistMaterializedAssessmentExportInTransaction(tx, auth, materialized)
    );
    return { ok: true };
  } catch (cause: unknown) {
    return {
      ok: false,
      error: {
        _tag: 'MaterializedExportPersistenceFailed',
        message: 'QFlowLearn could not record the approved export.',
        cause,
      },
    };
  }
}

/** Persists one immutable export aggregate inside a caller-owned transaction. */
export async function persistMaterializedAssessmentExportInTransaction(
  tx: MaterializedAssessmentExportTransaction,
  auth: RequestContext,
  materialized: MaterializedAssessmentExport,
): Promise<void> {
  const { receipt, artifact } = materialized;
  assertArtifactMatchesReceipt(auth, receipt, artifact);
  const document = JSON.stringify(receipt);
  const inserted = await tx.insert(assessmentExportReceipts).values({
    id: receipt.receiptId,
    tenantId: auth.tenantId,
    assessmentId: receipt.assessment.id,
    createdBy: auth.userId,
    authorizedBy: receipt.authorizedBy,
    preflightId: receipt.preflightId,
    targetId: receipt.target.destinationId,
    scoringSelection: scoringSelection(receipt),
    interactionSelection: interactionSelection(receipt),
    acknowledgementToken: receipt.acknowledgements[0]?.token ?? null,
    schema: receipt.schema,
    receipt: document,
    createdAt: new Date(receipt.createdAt),
  }).onConflictDoNothing({ target: assessmentExportReceipts.id }).returning({
    id: assessmentExportReceipts.id,
  });
  if (inserted.length === 0) {
    const existing = await tx.select({
      tenantId: assessmentExportReceipts.tenantId,
      assessmentId: assessmentExportReceipts.assessmentId,
      createdBy: assessmentExportReceipts.createdBy,
      authorizedBy: assessmentExportReceipts.authorizedBy,
      preflightId: assessmentExportReceipts.preflightId,
      targetId: assessmentExportReceipts.targetId,
      scoringSelection: assessmentExportReceipts.scoringSelection,
      interactionSelection: assessmentExportReceipts.interactionSelection,
      acknowledgementToken: assessmentExportReceipts.acknowledgementToken,
      createdAt: assessmentExportReceipts.createdAt,
      receipt: assessmentExportReceipts.receipt,
    }).from(assessmentExportReceipts).where(
      eq(assessmentExportReceipts.id, receipt.receiptId),
    ).limit(1);
    if (
      existing[0]?.tenantId !== auth.tenantId ||
      existing[0]?.assessmentId !== receipt.assessment.id ||
      existing[0]?.createdBy !== auth.userId ||
      existing[0]?.authorizedBy !== receipt.authorizedBy ||
      existing[0]?.preflightId !== receipt.preflightId ||
      existing[0]?.targetId !== receipt.target.destinationId ||
      existing[0]?.scoringSelection !== scoringSelection(receipt) ||
      existing[0]?.interactionSelection !== interactionSelection(receipt) ||
      existing[0]?.acknowledgementToken !== (receipt.acknowledgements[0]?.token ?? null) ||
      existing[0]?.createdAt?.toISOString() !== receipt.createdAt ||
      existing[0]?.receipt !== document
    ) {
      throw new Error('Export receipt identity collision.');
    }
  }
}

/** Resolves the immutable receipt fields that authorize a system delivery package fetch. */
export async function findAssessmentExportRunnerAuthorization(
  auth: RequestContext,
  assessmentId: string,
  receiptId: AssessmentExportFinalReceiptId,
): Promise<FindAssessmentExportRunnerAuthorizationResult> {
  try {
    const rows = await db.select({
      id: assessmentExportReceipts.id,
      schema: assessmentExportReceipts.schema,
      preflightId: assessmentExportReceipts.preflightId,
      receipt: assessmentExportReceipts.receipt,
    }).from(assessmentExportReceipts).where(and(
      eq(assessmentExportReceipts.id, receiptId),
      eq(assessmentExportReceipts.tenantId, auth.tenantId),
      eq(assessmentExportReceipts.assessmentId, assessmentId),
    )).limit(1);
    const row = rows[0];
    if (!row) return { ok: false, error: { _tag: 'AuthorizationNotFound' } };
    const receipt = decodePersistedAssessmentExportReceipt(row);
    return { ok: true, authorization: projectRunnerAuthorization(receipt, auth, assessmentId) };
  } catch (cause: unknown) {
    return {
      ok: false,
      error: {
        _tag: 'AuthorizationLookupFailed',
        message: 'QFlowLearn could not authorize the delivery package request.',
        cause,
      },
    };
  }
}

/** Loads and parses the identity envelope of a tenant-scoped immutable receipt document. */
export async function findAssessmentExportReceipt(
  auth: RequestContext,
  assessmentId: string,
  receiptId: AssessmentExportFinalReceiptId,
): Promise<FindAssessmentExportReceiptResult> {
  try {
    const rows = await db.select({
      id: assessmentExportReceipts.id,
      schema: assessmentExportReceipts.schema,
      preflightId: assessmentExportReceipts.preflightId,
      receipt: assessmentExportReceipts.receipt,
    }).from(assessmentExportReceipts).where(and(
      eq(assessmentExportReceipts.id, receiptId),
      eq(assessmentExportReceipts.tenantId, auth.tenantId),
      eq(assessmentExportReceipts.assessmentId, assessmentId),
    )).limit(1);
    const row = rows[0];
    if (!row) return { ok: false, error: { _tag: 'ReceiptNotFound' } };
    return {
      ok: true,
      document: decodePersistedAssessmentExportReceipt(row).document,
    };
  } catch (cause: unknown) {
    return {
      ok: false,
      error: {
        _tag: 'ReceiptLookupFailed',
        message: 'QFlowLearn could not load the export receipt.',
        cause,
      },
    };
  }
}

function projectRunnerAuthorization(
  receipt: PersistedAssessmentExportReceipt,
  auth: RequestContext,
  assessmentId: string,
): AssessmentExportRunnerAuthorization {
  const expectedStorageKey = assessmentExportArtifactStorageKey({
    tenantId: auth.tenantId,
    assessmentId,
    artifactSha256: receipt.evidence.package.sha256,
  });
  return {
    receiptId: receipt.receiptId,
    preflightId: receipt.preflightId,
    targetContractId: receipt.evidence.target.targetContractId,
    warningCodes: receipt.warningCodes,
    artifact: {
      storageKey: expectedStorageKey,
      filename: receipt.evidence.package.filename,
      mediaType: receipt.evidence.package.mediaType,
      sha256: receipt.evidence.package.sha256,
      byteLength: receipt.evidence.package.byteLength,
    },
  };
}

function decodePersistedAssessmentExportReceipt(
  row: PersistedAssessmentExportReceiptRow,
): PersistedAssessmentExportReceipt {
  const receiptId = parseAssessmentExportFinalReceiptId(row.id);
  const preflightId = parseAssessmentExportPreflightId(row.preflightId);
  const input: unknown = JSON.parse(row.receipt);
  const evidence = parseAssessmentExportReceiptEvidence(input);
  if (
    row.schema !== 'qflow.export-receipt.v1' ||
    !receiptId.ok ||
    !preflightId.ok ||
    !evidence.ok ||
    evidence.value.preflightId !== row.preflightId ||
    evidence.value.receiptId !== row.id
  ) {
    throw new Error('Persisted export receipt is invalid.');
  }
  return {
    // SAFETY: The canonical evidence parser and persisted row identity checks established this document.
    document: row.receipt as AssessmentExportReceiptDocument,
    receiptId: receiptId.receiptId,
    preflightId: preflightId.preflightId,
    evidence: evidence.value,
    warningCodes: evidence.value.acknowledgementWarningCodes,
  };
}

function assertArtifactMatchesReceipt(
  auth: RequestContext,
  receipt: AssessmentExportReceipt,
  artifact: MaterializedAssessmentExportArtifact,
): void {
  const expectedStorageKey = assessmentExportArtifactStorageKey({
    tenantId: auth.tenantId,
    assessmentId: receipt.assessment.id,
    artifactSha256: receipt.package.sha256,
  });
  if (
    artifact.storageKey !== expectedStorageKey ||
    artifact.filename !== receipt.package.filename ||
    artifact.mediaType !== receipt.package.mediaType ||
    artifact.sha256 !== receipt.package.sha256 ||
    artifact.byteLength !== receipt.package.byteLength
  ) {
    throw new Error('Export artifact does not match its immutable receipt.');
  }
}

function scoringSelection(
  receipt: AssessmentExportReceipt,
): AssessmentExportRequirementSelection['scoring'] {
  return receipt.requirements.scoring._tag === 'AutomaticScoringRequired'
    ? 'automatic'
    : 'manual-accepted';
}

function interactionSelection(
  receipt: AssessmentExportReceipt,
): AssessmentExportRequirementSelection['interaction'] {
  return receipt.requirements.interaction._tag === 'BehaviorMustBePreserved'
    ? 'preserve'
    : 'fallback-accepted';
}
