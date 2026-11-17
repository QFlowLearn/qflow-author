import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import {
  type AssessmentExportDocument,
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
} from '../lib/export/assessment.ts';
import {
  createAssessmentExportFidelityReceipt,
  QTI3_PACKAGE_VERSIONS,
} from '../lib/export/assessment_export_receipt.ts';
import {
  resolveAssessmentExportTarget,
  type SelectableAssessmentExportTarget,
  type SelectableAssessmentExportTargetId,
} from '../lib/export/assessment_export_targets.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { validateQti3Accessibility } from '../lib/qti3_accessibility.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

const DOCUMENT: AssessmentExportDocument = {
  assessment: { id: 'receipt-assessment', title: 'Receipt' },
  parts: [{
    id: 'part-1',
    title: 'Part 1',
    placements: [{ id: 'placement-1', itemId: 'single' }],
  }],
};

testCase('qti3 package family and fidelity receipt use one pinned release', async () => {
  const config: unknown = JSON.parse(
    await _fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (!(config && typeof config === 'object')) {
    expect.unreachable("Expected config && typeof config === 'object'");
  }
  const imports: unknown = Reflect.get(config, 'dependencies');
  if (!(imports && typeof imports === 'object' && !Array.isArray(imports))) {
    expect.unreachable(
      "Expected imports && typeof imports === 'object' && !Array.isArray(imports)",
    );
  }
  const releaseVersion = QTI3_PACKAGE_VERSIONS.core;
  expect(QTI3_PACKAGE_VERSIONS.writer).toStrictEqual(releaseVersion);
  expect(QTI3_PACKAGE_VERSIONS.transcoder).toStrictEqual(releaseVersion);
  for (
    const packageName of [
      'core',
      'migrator',
      'player',
      'pnp',
      'transcoder',
      'writer',
    ] as const
  ) {
    expect(Reflect.get(imports, `@longsightgroup/qti3-${packageName}`)).toStrictEqual(
      releaseVersion,
    );
  }
});

testCase('LMS profiles emit the same fidelity receipt contract', async () => {
  const input = await packageInput();
  for (
    const targetId of [
      'canvas-classic',
      'canvas-new-quizzes',
      'blackboard-question-banks',
      'brightspace-course-import',
      'moodle',
    ] as const satisfies readonly SelectableAssessmentExportTargetId[]
  ) {
    const exportTarget = target(targetId);
    const converted = await convertQti3AssessmentPackage(input, exportTarget);
    if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
    const artifact = {
      bytes: converted.artifact,
      filename: `assessment-receipt-assessment-${exportTarget.artifact.filenameSuffix}`,
      mediaType: exportTarget.artifact.mediaType,
    };
    const receipt = await createAssessmentExportFidelityReceipt({
      assessmentId: DOCUMENT.assessment.id,
      target: exportTarget,
      canonicalPackage: converted.canonicalPackage,
      artifact,
      transcodeEvidence: converted.transcodeEvidence,
      accessibility: validateQti3Accessibility(input.itemsXml),
    });

    expect(receipt.schema).toStrictEqual('qflow.export-fidelity-receipt.v1');
    expect(receipt.receiptId).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.target.destinationId).toStrictEqual(targetId);
    expect(receipt.target.targetContractId).toStrictEqual(converted.transcodeEvidence?.profile);
    expect(receipt.transcodeEvidence?.reports.length).toStrictEqual(1);
    expect(receipt.evidence.profileReleaseEvidence).toStrictEqual('NotRecorded');
    expect(receipt.evidence.productImportEvidence).toStrictEqual({ _tag: 'NotRecorded' });
    expect(receipt.validation).toStrictEqual({
      runtimeContract: 'xml-well-formed@1',
      qti3Conformance: 'NotRun',
      accessibility: validateQti3Accessibility(input.itemsXml),
    });
    expect(receipt.target.qti3Packages).toStrictEqual({
      core: '0.13.4',
      writer: '0.13.4',
      conformance: null,
      transcoder: '0.13.4',
    });
    expect(receipt.artifact.sha256).toStrictEqual(await sha256Hex(converted.artifact));
    expect(receipt.assessment.canonicalPackageSha256).toStrictEqual(
      await sha256Hex(converted.canonicalPackage),
    );
    if (!(receipt.packageDiagnosticCodes.includes('profile_release_evidence.not_recorded'))) {
      expect.unreachable(
        "Expected receipt.packageDiagnosticCodes.includes('profile_release_evidence.not_recorded')",
      );
    }
    if (!(receipt.packageDiagnosticCodes.includes('product_import_evidence.not_recorded'))) {
      expect.unreachable(
        "Expected receipt.packageDiagnosticCodes.includes('product_import_evidence.not_recorded')",
      );
    }
    if (targetId === 'blackboard-question-banks') {
      if (
        !(receipt.packageDiagnosticCodes.includes(
          'profile.blackboard.response_processing.omitted',
        ))
      ) {
        expect.unreachable(
          "Expected receipt.packageDiagnosticCodes.includes( 'profile.blackboard.response_processing.omitted',",
        );
      }
    }
  }
});

