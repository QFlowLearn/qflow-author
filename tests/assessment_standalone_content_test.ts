import { expect, test as testCase } from 'vitest';

import { parseAssessmentStandaloneContent } from '../lib/assessment_standalone_content.ts';

const image = {
  kind: 'image',
  src: '/uploads/11111111-1111-4111-8111-111111111111',
  alt: 'Two blue rectangles',
  longDescription: '',
};
const video = {
  kind: 'video',
  src: '/uploads/11111111-1111-4111-8111-111111111111',
  mimeType: 'video/mp4',
  title: 'How the rectangles move',
  captionSrc: '/uploads/22222222-2222-4222-8222-222222222222',
  captionLanguage: 'en-US',
  transcript: 'The left rectangle moves above the right rectangle.',
};
const online = {
  kind: 'video-link',
  url: 'https://www.youtube.com/watch?v=example',
  title: 'Rectangle demonstration',
  transcript: 'The rectangles move in sequence.',
  networkNotice:
    'Online video: internet access is required. The destination may be blocked by your school.',
};

testCase(
  'standalone content parses exact literal, image, captioned video and online-link values without response fields',
  () => {
    for (
      const value of [
        { kind: 'text', text: 'Read <script> literally.\nThen answer.' },
        image,
        video,
        online,
      ]
    ) {
      const parsed = parseAssessmentStandaloneContent(value);
      if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
      expect(parsed.content).toStrictEqual(value);
      expect(parseAssessmentStandaloneContent({ ...value, responseIdentifier: 'RESPONSE' }).ok)
        .toStrictEqual(false);
      expect(parseAssessmentStandaloneContent({ ...value, points: 1 }).ok).toStrictEqual(false);
    }
  },
);

testCase(
  'standalone media rejects unsafe sources, incomplete accessibility and arbitrary embeds',
  () => {
    for (
      const src of [
        'javascript:alert(1)',
        'data:image/svg+xml,<svg/>',
        'blob:https://example.test/id',
        '//unsafe.example/image.png',
        'file:///image.png',
        '\n/uploads/image',
        'assets/di\nagram.svg',
        'assets/di\tagram.svg',
      ]
    ) {
      expect(parseAssessmentStandaloneContent({ ...image, src }).ok, src).toStrictEqual(false);
      expect(parseAssessmentStandaloneContent({ ...video, src }).ok, src).toStrictEqual(false);
    }
    for (
      const value of [
        { ...image, alt: '  ' },
        { ...image, longDescription: '\u0001' },
        { ...video, captionSrc: '' },
        { ...video, captionLanguage: 'en" onload="alert(1)' },
        { ...video, transcript: '' },
        { ...video, mimeType: 'text/html' },
        { ...video, autoplay: true },
        { ...online, url: 'https://evil.example/movie' },
        { ...online, url: 'http://youtu.be/example' },
        { ...online, url: 'https://%79outube.com/example' },
        { ...online, url: 'https://youtu.be/path with space' },
        { ...online, url: 'https://user:password@youtu.be/example' },
        { ...online, url: 'https://youtube.com.evil.example/example' },
        { ...online, networkNotice: '' },
        { ...online, transcript: '' },
        { kind: 'video', iframe: '<iframe src="https://youtube.com/embed/example"></iframe>' },
      ]
    ) expect(parseAssessmentStandaloneContent(value).ok).toStrictEqual(false);
  },
);

testCase(
  'staged native content retains package references for the existing owned-asset import boundary',
  () => {
    if (!(parseAssessmentStandaloneContent({ ...image, src: 'assets/diagram.svg' }).ok)) {
      expect.unreachable(
        "Expected parseAssessmentStandaloneContent({ ...image, src: 'assets/diagram.svg' }).ok",
      );
    }
    if (
      !(parseAssessmentStandaloneContent({
        ...video,
        src: 'assets/movie.mp4',
        captionSrc: 'assets/captions.vtt',
      }).ok)
    ) {
      expect.unreachable(
        "Expected parseAssessmentStandaloneContent({ ...video, src: 'assets/movie.mp4', captionSrc: 'assets/",
      );
    }
  },
);
