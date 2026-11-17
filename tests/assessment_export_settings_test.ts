import { expect, test as testCase } from 'vitest';

import {
  type AssessmentExportDocument,
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
} from '../lib/export/assessment.ts';
import { authorizeAssessmentExport } from '../lib/export/assessment_export_authorization.ts';
import { createAssessmentExportReceipt } from '../lib/export/assessment_export_final_receipt.ts';
import {
  createAssessmentCanonicalRevisionId,
  createAssessmentExportPreflight,
} from '../lib/export/assessment_export_preflight.ts';
import { createAssessmentExportFidelityReceipt } from '../lib/export/assessment_export_receipt.ts';
import {
  exportActorIdFromAuthenticatedUser,
  strictAssessmentExportRequirements,
} from '../lib/export/assessment_export_requirements.ts';
import {
  listSelectableAssessmentExportTargets,
  resolveAssessmentExportTarget,
} from '../lib/export/assessment_export_targets.ts';
import { validateQti3Accessibility } from '../lib/qti3_accessibility.ts';
import { ZipArchive } from '../lib/zip_archive.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

// Synthetic MIT source. Expectations describe the emitted pinned profile contracts,
// independently of QFlow's omission-policy implementation.
const DOCUMENT: AssessmentExportDocument = {
  assessment: { id: 'settings-contract', title: 'Settings contract' },
  parts: [{
    id: 'first',
    title: 'First part',
    placements: [{ id: 'first-placement', itemId: 'one' }],
    options: {
      navigationMode: 'linear',
      submissionMode: 'simultaneous',
      timeLimits: { minTime: 60, maxTime: 300 },
      instructionsHtml: '<p>Read every question before submitting.</p>',
      feedback: [{
        id: 'completion',
        access: 'atEnd',
        showHide: 'show',
        outcomeIdentifier: 'TEST_FEEDBACK',
        html: '<p>Review the explanation after finishing.</p>',
      }],
    },
  }, {
    id: 'second',
    title: 'Second part',
    placements: [{ id: 'second-placement', itemId: 'two' }],
  }],
};

const ITEMS_XML = Object.fromEntries(['one', 'two'].map((id) => [
  id,
  exportQti3TestItemXml(
    'single_select',
    {
      type: 'single_select',
      title: `Question ${id}`,
      bodyHtml: `<p>Question ${id}: choose Alpha.</p>`,
      choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
      correctId: 'A',
    },
    { identifier: `item-${id}` },
  ),
]));

const CONTENT_LOSSES = [
  'qflow.export.part_feedback_omitted',
  'qflow.export.part_instructions_omitted',
];
const DELIVERY_LOSSES = [
  'qflow.export.part_navigation_omitted',
  'qflow.export.part_structure_omitted',
  'qflow.export.part_submission_omitted',
  'qflow.export.part_time_limits_omitted',
];

for (const target of listSelectableAssessmentExportTargets()) {
  testCase(
    `settings export: ${target.id} retains questions and diagnoses only actual omissions`,
    async () => {
      const input = await packageInput(DOCUMENT);
      const result = await convertQti3AssessmentPackage(input, target);
      if (!(result.ok)) expect.unreachable(JSON.stringify(result));
      const canonical = await ZipArchive.open(result.canonicalPackage);
      try {
        const test = canonical.file('assessment.xml');
        if (!test) expect.unreachable('Expected test');
        expect(await test.async('string')).toStrictEqual(input.assessmentXml);
        if (!(canonical.file('items/one.xml'))) {
          expect.unreachable("Expected canonical.file('items/one.xml')");
        }
        if (!(canonical.file('items/two.xml'))) {
          expect.unreachable("Expected canonical.file('items/two.xml')");
        }
      } finally {
        await canonical.close();
      }
      if (target.id === 'qti3-conformant') {
        expect(result.artifact).toStrictEqual(result.canonicalPackage);
        expect(result.transcodeEvidence).toStrictEqual(null);
        return;
      }
      const qti2 = [
        'qti21-standard',
        'qti22-standard',
        'blackboard-question-banks',
        'brightspace-course-import',
      ].includes(target.id);
      const expected = qti2 ? CONTENT_LOSSES : [...CONTENT_LOSSES, ...DELIVERY_LOSSES];
      expect(
        result.transcodeEvidence?.diagnostics.filter((entry) =>
          entry.code.startsWith('qflow.export.part_')
        ).map((entry) => entry.code).sort(),
      ).toStrictEqual([...expected].sort());
      expect(result.transcodeEvidence?.fidelity).toStrictEqual('lossy');
      expect(result.transcodeEvidence?.reports.length).toStrictEqual(2);
      const questionContent = target.id === 'moodle'
        ? new TextDecoder().decode(result.artifact)
        : await archiveXml(result.artifact);
      for (const id of ['one', 'two']) {
        expect(questionContent).toContain(`Question ${id}: choose Alpha.`);
      }
      const artifact = target.id === 'moodle'
        ? new TextDecoder().decode(result.artifact)
        : await archiveText(
          result.artifact,
          qti2 || target.id === 'qti12-standard' ? 'assessment.xml' : 'assessment_qti.xml',
        );
      if (artifact.includes('Read every question before submitting.')) {
        expect.unreachable("Expected !artifact.includes('Read every question before submitting.')");
      }
      if (artifact.includes('Review the explanation after finishing.')) {
        expect.unreachable(
          "Expected !artifact.includes('Review the explanation after finishing.')",
        );
      }
      if (qti2) {
        expect(artifact).toContain('navigationMode="linear"');
        expect(artifact).toContain('submissionMode="simultaneous"');
        expect(artifact).toContain('minTime="60"');
        expect(artifact).toContain('maxTime="300"');
        expect(artifact).toContain('identifier="first"');
        expect(artifact).toContain('identifier="second"');
      } else {
        if (artifact.includes('minTime="60"')) {
          expect.unreachable('Expected !artifact.includes(\'minTime="60"\')');
        }
        if (artifact.includes('maxTime="300"')) {
          expect.unreachable('Expected !artifact.includes(\'maxTime="300"\')');
        }
      }
    },
  );
}

