import { sha256Hex } from '../sha256.ts';
import type { AssessmentExportReceipt } from './assessment_export_final_receipt.ts';
import {
  resolveAssessmentExportTarget,
  type SelectableAssessmentExportTarget,
} from './assessment_export_targets.ts';
import {
  parseQti3AccessibilityReport,
  type Qti3AccessibilityReport,
} from '../qti3_accessibility.ts';

/** Receipt fields that constitute portable evidence for one generated export artifact. */
export type AssessmentExportReceiptEvidence = {
  readonly receiptId: AssessmentExportReceipt['receiptId'];
  readonly preflightId: AssessmentExportReceipt['preflightId'];
  readonly target: SelectableAssessmentExportTarget;
  readonly package: AssessmentExportReceipt['package'];
  readonly packageDiagnosticCodes: readonly string[];
  readonly acknowledgementWarningCodes: readonly string[];
  readonly evidence: AssessmentExportReceipt['evidence'];
  readonly validation: {
    readonly runtimeContract: 'xml-well-formed@1';
    readonly qti3Conformance: 'NotRun';
    readonly accessibility: Qti3AccessibilityReport;
  };
};

/** Stable parse failure returned when a serialized receipt cannot establish its evidence contract. */
export type InvalidAssessmentExportReceiptEvidence = {
  readonly _tag: 'InvalidAssessmentExportReceiptEvidence';
  readonly path: string;
  readonly message: string;
};

/** Result of parsing the evidence-bearing fields from a serialized final export receipt. */
export type AssessmentExportReceiptEvidenceParseResult =
  | { readonly ok: true; readonly value: AssessmentExportReceiptEvidence }
  | { readonly ok: false; readonly error: InvalidAssessmentExportReceiptEvidence };

/** Stable verification failure returned when downloaded bytes disagree with their receipt. */
export type AssessmentExportArtifactVerificationFailure = {
  readonly _tag: 'AssessmentExportArtifactMismatch';
  readonly field: 'byteLength' | 'sha256';
  readonly expected: string | number;
  readonly actual: string | number;
  readonly message: string;
};

/** Result of binding downloaded bytes to the package identity recorded in a parsed receipt. */
export type AssessmentExportArtifactVerificationResult =
  | {
    readonly ok: true;
    readonly value: {
      readonly byteLength: number;
      readonly sha256: string;
    };
  }
  | { readonly ok: false; readonly error: AssessmentExportArtifactVerificationFailure };

/**
 * Parses the evidence-bearing fields of a final export receipt.
 *
 * The target registry owns destination-to-contract correlation. Serialized receipts cannot declare
 * an independent contract, media type, filename suffix, or evidence status.
 */
