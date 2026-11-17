import { expect, test as testCase } from 'vitest';

import {
  parseAssessmentExportReceiptEvidence,
  verifyAssessmentExportReceiptArtifact,
} from '../lib/export/assessment_export_receipt_evidence.ts';
import { sha256Hex } from '../lib/sha256.ts';
import {
  QTI3_ACCESSIBILITY_CORE_VERSION,
  QTI3_ACCESSIBILITY_POLICY_VERSION,
} from '../lib/qti3_accessibility.ts';

testCase(
  'export receipt evidence binds target contract and downloaded artifact bytes',
  async () => {
    const bytes = new TextEncoder().encode('canvas package');
    const receipt = canvasReceipt(await sha256Hex(bytes), bytes.byteLength);

    const parsed = parseAssessmentExportReceiptEvidence(receipt);
    expect(parsed.ok).toStrictEqual(true);
    if (!parsed.ok) return;
    expect(parsed.value.target.id).toStrictEqual('canvas-classic');
    expect(parsed.value.target.targetContractId).toStrictEqual('canvas-classic-quizzes@1');
    expect(parsed.value.preflightId).toStrictEqual('c'.repeat(64));
    expect(parsed.value.acknowledgementWarningCodes).toStrictEqual([]);
    expect(parsed.value.packageDiagnosticCodes).toStrictEqual([
      'product_import_evidence.not_recorded',
      'profile_release_evidence.not_recorded',
    ]);
    expect(await verifyAssessmentExportReceiptArtifact(parsed.value, bytes)).toStrictEqual({
      ok: true,
      value: {
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      },
    });
  },
);

testCase('export receipt evidence rejects a target contract that bypasses the registry', () => {
  const receipt = canvasReceipt('a'.repeat(64), 12);
  receipt.target.targetContractId = 'moodle-xml@1';

  const parsed = parseAssessmentExportReceiptEvidence(receipt);

  expect(parsed).toStrictEqual({
    ok: false,
    error: {
      _tag: 'InvalidAssessmentExportReceiptEvidence',
      path: 'target.targetContractId',
      message: 'Export receipt contract must be canvas-classic-quizzes@1 for canvas-classic.',
    },
  });
});

testCase(
  'export receipt evidence rejects artifact bytes that disagree with the receipt',
  async () => {
    const expected = new TextEncoder().encode('expected bytes');
    const actual = new TextEncoder().encode('different bytes');
    const parsed = parseAssessmentExportReceiptEvidence(
      canvasReceipt(await sha256Hex(expected), actual.byteLength),
    );
    if (!parsed.ok) throw new Error(parsed.error.message);

    const verification = await verifyAssessmentExportReceiptArtifact(parsed.value, actual);

    expect(verification.ok).toStrictEqual(false);
    if (verification.ok) return;
    expect(verification.error.field).toStrictEqual('sha256');
    expect(verification.error.expected).toStrictEqual(await sha256Hex(expected));
    expect(verification.error.actual).toStrictEqual(await sha256Hex(actual));
  },
);

testCase('export receipt evidence binds accessibility findings to diagnostic codes', () => {
  const receipt = canvasReceipt('a'.repeat(64), 12);
  receipt.validation.accessibility = {
    qti3CoreVersion: QTI3_ACCESSIBILITY_CORE_VERSION,
    policyVersion: QTI3_ACCESSIBILITY_POLICY_VERSION,
    outcome: 'review',
    findings: [{
      itemId: 'item-1',
      code: 'qti3_accessibility.missing_alt_text',
      severity: 'warning',
      message: 'An image is missing alt text.',
    }],
  };

  const parsed = parseAssessmentExportReceiptEvidence(receipt);

  expect(parsed).toStrictEqual({
    ok: false,
    error: {
      _tag: 'InvalidAssessmentExportReceiptEvidence',
      path: 'packageDiagnosticCodes',
      message:
        'Export receipt accessibility evidence requires diagnostic code qti3_accessibility.missing_alt_text.',
    },
  });
});

testCase('export receipt evidence rejects accessibility codes without findings', () => {
  const receipt = canvasReceipt('a'.repeat(64), 12);
  receipt.packageDiagnosticCodes.push('qti3_accessibility.missing_alt_text');

  const parsed = parseAssessmentExportReceiptEvidence(receipt);

  expect(parsed).toStrictEqual({
    ok: false,
    error: {
      _tag: 'InvalidAssessmentExportReceiptEvidence',
      path: 'packageDiagnosticCodes',
      message:
        'Export receipt diagnostic code qti3_accessibility.missing_alt_text has no accessibility finding.',
    },
  });
});

testCase('export receipt evidence rejects duplicate acknowledgement warning codes', () => {
  const receipt = canvasReceipt('a'.repeat(64), 12);
  receipt.acknowledgements.push({
    warningCodes: ['warning.one', 'warning.one'],
  });

  expect(parseAssessmentExportReceiptEvidence(receipt)).toStrictEqual({
    ok: false,
    error: {
      _tag: 'InvalidAssessmentExportReceiptEvidence',
      path: 'acknowledgements',
      message: 'Export receipt acknowledgements must contain at most one unique warning-code set.',
    },
  });
});

function canvasReceipt(sha256: string, byteLength: number) {
  return {
    schema: 'qflow.export-receipt.v1',
    receiptId: 'b'.repeat(64),
    preflightId: 'c'.repeat(64),
    acknowledgements: [] as Array<{ warningCodes: string[] }>,
    target: {
      destinationId: 'canvas-classic',
      targetContractId: 'canvas-classic-quizzes@1',
    },
    package: {
      filename: 'assessment-canvas-classic.zip',
      mediaType: 'application/zip',
      sha256,
      byteLength,
    },
    evidence: {
      profileReleaseEvidence: 'NotRecorded',
      productImportEvidence: { _tag: 'NotRecorded' },
    },
    validation: {
      runtimeContract: 'xml-well-formed@1',
      qti3Conformance: 'NotRun',
      accessibility: {
        qti3CoreVersion: QTI3_ACCESSIBILITY_CORE_VERSION,
        policyVersion: QTI3_ACCESSIBILITY_POLICY_VERSION,
        outcome: 'passed' as 'passed' | 'review',
        findings: [] as Array<{
          itemId: string;
          code: string;
          severity: 'warning' | 'error';
          message: string;
        }>,
      },
    },
    packageDiagnosticCodes: [
      'product_import_evidence.not_recorded',
      'profile_release_evidence.not_recorded',
    ],
  };
}
