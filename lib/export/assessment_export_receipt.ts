import type { QtiTranscodeFidelity, QtiTranscodeProfileId } from '@longsightgroup/qti3-transcoder';

import { sha256Hex } from '../sha256.ts';
import type { AssessmentTranscodeEvidence } from './assessment.ts';
import {
  assessmentExportTranscodeProfileId,
  type SelectableAssessmentExportTarget,
} from './assessment_export_targets.ts';
import {
  parseQti3AccessibilityReport,
  QTI3_ACCESSIBILITY_CORE_VERSION,
  type Qti3AccessibilityReport,
} from '../qti3_accessibility.ts';

declare const assessmentExportReceiptIdBrand: unique symbol;

/** Content-addressed identity of one exact canonical package, target contract, and artifact. */
export type AssessmentExportReceiptId = string & {
  readonly [assessmentExportReceiptIdBrand]: 'AssessmentExportReceiptId';
};

/** Exact qti3 dependency versions represented by Task 8 fidelity receipts. */
export const QTI3_PACKAGE_VERSIONS = {
  core: QTI3_ACCESSIBILITY_CORE_VERSION,
  writer: '0.13.4',
  conformance: null,
  transcoder: '0.13.4',
} as const;

/** Deterministic evidence sidecar for one generated assessment export artifact. */
export type AssessmentExportFidelityReceipt = {
  readonly schema: 'qflow.export-fidelity-receipt.v1';
  readonly receiptId: AssessmentExportReceiptId;
  readonly assessment: {
    readonly id: string;
    readonly canonicalStandard: 'QTI 3.0';
    readonly canonicalPackageSha256: string;
  };
  readonly target: {
    readonly destinationId: SelectableAssessmentExportTarget['id'];
    readonly targetContractId: SelectableAssessmentExportTarget['targetContractId'];
    readonly transcodeProfileId: QtiTranscodeProfileId | null;
    readonly qti3Packages: {
      readonly core: typeof QTI3_PACKAGE_VERSIONS.core;
      readonly writer: typeof QTI3_PACKAGE_VERSIONS.writer;
      readonly conformance: null;
      readonly transcoder: typeof QTI3_PACKAGE_VERSIONS.transcoder | null;
    };
  };
  readonly validation: {
    readonly runtimeContract: 'xml-well-formed@1';
    readonly qti3Conformance: 'NotRun';
    readonly accessibility: Qti3AccessibilityReport;
  };
  readonly evidence: {
    readonly profileReleaseEvidence: 'NotRecorded' | 'NotApplicable';
    readonly productImportEvidence:
      | { readonly _tag: 'NotRecorded' }
      | { readonly _tag: 'NotApplicable' };
  };
  readonly fidelity: QtiTranscodeFidelity | 'canonical';
  readonly transcodeEvidence: AssessmentTranscodeEvidence | null;
  readonly packageDiagnosticCodes: readonly string[];
  readonly artifact: {
    readonly filename: string;
    readonly mediaType: string;
    readonly sha256: string;
    readonly byteLength: number;
  };
};

type CreateFidelityReceiptInput = {
  readonly assessmentId: string;
  readonly target: SelectableAssessmentExportTarget;
  readonly canonicalPackage: Uint8Array;
  readonly artifact: {
    readonly filename: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  };
  readonly transcodeEvidence: AssessmentTranscodeEvidence | null;
  readonly accessibility: Qti3AccessibilityReport;
  readonly additionalPackageDiagnosticCodes?: readonly string[];
};

const PRODUCT_IMPORT_EVIDENCE_NOT_RECORDED = 'product_import_evidence.not_recorded';
const PROFILE_RELEASE_EVIDENCE_NOT_RECORDED = 'profile_release_evidence.not_recorded';
const QTI3_CONFORMANCE_NOT_RUN = 'qti3_conformance.not_run';

/**
 * Records exact package hashes and the qti3 evidence returned by the pinned public API.
 *
 * Destination-aware outcome policy and warning acknowledgement belong to Task 9 preflight. This
 * receipt does not infer release-gate, runtime-conformance, or real-product-import evidence.
 */