export function parseAssessmentExportReceiptEvidence(
  input: unknown,
): AssessmentExportReceiptEvidenceParseResult {
  const receipt = record(input);
  if (!receipt) return invalid('$', 'Export receipt must be a JSON object.');
  if (receipt.schema !== 'qflow.export-receipt.v1') {
    return invalid('schema', 'Export receipt schema must be qflow.export-receipt.v1.');
  }

  const receiptId = sha256(receipt.receiptId);
  if (!receiptId) return invalid('receiptId', 'Export receipt ID must be a SHA-256 digest.');
  const preflightId = sha256(receipt.preflightId);
  if (!preflightId) return invalid('preflightId', 'Export preflight ID must be a SHA-256 digest.');
  const acknowledgementWarningCodes = parseAcknowledgementWarningCodes(receipt.acknowledgements);
  if (!acknowledgementWarningCodes) {
    return invalid(
      'acknowledgements',
      'Export receipt acknowledgements must contain at most one unique warning-code set.',
    );
  }

  const targetRecord = record(receipt.target);
  if (!targetRecord) return invalid('target', 'Export receipt target must be an object.');
  const destinationId = nonEmptyString(targetRecord.destinationId);
  if (!destinationId) {
    return invalid('target.destinationId', 'Export receipt destination ID must be a string.');
  }
  const resolvedTarget = resolveAssessmentExportTarget(destinationId);
  if (!resolvedTarget.ok) {
    return invalid(
      'target.destinationId',
      `Export receipt destination "${destinationId}" is not selectable.`,
    );
  }
  if (targetRecord.targetContractId !== resolvedTarget.target.targetContractId) {
    return invalid(
      'target.targetContractId',
      `Export receipt contract must be ${resolvedTarget.target.targetContractId} for ${destinationId}.`,
    );
  }

  const packageRecord = record(receipt.package);
  if (!packageRecord) return invalid('package', 'Export receipt package must be an object.');
  const filename = nonEmptyString(packageRecord.filename);
  if (!filename || !filename.endsWith(resolvedTarget.target.artifact.filenameSuffix)) {
    return invalid(
      'package.filename',
      `Export receipt filename must end with ${resolvedTarget.target.artifact.filenameSuffix}.`,
    );
  }
  if (packageRecord.mediaType !== resolvedTarget.target.artifact.mediaType) {
    return invalid(
      'package.mediaType',
      `Export receipt media type must be ${resolvedTarget.target.artifact.mediaType}.`,
    );
  }
  const packageSha256 = sha256(packageRecord.sha256);
  if (!packageSha256) {
    return invalid('package.sha256', 'Export receipt package hash must be a SHA-256 digest.');
  }
  const byteLength = positiveInteger(packageRecord.byteLength);
  if (byteLength === null) {
    return invalid('package.byteLength', 'Export receipt package byte length must be positive.');
  }

  const evidenceRecord = record(receipt.evidence);
  if (!evidenceRecord) return invalid('evidence', 'Export receipt evidence must be an object.');
  const expectedEvidence = expectedEvidenceForTarget(resolvedTarget.target);
  if (evidenceRecord.profileReleaseEvidence !== expectedEvidence.profileReleaseEvidence) {
    return invalid(
      'evidence.profileReleaseEvidence',
      `Export receipt profile evidence must be ${expectedEvidence.profileReleaseEvidence}.`,
    );
  }
  const productImportEvidence = record(evidenceRecord.productImportEvidence);
  if (productImportEvidence?._tag !== expectedEvidence.productImportEvidence._tag) {
    return invalid(
      'evidence.productImportEvidence',
      `Export receipt product evidence must be ${expectedEvidence.productImportEvidence._tag}.`,
    );
  }

  const packageDiagnosticCodes = stringArray(receipt.packageDiagnosticCodes);
  if (!packageDiagnosticCodes) {
    return invalid(
      'packageDiagnosticCodes',
      'Export receipt package diagnostic codes must be unique non-empty strings.',
    );
  }
  const diagnosticFailure = evidenceDiagnosticFailure(expectedEvidence, packageDiagnosticCodes);
  if (diagnosticFailure) return diagnosticFailure;

  const validationRecord = record(receipt.validation);
  if (!validationRecord) {
    return invalid('validation', 'Export receipt validation must be an object.');
  }
  const validationKeys = Object.keys(validationRecord);
  if (
    validationKeys.length !== 3 ||
    !['runtimeContract', 'qti3Conformance', 'accessibility'].every((key) =>
      Object.hasOwn(validationRecord, key)
    )
  ) {
    return invalid('validation', 'Export receipt validation fields are invalid.');
  }
  if (validationRecord.runtimeContract !== 'xml-well-formed@1') {
    return invalid(
      'validation.runtimeContract',
      'Export receipt runtime contract must be xml-well-formed@1.',
    );
  }
  if (validationRecord.qti3Conformance !== 'NotRun') {
    return invalid(
      'validation.qti3Conformance',
      'Export receipt QTI 3 conformance evidence must be NotRun.',
    );
  }
  let accessibility: Qti3AccessibilityReport;
  try {
    accessibility = parseQti3AccessibilityReport(validationRecord.accessibility);
  } catch (cause: unknown) {
    return invalid(
      'validation.accessibility',
      cause instanceof Error ? cause.message : 'Export receipt accessibility evidence is invalid.',
    );
  }
  const accessibilityFindingCodes = new Set(
    accessibility.findings.map((finding) => finding.code),
  );
  const accessibilityDiagnosticCodes = new Set(
    packageDiagnosticCodes.filter((code) => code.startsWith('qti3_accessibility.')),
  );
  const missingAccessibilityCode = Array.from(accessibilityFindingCodes).find((code) =>
    !accessibilityDiagnosticCodes.has(code)
  );
  if (missingAccessibilityCode) {
    return invalid(
      'packageDiagnosticCodes',
      `Export receipt accessibility evidence requires diagnostic code ${missingAccessibilityCode}.`,
    );
  }
  const unsupportedAccessibilityCode = Array.from(accessibilityDiagnosticCodes).find((code) =>
    !accessibilityFindingCodes.has(code)
  );
  if (unsupportedAccessibilityCode) {
    return invalid(
      'packageDiagnosticCodes',
      `Export receipt diagnostic code ${unsupportedAccessibilityCode} has no accessibility finding.`,
    );
  }

  return {
    ok: true,
    value: {
      // SAFETY: sha256 established the final receipt ID digest invariant.
      receiptId: receiptId as AssessmentExportReceipt['receiptId'],
      // SAFETY: sha256 established the preflight content-ID invariant.
      preflightId: preflightId as AssessmentExportReceipt['preflightId'],
      target: resolvedTarget.target,
      package: {
        filename,
        mediaType: resolvedTarget.target.artifact.mediaType,
        sha256: packageSha256,
        byteLength,
      },
      packageDiagnosticCodes,
      acknowledgementWarningCodes,
      evidence: expectedEvidence,
      validation: {
        runtimeContract: 'xml-well-formed@1',
        qti3Conformance: 'NotRun',
        accessibility,
      },
    },
  };
}