testCase(
  'new export receipts reject accessibility evidence from a different parser release',
  async () => {
    const input = await packageInput();
    const exportTarget = target('moodle');
    const converted = await convertQti3AssessmentPackage(input, exportTarget);
    if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
    await expect(
      Promise.resolve().then(() =>
        createAssessmentExportFidelityReceipt({
          assessmentId: DOCUMENT.assessment.id,
          target: exportTarget,
          canonicalPackage: converted.canonicalPackage,
          artifact: {
            bytes: converted.artifact,
            filename: 'assessment-moodle.xml',
            mediaType: exportTarget.artifact.mediaType,
          },
          transcodeEvidence: converted.transcodeEvidence,
          accessibility: {
            ...validateQti3Accessibility(input.itemsXml),
            qti3CoreVersion: '0.13.0',
          },
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('must use QTI parser 0.13.4')
    );
  },
);

testCase(
  'fidelity receipt identity is stable for exact source, target, and artifact bytes',
  async () => {
    const input = await packageInput();
    const exportTarget = target('moodle');
    const converted = await convertQti3AssessmentPackage(input, exportTarget);
    if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
    const receiptInput = {
      assessmentId: DOCUMENT.assessment.id,
      target: exportTarget,
      canonicalPackage: converted.canonicalPackage,
      artifact: {
        bytes: converted.artifact,
        filename: 'assessment-receipt-assessment-moodle.xml',
        mediaType: exportTarget.artifact.mediaType,
      },
      transcodeEvidence: converted.transcodeEvidence,
      accessibility: validateQti3Accessibility(input.itemsXml),
    };

    const first = await createAssessmentExportFidelityReceipt(receiptInput);
    const second = await createAssessmentExportFidelityReceipt(receiptInput);
    expect(first).toStrictEqual(second);
  },
);

testCase('canonical QTI 3 receipt does not invent conformance or LMS import evidence', async () => {
  const input = await packageInput();
  const exportTarget = target('qti3-conformant');
  const converted = await convertQti3AssessmentPackage(input, exportTarget);
  if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
  const receipt = await createAssessmentExportFidelityReceipt({
    assessmentId: DOCUMENT.assessment.id,
    target: exportTarget,
    canonicalPackage: converted.canonicalPackage,
    artifact: {
      bytes: converted.artifact,
      filename: 'assessment-receipt-assessment-qti3.zip',
      mediaType: exportTarget.artifact.mediaType,
    },
    transcodeEvidence: converted.transcodeEvidence,
    accessibility: validateQti3Accessibility(input.itemsXml),
  });

  expect(receipt.target.transcodeProfileId).toStrictEqual(null);
  expect(receipt.target.qti3Packages.conformance).toStrictEqual(null);
  expect(receipt.validation.qti3Conformance).toStrictEqual('NotRun');
  expect(receipt.evidence.productImportEvidence).toStrictEqual({ _tag: 'NotApplicable' });
  expect(receipt.transcodeEvidence).toStrictEqual(null);
  expect(receipt.fidelity).toStrictEqual('canonical');
  expect(receipt.packageDiagnosticCodes).toStrictEqual(['qti3_conformance.not_run']);
});

async function packageInput() {
  const assessment = await buildValidatedQti3Assessment(DOCUMENT);
  if (!(assessment.validation.ok)) expect.unreachable('Expected assessment.validation.ok');
  return {
    document: DOCUMENT,
    assessmentXml: assessment.xml,
    itemsXml: {
      single: exportQti3TestItemXml(
        'single_select',
        {
          type: 'single_select',
          title: 'Single',
          bodyHtml: '<p>Pick one.</p>',
          choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
          correctId: 'A',
        },
        { identifier: 'item-single' },
      ),
    },
    assets: [],
  };
}

function target(id: SelectableAssessmentExportTargetId): SelectableAssessmentExportTarget {
  const resolved = resolveAssessmentExportTarget(id);
  if (!(resolved.ok)) expect.unreachable(JSON.stringify(resolved));
  return resolved.target;
}