testCase(
  'settings export: omitted controls require revision-bound acknowledgement but keep automatic scoring',
  async () => {
    const resolved = resolveAssessmentExportTarget('canvas-classic');
    if (!(resolved.ok)) expect.unreachable('Expected resolved.ok');
    const target = resolved.target;
    const input = await packageInput(DOCUMENT);
    const converted = await convertQti3AssessmentPackage(input, target);
    if (!(converted.ok)) expect.unreachable('Expected converted.ok');
    const artifact = {
      bytes: converted.artifact,
      filename: 'settings.zip',
      mediaType: 'application/zip',
    };
    const receipt = await createAssessmentExportFidelityReceipt({
      assessmentId: DOCUMENT.assessment.id,
      target,
      canonicalPackage: converted.canonicalPackage,
      artifact,
      transcodeEvidence: converted.transcodeEvidence,
      accessibility: validateQti3Accessibility(ITEMS_XML),
    });
    const preflight = await createAssessmentExportPreflight({
      target,
      requirements: strictAssessmentExportRequirements(),
      receipt,
      canonicalRevisionId: await createAssessmentCanonicalRevisionId({
        assessmentId: DOCUMENT.assessment.id,
        assessmentXml: input.assessmentXml,
        itemsXml: ITEMS_XML,
      }),
      itemsXml: ITEMS_XML,
      transcodeEvidence: converted.transcodeEvidence,
    });
    expect(preflight.overallOutcome).toStrictEqual('warning');
    expect(preflight.warningCodes).toStrictEqual([...CONTENT_LOSSES, ...DELIVERY_LOSSES].sort());
    if (!(preflight.items.every((item) => item._tag !== 'Blocked'))) {
      expect.unreachable("Expected preflight.items.every((item) => item._tag !== 'Blocked')");
    }
    if (
      !(preflight.items.every((item) =>
        item.mappings.every((mapping) => mapping.scoring === 'automatic')
      ))
    ) {
      expect.unreachable(
        "Expected preflight.items.every((item) => item.mappings.every((mapping) => mapping.scoring === 'auto",
      );
    }
    if (!(preflight.acknowledgementToken)) {
      expect.unreachable('Expected preflight.acknowledgementToken');
    }
    const authorizationInput = {
      candidate: { artifact, fidelityReceipt: receipt, preflight },
      authorizedBy: exportActorIdFromAuthenticatedUser('10000000-0000-4000-8000-000000000001'),
      approvedPreflightId: preflight.preflightId,
    };
    expect(
      (await authorizeAssessmentExport({ ...authorizationInput, acknowledgementToken: null }))._tag,
    ).toStrictEqual('WarningsNotAcknowledged');
    const authorized = await authorizeAssessmentExport({
      ...authorizationInput,
      acknowledgementToken: preflight.acknowledgementToken,
    });
    if (!(authorized._tag === 'Authorized')) {
      expect.unreachable("Expected authorized._tag === 'Authorized'");
    }
    const finalReceipt = await createAssessmentExportReceipt({
      authorizedExport: authorized.value,
      createdAt: new Date('2026-10-07T12:00:00Z'),
    });
    expect(
      finalReceipt.packageDiagnosticCodes.filter((code) => code.startsWith('qflow.export.part_'))
        .sort(),
    ).toStrictEqual([...CONTENT_LOSSES, ...DELIVERY_LOSSES].sort());
    const changedDocument = {
      ...DOCUMENT,
      parts: DOCUMENT.parts.map((part, index) =>
        index === 0
          ? {
            ...part,
            options: { ...part.options, instructionsHtml: '<p>Read the updated instructions.</p>' },
          }
          : part
      ),
    };
    const changedInput = await packageInput(changedDocument);
    const changed = await convertQti3AssessmentPackage(changedInput, target);
    if (!(changed.ok)) expect.unreachable('Expected changed.ok');
    // An omitted instruction changes the source even when the downloadable bytes
    // and warning codes do not change. The previous acknowledgement must expire.
    expect(changed.artifact).toStrictEqual(converted.artifact);
    const changedArtifact = { ...artifact, bytes: changed.artifact };
    const changedReceipt = await createAssessmentExportFidelityReceipt({
      assessmentId: DOCUMENT.assessment.id,
      target,
      canonicalPackage: changed.canonicalPackage,
      artifact: changedArtifact,
      transcodeEvidence: changed.transcodeEvidence,
      accessibility: validateQti3Accessibility(ITEMS_XML),
    });
    const changedPreflight = await createAssessmentExportPreflight({
      target,
      requirements: strictAssessmentExportRequirements(),
      receipt: changedReceipt,
      canonicalRevisionId: await createAssessmentCanonicalRevisionId({
        assessmentId: DOCUMENT.assessment.id,
        assessmentXml: changedInput.assessmentXml,
        itemsXml: ITEMS_XML,
      }),
      itemsXml: ITEMS_XML,
      transcodeEvidence: changed.transcodeEvidence,
    });
    const changedCandidate = {
      artifact: changedArtifact,
      fidelityReceipt: changedReceipt,
      preflight: changedPreflight,
    };
    expect(
      (await authorizeAssessmentExport({
        ...authorizationInput,
        candidate: changedCandidate,
        acknowledgementToken: preflight.acknowledgementToken,
      }))._tag,
    ).toStrictEqual('PreflightStale');
    expect(
      (await authorizeAssessmentExport({
        ...authorizationInput,
        candidate: changedCandidate,
        approvedPreflightId: changedPreflight.preflightId,
        acknowledgementToken: preflight.acknowledgementToken,
      }))._tag,
    ).toStrictEqual('WarningsNotAcknowledged');
  },
);