/** Verifies that downloaded package bytes match the size and SHA-256 recorded in the receipt. */
export async function verifyAssessmentExportReceiptArtifact(
  receipt: AssessmentExportReceiptEvidence,
  bytes: Uint8Array,
): Promise<AssessmentExportArtifactVerificationResult> {
  if (bytes.byteLength !== receipt.package.byteLength) {
    return {
      ok: false,
      error: {
        _tag: 'AssessmentExportArtifactMismatch',
        field: 'byteLength',
        expected: receipt.package.byteLength,
        actual: bytes.byteLength,
        message: 'Downloaded export byte length does not match its receipt.',
      },
    };
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== receipt.package.sha256) {
    return {
      ok: false,
      error: {
        _tag: 'AssessmentExportArtifactMismatch',
        field: 'sha256',
        expected: receipt.package.sha256,
        actual: actualSha256,
        message: 'Downloaded export SHA-256 does not match its receipt.',
      },
    };
  }
  return {
    ok: true,
    value: {
      byteLength: bytes.byteLength,
      sha256: actualSha256,
    },
  };
}

function expectedEvidenceForTarget(
  target: SelectableAssessmentExportTarget,
): AssessmentExportReceipt['evidence'] {
  return {
    profileReleaseEvidence: target.compilation._tag === 'CanonicalPackage'
      ? 'NotApplicable'
      : 'NotRecorded',
    productImportEvidence: target.kind === 'lms'
      ? { _tag: 'NotRecorded' }
      : { _tag: 'NotApplicable' },
  };
}

function evidenceDiagnosticFailure(
  evidence: AssessmentExportReceipt['evidence'],
  codes: readonly string[],
): AssessmentExportReceiptEvidenceParseResult | null {
  const requiredCodes = [
    ...(evidence.profileReleaseEvidence === 'NotRecorded'
      ? ['profile_release_evidence.not_recorded']
      : []),
    ...(evidence.productImportEvidence._tag === 'NotRecorded'
      ? ['product_import_evidence.not_recorded']
      : []),
  ];
  for (const code of requiredCodes) {
    if (!codes.includes(code)) {
      return invalid(
        'packageDiagnosticCodes',
        `Export receipt evidence requires diagnostic code ${code}.`,
      );
    }
  }
  return null;
}

function invalid(
  path: string,
  message: string,
): Extract<AssessmentExportReceiptEvidenceParseResult, { readonly ok: false }> {
  return {
    ok: false,
    error: {
      _tag: 'InvalidAssessmentExportReceiptEvidence',
      path,
      message,
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    // SAFETY: The checks establish a non-null, non-array object with string-keyed unknown fields.
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function sha256(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const entry of value) {
    const parsed = nonEmptyString(entry);
    if (!parsed || values.includes(parsed)) return null;
    values.push(parsed);
  }
  return values;
}

function parseAcknowledgementWarningCodes(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  if (value.length !== 1) return null;
  const acknowledgement = record(value[0]);
  return acknowledgement ? stringArray(acknowledgement.warningCodes) : null;
}
