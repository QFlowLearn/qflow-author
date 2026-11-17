import { expect, test as testCase } from 'vitest';

import { buildQti3ChoiceItem, qti3TrustedXmlFragment } from '@longsightgroup/qti3-writer';
import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';

import {
  type AssessmentExportDocument,
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
} from '../lib/export/assessment.ts';
import {
  resolveAssessmentExportTarget,
  type SelectableAssessmentExportTarget,
  type SelectableAssessmentExportTargetId,
} from '../lib/export/assessment_export_targets.ts';
import type { QuestionTypeId } from '../lib/types/registry.ts';
import { ZipArchive } from '../lib/zip_archive.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

const ITEMS: Readonly<Record<string, { type: QuestionTypeId; draft: Record<string, unknown> }>> = {
  single: {
    type: 'single_select',
    draft: {
      type: 'single_select',
      title: 'Single Select',
      bodyHtml:
        '<p>Pick the first president. <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math><img src="../assets/diagram.png" alt="Diagram"></p>',
      choices: [
        { id: 'A', text: 'John Adams' },
        { id: 'B', text: 'George Washington' },
      ],
      correctId: 'B',
    },
  },
  multiple: {
    type: 'multi_select',
    draft: {
      type: 'multi_select',
      title: 'Multiple Select',
      bodyHtml: '<p>Pick two.</p>',
      choices: [
        { id: 'A', text: 'One' },
        { id: 'B', text: 'Two' },
        { id: 'C', text: 'Three' },
      ],
      correctIds: ['A', 'C'],
    },
  },
  short: {
    type: 'text_entry',
    draft: {
      type: 'text_entry',
      title: 'Short Answer',
      promptHtml: '<p>Complete the sentence.</p>',
      bodyHtml:
        '<p>Deno is <span data-qti-entry="RESPONSE" data-label="Blank 1" class="qti-entry-slot ds-input ds-input-bordered qti-input-width-6" contenteditable="false"></span>.</p>',
      textEntries: [{
        id: 'RESPONSE',
        label: 'Blank 1',
        expectedLength: 6,
        widthClass: 'qti-input-width-6',
        answers: [{ value: 'secure', caseSensitive: false }],
      }],
    },
  },
  essay: {
    type: 'extended_text',
    draft: {
      type: 'extended_text',
      title: 'Essay',
      bodyHtml: '<p>Explain your reasoning.</p>',
      promptHtml: '<p>Write one paragraph.</p>',
      expectedLength: 200,
      expectedLines: 6,
      rubricHtml: '<p>Use evidence.</p>',
    },
  },
  matching: {
    type: 'match',
    draft: {
      type: 'match',
      title: 'Matching',
      bodyHtml: '<p>Match each term.</p>',
      promptHtml: '<p>Match.</p>',
      sources: [
        { id: 'A', text: 'Dog', matchMax: 1 },
        { id: 'B', text: 'Cat', matchMax: 1 },
      ],
      targets: [
        { id: 'T1', text: 'Barks' },
        { id: 'T2', text: 'Meows' },
      ],
      correctPairs: [
        { sourceId: 'A', targetId: 'T1' },
        { sourceId: 'B', targetId: 'T2' },
      ],
      maxAssociations: 0,
    },
  },
};

const DOCUMENT: AssessmentExportDocument = {
  assessment: { id: 'assessment-transcoder', title: 'Transcoder Export' },
  parts: [{
    id: 'part-1',
    title: 'Part 1',
    placements: Object.keys(ITEMS).map((itemId, index) => ({
      id: `placement-${index + 1}`,
      itemId,
    })),
  }],
};

