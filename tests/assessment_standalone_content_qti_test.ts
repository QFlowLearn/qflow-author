import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { parseQtiTestRubrics } from '@longsightgroup/qti3-core';
import { qti3TrustedXmlFragment, writeQti3FixedAssessmentTest } from '@longsightgroup/qti3-writer';
import {
  assessmentContentQtiFragment,
  parseStandaloneRubric,
} from '../lib/assessment_content_qti.ts';
import type { AssessmentStandaloneContent } from '../lib/assessment_standalone_content.ts';

function testXml(fragment: string): string {
  const written = writeQti3FixedAssessmentTest({
    identifier: 'content-test',
    title: 'Content test',
    parts: [{
      identifier: 'part',
      title: 'Part',
      navigationMode: 'nonlinear',
      submissionMode: 'individual',
      feedback: [],
      sections: [{
        identifier: 'first',
        title: 'First',
        items: [{ identifier: 'first-question', href: 'items/first.xml', categories: [] }],
      }, {
        identifier: 'content',
        title: 'Instructions',
        items: [],
        instructions: qti3TrustedXmlFragment(fragment),
      }, {
        identifier: 'second',
        title: 'Second',
        items: [{ identifier: 'second-question', href: 'items/second.xml', categories: [] }],
      }],
    }],
  });
  if (!(written.ok)) expect.unreachable('Expected written.ok');
  return written.value;
}

const contents: readonly AssessmentStandaloneContent[] = [
  { kind: 'text', text: 'Read α & β <script> literally.\r\nThen answer.' },
  {
    kind: 'image',
    src: 'assets/diagram.svg',
    alt: 'Two blue rectangles\r\nstacked\ttogether',
    longDescription: 'One rectangle is above\nthe other.',
  },
  {
    kind: 'video',
    src: 'assets/movie.mp4',
    mimeType: 'video/mp4',
    title: 'A rectangle\r\nmoves',
    captionSrc: 'assets/captions.vtt',
    captionLanguage: 'en-US',
    transcript: 'A blue rectangle\nmoves above the other.',
  },
  {
    kind: 'video-link',
    url: 'https://youtu.be/example',
    title: 'A demonstration',
    transcript: 'The rectangles move in sequence.',
    networkNotice: 'Internet access is required. Your school may block this destination.',
  },
];

testCase(
  'shared section rubric parsing round-trips every supported standalone content variant with two real references',
  async () => {
    for (const content of contents) {
      const xml = testXml(assessmentContentQtiFragment(content));
      const rubrics = parseQtiTestRubrics(xml);
      if (!(rubrics.ok)) expect.unreachable('Expected rubrics.ok');
      expect(rubrics.value.length).toStrictEqual(1);
      expect(parseStandaloneRubric(rubrics.value[0].node)).toStrictEqual(content);
      expect((xml.match(/<qti-assessment-item-ref /g) ?? []).length).toStrictEqual(2);
      if (xml.includes('qti-media-interaction')) {
        expect.unreachable("Expected !xml.includes('qti-media-interaction')");
      }
      if (xml.includes('qti-response-declaration')) {
        expect.unreachable("Expected !xml.includes('qti-response-declaration')");
      }
      const destination = process.env['QFLOW_CONTENT_SCHEMA_PROBE'];
      if (destination) {
        if (!(destination.startsWith('/private/tmp/'))) {
          expect.unreachable("Expected destination.startsWith('/private/tmp/')");
        }
        await _fs.writeFile(`${destination}-${content.kind}.xml`, xml, 'utf8');
      }
    }
  },
);

testCase(
  'standalone rubric adapter rejects additional markup, unsafe references and changed playback/accessibility metadata',
  () => {
    const image = assessmentContentQtiFragment(contents[1]);
    const video = assessmentContentQtiFragment(contents[2]);
    const online = assessmentContentQtiFragment(contents[3]);
    for (
      const fragment of [
        image.replace('alt=', 'onclick="bad()" alt='),
        image.replace('assets/diagram.svg', 'javascript:bad()'),
        video.replace('controls="controls"', 'autoplay="autoplay" controls="controls"'),
        video.replace('aria-label="A rectangle&#13;&#10;moves"', 'aria-label="Different title"'),
        video.replace('kind="captions"', 'kind="metadata"'),
        video.replace('default="default"', 'onload="bad()" default="default"'),
        online.replace('https://youtu.be/example', 'https://evil.example/movie'),
        online.replace('https://youtu.be/example', 'javascript:bad()'),
        '<p xmlns="https://evil.example/namespace">Foreign markup</p>',
      ]
    ) {
      const parsed = parseQtiTestRubrics(testXml(fragment));
      if (parsed.ok) expect(() => parseStandaloneRubric(parsed.value[0].node)).toThrowError(Error);
    }
  },
);