for (const zeroLimit of [false, true]) {
  testCase(
    `settings export: ${
      zeroLimit ? 'zero time limits are disclosed' : 'absent optional settings add no warnings'
    }`,
    async () => {
      const first = DOCUMENT.parts[0];
      if (!first) expect.unreachable('Expected first');
      const document = {
        ...DOCUMENT,
        parts: [{
          ...first,
          placements: DOCUMENT.parts.flatMap((part) => part.placements),
          options: zeroLimit ? { timeLimits: { minTime: 0, maxTime: 0 } } : {},
        }],
      };
      const resolved = resolveAssessmentExportTarget('canvas-classic');
      if (!(resolved.ok)) expect.unreachable('Expected resolved.ok');
      const result = await convertQti3AssessmentPackage(
        await packageInput(document),
        resolved.target,
      );
      if (!(result.ok)) expect.unreachable('Expected result.ok');
      expect(
        result.transcodeEvidence?.diagnostics.filter((entry) =>
          entry.code.startsWith('qflow.export.part_')
        ).map((entry) => entry.code),
      ).toStrictEqual(zeroLimit ? ['qflow.export.part_time_limits_omitted'] : []);
    },
  );
}

async function packageInput(document: AssessmentExportDocument) {
  const built = await buildValidatedQti3Assessment(document);
  if (!(built.validation.ok)) expect.unreachable(JSON.stringify(built.validation));
  return { document, assessmentXml: built.xml, itemsXml: ITEMS_XML, assets: [] };
}

async function archiveText(bytes: Uint8Array, path: string): Promise<string> {
  const archive = await ZipArchive.open(bytes);
  try {
    const file = archive.file(path);
    if (!file) expect.unreachable(`Missing emitted ${path}`);
    return await file.async('string');
  } finally {
    await archive.close();
  }
}

async function archiveXml(bytes: Uint8Array): Promise<string> {
  const archive = await ZipArchive.open(bytes);
  try {
    const entries = Object.values(archive.files).filter((entry) =>
      !entry.dir && entry.name.endsWith('.xml')
    );
    return (await Promise.all(entries.map((entry) => entry.async('string')))).join('\n');
  } finally {
    await archive.close();
  }
}