testCase(
  'QFlow compiles Canvas Classic with the exact qti3 profile and fidelity report',
  async () => {
    const converted = await convertQti3AssessmentPackage(
      await buildTranscoderPackageInput(),
      target('canvas-classic'),
    );
    if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
    expect(converted.transcodeEvidence?.profile).toStrictEqual('canvas-classic-quizzes@1');
    expect(converted.transcodeEvidence?.reports.length).toStrictEqual(Object.keys(ITEMS).length);

    const archive = await ZipArchive.open(converted.artifact);
    try {
      if (!(archive.file('imsmanifest.xml'))) {
        expect.unreachable("Expected archive.file('imsmanifest.xml')");
      }
      if (!(archive.file('assessment_qti.xml'))) {
        expect.unreachable("Expected archive.file('assessment_qti.xml')");
      }
      if (!(archive.file('assessment_meta.xml'))) {
        expect.unreachable("Expected archive.file('assessment_meta.xml')");
      }
      if (!(archive.file('assets/diagram.png'))) {
        expect.unreachable("Expected archive.file('assets/diagram.png')");
      }
      const reportFiles = archive.file(/^assets\/generated\/[a-f0-9]{64}\.json$/);
      expect(reportFiles.length).toStrictEqual(1);
      const report = JSON.parse(await reportFiles[0].async('string'));
      expect(report.profile).toStrictEqual('canvas-classic-quizzes@1');
      expect(report.items.length).toStrictEqual(Object.keys(ITEMS).length);
    } finally {
      await archive.close();
    }
  },
);

testCase('QFlow delivers the Moodle profile entry point as importable XML', async () => {
  const converted = await convertQti3AssessmentPackage(
    await buildTranscoderPackageInput(),
    target('moodle'),
  );
  if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
  expect(converted.transcodeEvidence?.profile).toStrictEqual('moodle-xml@1');
  expect(converted.transcodeEvidence?.reports.length).toStrictEqual(Object.keys(ITEMS).length);

  const xml = new TextDecoder().decode(converted.artifact);
  expect(xml).toContain('<quiz>');
  expect(xml).toContain('<question type="multichoice">');
  expect(xml).toContain('<question type="shortanswer">');
  expect(xml).toContain('<question type="essay">');
  expect(xml).toContain('<correctfeedback format="html">');
  expect(xml).toContain('<defaultgrade>');
  expect(xml).toContain('&lt;math');
  expect(xml).toContain('<file name="diagram.png"');
  expect(xml).toContain('AQIDBA==');
  const matchingReport = converted.transcodeEvidence?.reports.find((item) =>
    item.identifier === 'item-matching'
  );
  expect(matchingReport?.fidelity).toStrictEqual('lossy');
  expect(matchingReport?.mappings[0]?.emittedInteraction).toStrictEqual('essay');
});

testCase('QFlow preserves explicit point values in both LMS artifacts', async () => {
  const packageInput = await buildTranscoderPackageInput({ maximumScore: 7.5 });
  const scored = scoreQtiItemServerSide({
    itemXml: packageInput.itemsXml.single,
    trustedResponses: { RESPONSE: 'B' },
  });
  if (!(scored.ok)) expect.unreachable(JSON.stringify(scored.diagnostics));
  expect(scored.score).toStrictEqual(7.5);
  const moodle = await convertQti3AssessmentPackage(packageInput, target('moodle'));
  if (!(moodle.ok)) expect.unreachable(JSON.stringify(moodle));
  expect(new TextDecoder().decode(moodle.artifact)).toContain('<defaultgrade>7.5</defaultgrade>');

  const canvas = await convertQti3AssessmentPackage(packageInput, target('canvas-classic'));
  if (!(canvas.ok)) expect.unreachable(JSON.stringify(canvas));
  const archive = await ZipArchive.open(canvas.artifact);
  try {
    const metadata = archive.file('assessment_meta.xml');
    if (!metadata) expect.unreachable('Expected metadata');
    expect(await metadata.async('string')).toContain('<points_possible>11.5</points_possible>');
    const assessment = archive.file('assessment_qti.xml');
    if (!assessment) expect.unreachable('Expected assessment');
    expect(await assessment.async('string')).toContain(
      '<fieldlabel>points_possible</fieldlabel><fieldentry>7.5</fieldentry>',
    );
  } finally {
    await archive.close();
  }
});