export async function createAssessmentExportFidelityReceipt(
  input: CreateFidelityReceiptInput,
): Promise<AssessmentExportFidelityReceipt> {
  const accessibility = parseQti3AccessibilityReport(input.accessibility);
  if (accessibility.qti3CoreVersion !== QTI3_ACCESSIBILITY_CORE_VERSION) {
    throw new Error(
      `New export accessibility evidence must use QTI parser ${QTI3_ACCESSIBILITY_CORE_VERSION}.`,
    );
  }
  const [canonicalPackageSha256, artifactSha256] = await Promise.all([
    sha256Hex(input.canonicalPackage),
    sha256Hex(input.artifact.bytes),
  ]);
  const transcodeProfileId = assessmentExportTranscodeProfileId(input.target);
  const productImportEvidence = input.target.kind === 'lms'
    ? { _tag: 'NotRecorded' } as const
    : { _tag: 'NotApplicable' } as const;
  const profileReleaseEvidence = transcodeProfileId === null
    ? 'NotApplicable' as const
    : 'NotRecorded' as const;
  const packageDiagnosticCodes = Array.from(
    new Set([
      ...(input.transcodeEvidence?.diagnostics
        .filter((diagnostic) => diagnostic.severity !== 'info')
        .map((diagnostic) => diagnostic.code) ?? []),
      ...(profileReleaseEvidence === 'NotRecorded' ? [PROFILE_RELEASE_EVIDENCE_NOT_RECORDED] : []),
      ...(input.target.kind === 'lms' ? [PRODUCT_IMPORT_EVIDENCE_NOT_RECORDED] : []),
      ...(input.target.id === 'qti3-conformant' ? [QTI3_CONFORMANCE_NOT_RUN] : []),
      ...accessibility.findings.map((finding) => finding.code),
      ...(input.additionalPackageDiagnosticCodes ?? []),
    ]),
  );
  const receiptIdentity = new TextEncoder().encode(
    [
      canonicalPackageSha256,
      input.target.targetContractId,
      artifactSha256,
      input.artifact.filename,
      accessibility.qti3CoreVersion,
      accessibility.policyVersion,
      JSON.stringify(accessibility.findings),
      JSON.stringify([...(input.additionalPackageDiagnosticCodes ?? [])].sort()),
    ].join('\n'),
  );
  const receiptId = await createAssessmentExportReceiptId(receiptIdentity);

  return {
    schema: 'qflow.export-fidelity-receipt.v1',
    receiptId,
    assessment: {
      id: input.assessmentId,
      canonicalStandard: 'QTI 3.0',
      canonicalPackageSha256,
    },
    target: {
      destinationId: input.target.id,
      targetContractId: input.target.targetContractId,
      transcodeProfileId,
      qti3Packages: {
        core: QTI3_PACKAGE_VERSIONS.core,
        writer: QTI3_PACKAGE_VERSIONS.writer,
        conformance: QTI3_PACKAGE_VERSIONS.conformance,
        transcoder: transcodeProfileId === null ? null : QTI3_PACKAGE_VERSIONS.transcoder,
      },
    },
    validation: {
      runtimeContract: 'xml-well-formed@1',
      qti3Conformance: 'NotRun',
      accessibility,
    },
    evidence: {
      profileReleaseEvidence,
      productImportEvidence,
    },
    fidelity: input.transcodeEvidence?.fidelity ?? 'canonical',
    transcodeEvidence: input.transcodeEvidence,
    packageDiagnosticCodes,
    artifact: {
      filename: input.artifact.filename,
      mediaType: input.artifact.mediaType,
      sha256: artifactSha256,
      byteLength: input.artifact.bytes.byteLength,
    },
  };
}

async function createAssessmentExportReceiptId(
  receiptIdentity: Uint8Array,
): Promise<AssessmentExportReceiptId> {
  const digest = await sha256Hex(receiptIdentity);
  // SAFETY: sha256Hex returns exactly 64 lowercase hexadecimal characters.
  return digest as AssessmentExportReceiptId;
}
