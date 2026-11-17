import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsMedia } from '../lib/types/media.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

testCase('media export emits media interaction and sources', async () => {
  const draft = defaultsMedia();
  draft.mediaSources = [
    { src: 'media.mp4', type: 'video/mp4' },
    { src: 'media.webm', type: 'video/webm' },
  ];
  const xml = exportQti3TestItemXml('media', draft, { identifier: 'item-media-1' });

  if (!(xml.includes('<qti-media-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-media-interaction')");
  }
  if (!(xml.includes('<video'))) expect.unreachable("Expected xml.includes('<video')");
  if (!(xml.includes('media.mp4'))) expect.unreachable("Expected xml.includes('media.mp4')");

  await assertQtiXmlWellFormed(xml);
});

testCase('media driver defaults represent an incomplete authoring draft', () => {
  const draft = {
    ...TYPE_DRIVERS.media.defaults(),
    itemLanguage: newAuthoringItemLanguage(),
  };
  expect(draft.mediaSources).toStrictEqual([]);
  expect(TYPE_DRIVERS.media.validate(draft)).toStrictEqual(['Add at least one media source.']);
});

testCase('media export emits captions track and transcript when configured', async () => {
  const draft = defaultsMedia();
  draft.mediaKind = 'video';
  draft.mediaSources = [{ src: 'media.mp4', type: 'video/mp4' }];
  draft.mediaCaptionSrc = 'captions-en.vtt';
  draft.mediaCaptionLang = 'en';
  draft.mediaTranscript = 'This is a transcript.';
  const xml = exportQti3TestItemXml('media', draft, { identifier: 'item-media-a11y' });

  if (!(xml.includes('<track kind="captions" src="captions-en.vtt" srclang="en"/>'))) {
    expect.unreachable(
      'Expected xml.includes(\'<track kind="captions" src="captions-en.vtt" srclang="en"/>\')',
    );
  }
  if (!(xml.includes('<qti-companion-materials-info>'))) {
    expect.unreachable("Expected xml.includes('<qti-companion-materials-info>')");
  }
  if (!(xml.includes('<qti-physical-material>This is a transcript.</qti-physical-material>'))) {
    expect.unreachable(
      "Expected xml.includes('<qti-physical-material>This is a transcript.</qti-physical-material>')",
    );
  }

  await assertQtiXmlWellFormed(xml);
});
