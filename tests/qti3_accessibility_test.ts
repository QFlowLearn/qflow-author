import { expect, test as testCase } from 'vitest';

import {
  parseQti3AccessibilityReport,
  QTI3_ACCESSIBILITY_CORE_VERSION,
  QTI3_ACCESSIBILITY_POLICY_VERSION,
  validateQti3Accessibility,
} from '../lib/qti3_accessibility.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

testCase('final QTI accessibility reports missing alt text and color-only instructions', () => {
  const xml = choiceXml('<p>Choose the red option.</p><img src="map.png"/>');
  const report = validateQti3Accessibility({ 'item-1': xml });

  expect(report.outcome).toStrictEqual('review');
  expect(report.findings.some((finding) => finding.code === 'qti3_accessibility.missing_alt_text'))
    .toStrictEqual(true);
  expect(
    report.findings.some((finding) => finding.code === 'qti3_accessibility.color_only_instruction'),
  ).toStrictEqual(true);
});

testCase('final QTI accessibility does not treat an ordinary color word as an instruction', () => {
  const report = validateQti3Accessibility({
    'item-1': choiceXml('<p>Which blue whale behavior is described?</p>'),
  });

  expect(
    report.findings.some((finding) => finding.code === 'qti3_accessibility.color_only_instruction'),
  ).toStrictEqual(false);
});

testCase('final QTI accessibility keeps alternate cues local to the color instruction', () => {
  const report = validateQti3Accessibility({
    'item-1': choiceXml('<p>Choose the red option.</p><p>The first answer is plausible.</p>'),
  });

  expect(
    report.findings.some((finding) => finding.code === 'qti3_accessibility.color_only_instruction'),
  ).toStrictEqual(true);
});

testCase('final QTI accessibility ignores image-like text in XML comments', () => {
  const report = validateQti3Accessibility({
    'item-1': choiceXml('<p>Choose one.</p><!-- <img src="ghost.png"> -->'),
  });

  expect(report.findings.some((finding) => finding.code === 'qti3_accessibility.missing_alt_text'))
    .toStrictEqual(false);
});

testCase('final QTI accessibility accepts empty alt text for decorative images', () => {
  const report = validateQti3Accessibility({
    'item-1': choiceXml('<p>Choose one.</p><img src="divider.png" alt=""/>'),
  });

  expect(report.findings.some((finding) => finding.code === 'qti3_accessibility.missing_alt_text'))
    .toStrictEqual(false);
});

testCase('serialized accessibility reports reject contradictory outcomes', () => {
  expect(() =>
    parseQti3AccessibilityReport({
      qti3CoreVersion: QTI3_ACCESSIBILITY_CORE_VERSION,
      policyVersion: QTI3_ACCESSIBILITY_POLICY_VERSION,
      outcome: 'passed',
      findings: [{
        itemId: 'item-1',
        code: 'qti3_accessibility.missing_alt_text',
        severity: 'warning',
        message: 'Missing alt text.',
      }],
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('cannot contain findings')
    ),
  );
});

testCase('serialized accessibility evidence retains its exact originating release', () => {
  const report = {
    qti3CoreVersion: '0.13.0',
    policyVersion: QTI3_ACCESSIBILITY_POLICY_VERSION,
    outcome: 'passed' as const,
    findings: [],
  };
  expect(parseQti3AccessibilityReport(report)).toStrictEqual(report);
  for (const version of ['latest', '^0.13.0', '00.13.0', '0.13', ' 0.13.0 ', '', null]) {
    expect(() => parseQti3AccessibilityReport({ ...report, qti3CoreVersion: version }))
      .toThrowError(Error);
  }
});

testCase('final QTI accessibility reports missing media labels, captions, and transcripts', () => {
  const video = exportQti3TestItemXml(
    'media',
    {
      type: 'media',
      title: 'Video sample',
      bodyHtml: '<p>Watch the clip.</p>',
      promptHtml: '<p>Play the video.</p>',
      mediaKind: 'video',
      mediaSources: [{ src: 'clip.mp4', type: 'video/mp4' }],
      mediaInteractionLabel: '',
      mediaObjectLabel: '',
      mediaAutostart: false,
      mediaLoop: false,
    },
    { identifier: 'item-video' },
  );
  const object = exportQti3TestItemXml(
    'media',
    {
      type: 'media',
      title: 'Object sample',
      bodyHtml: '<p>Open the resource.</p>',
      promptHtml: '<p>Review the object.</p>',
      mediaKind: 'object',
      mediaSources: [{ src: 'resource.pdf', type: 'application/pdf' }],
      mediaInteractionLabel: 'Reference resource',
      mediaObjectLabel: '',
      mediaAutostart: false,
      mediaLoop: false,
    },
    { identifier: 'item-object' },
  );

  const report = validateQti3Accessibility({ video, object });
  const codes = report.findings.map((finding) => finding.code);

  expect(codes.includes('qti3_accessibility.missing_media_label')).toStrictEqual(true);
  expect(codes.includes('qti3_accessibility.missing_object_label')).toStrictEqual(true);
  expect(codes.includes('qti3_accessibility.missing_captions')).toStrictEqual(true);
  expect(codes.includes('qti3_accessibility.missing_transcript')).toStrictEqual(true);
});

function choiceXml(bodyHtml: string): string {
  return exportQti3TestItemXml(
    'single_select',
    {
      type: 'single_select',
      title: 'Accessibility sample',
      bodyHtml,
      choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
      correctId: 'A',
    },
    { identifier: 'item-accessibility' },
  );
}