testCase('LMS exports preserve zero points and fractional precision without rounding', async () => {
  for (const maximumScore of [0, 7.5001]) {
    const packageInput = await buildTranscoderPackageInput({ maximumScore });
    const scored = scoreQtiItemServerSide({
      itemXml: packageInput.itemsXml.single,
      trustedResponses: { RESPONSE: 'B' },
    });
    if (!(scored.ok)) expect.unreachable(JSON.stringify(scored.diagnostics));
    expect(scored.score).toStrictEqual(maximumScore);
    const moodle = await convertQti3AssessmentPackage(packageInput, target('moodle'));
    if (!(moodle.ok)) expect.unreachable(JSON.stringify(moodle));
    expect(new TextDecoder().decode(moodle.artifact)).toContain(
      `<defaultgrade>${maximumScore}</defaultgrade>`,
    );
    const canvas = await convertQti3AssessmentPackage(packageInput, target('canvas-classic'));
    if (!(canvas.ok)) expect.unreachable(JSON.stringify(canvas));
    const archive = await ZipArchive.open(canvas.artifact);
    try {
      const assessment = archive.file('assessment_qti.xml');
      if (!assessment) expect.unreachable('Expected assessment');
      expect(await assessment.async('string')).toContain(
        `<fieldlabel>points_possible</fieldlabel><fieldentry>${maximumScore}</fieldentry>`,
      );
    } finally {
      await archive.close();
    }
  }
});

testCase('QFlow forwards curriculum standards to a standards profile', async () => {
  const packageInput = await buildTranscoderPackageInput();
  const converted = await convertQti3AssessmentPackage(
    {
      ...packageInput,
      standardsByItem: {
        single: [{ standardId: 'STD-123', label: 'Standard 123' }],
      },
    },
    target('qti21-standard'),
  );

  if (!(converted.ok)) expect.unreachable(JSON.stringify(converted));
  expect(converted.transcodeEvidence?.profile).toStrictEqual('qti21-standard@1');
});

testCase('canonical package and target artifacts are deterministic', async () => {
  const packageInput = await buildTranscoderPackageInput();
  for (const targetId of ['qti3-conformant', 'canvas-classic', 'moodle'] as const) {
    const first = await convertQti3AssessmentPackage(packageInput, target(targetId));
    const second = await convertQti3AssessmentPackage(packageInput, target(targetId));
    if (!(first.ok)) expect.unreachable(JSON.stringify(first));
    if (!(second.ok)) expect.unreachable(JSON.stringify(second));
    expect(first.canonicalPackage).toStrictEqual(second.canonicalPackage);
    expect(first.artifact).toStrictEqual(second.artifact);
  }
});

async function buildTranscoderPackageInput(options: { maximumScore?: number } = {}) {
  const itemsXml = Object.fromEntries(
    Object.entries(ITEMS).map(([itemId, item]) => {
      const source = exportQti3TestItemXml(item.type, item.draft, {
        identifier: `item-${itemId}`,
      });
      const xml = options.maximumScore !== undefined && itemId === 'single'
        ? buildQti3ChoiceItem({
          identifier: 'item-single',
          title: 'Weighted choice',
          bodyHtml: qti3TrustedXmlFragment('<p>Pick the first president.</p>'),
          responseCardinality: 'single',
          choices: [{ identifier: 'A', text: 'John Adams' }, {
            identifier: 'B',
            text: 'George Washington',
          }],
          correctResponse: ['B'],
          maximumScore: options.maximumScore,
        })
        : source;
      return [itemId, xml];
    }),
  );
  const assessment = await buildValidatedQti3Assessment(DOCUMENT);
  if (!(assessment.validation.ok)) expect.unreachable('Expected assessment.validation.ok');
  return {
    document: DOCUMENT,
    assessmentXml: assessment.xml,
    itemsXml,
    assets: [{
      id: 'asset-diagram',
      name: 'diagram.png',
      data: new Uint8Array([1, 2, 3, 4]),
    }],
    assetIdsByItem: { single: ['asset-diagram'] },
  };
}

function target(id: SelectableAssessmentExportTargetId): SelectableAssessmentExportTarget {
  const resolved = resolveAssessmentExportTarget(id);
  if (!(resolved.ok)) expect.unreachable(JSON.stringify(resolved));
  return resolved.target;
}
