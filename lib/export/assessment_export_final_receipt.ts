import type { AssessmentTranscodeEvidence } from './assessment.ts';
import type { AuthorizedAssessmentExport } from './assessment_export_authorization.ts';
import type { AssessmentExportFidelityReceipt } from './assessment_export_receipt.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflight,
  AssessmentExportPreflightItem,
} from './assessment_export_preflight.ts';
import type { ExportActorId } from './assessment_export_requirements.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';

declare const assessmentExportFinalReceiptIdBrand: unique symbol;

/** Full-content-addressed identity of one final authorized export receipt. */
export type AssessmentExportFinalReceiptId = string & {
  readonly [assessmentExportFinalReceiptIdBrand]: 'AssessmentExportFinalReceiptId';
};

/** Warning acceptance bound to one preflight, warning set, and authenticated author. */
export type AssessmentExportWarningAcknowledgement = {
  readonly token: AssessmentExportAcknowledgementToken;
  readonly warningCodes: readonly string[];
  readonly acceptedBy: ExportActorId;
};

/** Immutable record of one package that passed destination-aware export policy. */
export type AssessmentExportReceipt = {
  readonly schema: 'qflow.export-receipt.v1';
  readonly receiptId: AssessmentExportFinalReceiptId;
  readonly createdAt: string;
  readonly preflightId: AssessmentExportPreflight['preflightId'];
  readonly fidelityReceiptId: AssessmentExportFidelityReceipt['receiptId'];
  readonly authorizedBy: ExportActorId;
  readonly assessment: {
    readonly id: string;
    readonly canonicalRevisionId: string;
    readonly canonicalStandard: 'QTI 3.0';
    readonly canonicalPackageSha256: string;
  };
  readonly target: AssessmentExportFidelityReceipt['target'];
  readonly validation: AssessmentExportFidelityReceipt['validation'];
  readonly evidence: AssessmentExportFidelityReceipt['evidence'];
  readonly requirements: AssessmentExportPreflight['requirements'];
  readonly overallOutcome: Exclude<AssessmentExportPreflight['overallOutcome'], 'blocked'>;
  readonly items: readonly Exclude<AssessmentExportPreflightItem, { readonly _tag: 'Blocked' }>[];
  readonly packageDiagnosticCodes: readonly string[];
  readonly transcodeEvidence: AssessmentTranscodeEvidence | null;
  readonly acknowledgements: readonly AssessmentExportWarningAcknowledgement[];
  readonly package: AssessmentExportFidelityReceipt['artifact'];
};

type CreateAssessmentExportReceiptInput = {
  readonly authorizedExport: AuthorizedAssessmentExport;
  readonly createdAt: Date;
};

/** Creates a full-content-addressed immutable receipt from the shared authorization proof. */
export async function createAssessmentExportReceipt(
  input: CreateAssessmentExportReceiptInput,
): Promise<AssessmentExportReceipt> {
  const { preflight, fidelityReceipt, authorizedBy, acknowledgementToken } = input.authorizedExport;
  const receiptItems = preflight.items.flatMap((item) => item._tag === 'Blocked' ? [] : [item]);
  const acceptedWarningToken = preflight.overallOutcome === 'warning' ? acknowledgementToken : null;
  if (preflight.overallOutcome === 'warning' && acceptedWarningToken === null) {
    throw new Error('Authorized warning export is missing its acknowledgement token.');
  }
  const recordedAcknowledgements: readonly AssessmentExportWarningAcknowledgement[] =
    acceptedWarningToken
      ? [{
        token: acceptedWarningToken,
        warningCodes: preflight.warningCodes,
        acceptedBy: authorizedBy,
      }]
      : [];
  const createdAt = input.createdAt.toISOString();
  const payload = {
    schema: 'qflow.export-receipt.v1',
    createdAt,
    preflightId: preflight.preflightId,
    fidelityReceiptId: fidelityReceipt.receiptId,
    authorizedBy,
    assessment: {
      id: preflight.assessmentId,
      canonicalRevisionId: preflight.canonicalRevisionId,
      canonicalStandard: 'QTI 3.0' as const,
      canonicalPackageSha256: preflight.canonicalPackageSha256,
    },
    target: fidelityReceipt.target,
    validation: fidelityReceipt.validation,
    evidence: fidelityReceipt.evidence,
    requirements: preflight.requirements,
    overallOutcome: preflight.overallOutcome,
    items: receiptItems,
    packageDiagnosticCodes: preflight.packageDiagnosticCodes,
    transcodeEvidence: fidelityReceipt.transcodeEvidence,
    acknowledgements: recordedAcknowledgements,
    package: fidelityReceipt.artifact,
  } satisfies Omit<AssessmentExportReceipt, 'receiptId'>;
  const receiptId = await createFinalReceiptId(
    new TextEncoder().encode(canonicalJsonStringify(payload)),
  );
  return { ...payload, receiptId };
}

async function createFinalReceiptId(identity: Uint8Array): Promise<AssessmentExportFinalReceiptId> {
  const digest = await sha256Hex(identity);
  // SAFETY: sha256Hex establishes the 64-character lowercase hexadecimal invariant.
  return digest as AssessmentExportFinalReceiptId;
}
