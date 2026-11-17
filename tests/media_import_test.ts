import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { type MediaDraft } from '../lib/types/media.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'media-example-1.xml';

testCase('media import: fixture → draft contains sources', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<MediaDraft>(parsed, 'media');
  expect(draft.mediaKind).toStrictEqual('video');
  const sources = draft.mediaSources ?? [];
  if (!(sources.length >= 2)) expect.unreachable('Expected sources.length >= 2');
  if (!(sources.some((s) => (s.src ?? '').includes('bubble.mp4')))) {
    expect.unreachable("Expected sources.some((s) => (s.src ?? '').includes('bubble.mp4'))");
  }
  expect(draft.mediaMaxPlays).toStrictEqual(3);
});

testCase('media import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<MediaDraft>(parsed, 'media');
  const rebuilt = exportQti3TestItemXml(
    'media',
    {
      title: draft.title,
      promptHtml: draft.promptHtml,
      bodyHtml: draft.bodyHtml,
      responseIdentifier: draft.responseIdentifier,
      mediaKind: draft.mediaKind,
      mediaSources: draft.mediaSources ?? [],
      mediaInteractionLabel: draft.mediaInteractionLabel,
      mediaObjectLabel: draft.mediaObjectLabel,
      mediaCaptionSrc: draft.mediaCaptionSrc,
      mediaCaptionLang: draft.mediaCaptionLang,
      mediaTranscript: draft.mediaTranscript,
      mediaAutostart: draft.mediaAutostart,
      mediaLoop: draft.mediaLoop,
      mediaMinPlays: draft.mediaMinPlays,
      mediaMaxPlays: draft.mediaMaxPlays,
      mediaCoords: draft.mediaCoords,
      mediaWidth: draft.mediaWidth,
      mediaHeight: draft.mediaHeight,
      sharedVocabulary: draft.sharedVocabulary,
    },
    { identifier: 'item-media-roundtrip' },
  );

  if (!(rebuilt.includes('bubble.mp4'))) {
    expect.unreachable("Expected rebuilt.includes('bubble.mp4')");
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  const reDraft = draftOfType<MediaDraft>(reparsed, 'media');
  const reSources = reDraft.mediaSources ?? [];
  if (!(reSources.some((s) => (s.src ?? '').includes('bubble.mp4')))) {
    expect.unreachable("Expected reSources.some((s) => (s.src ?? '').includes('bubble.mp4'))");
  }
});

testCase('media import parses captions track', () => {
  const xml = exportQti3TestItemXml(
    'media',
    {
      title: 'Video with captions',
      promptHtml: '<p>Watch</p>',
      bodyHtml: '<p>Body</p>',
      responseIdentifier: 'RESPONSE',
      mediaKind: 'video',
      mediaSources: [{ src: 'clip.mp4', type: 'video/mp4' }],
      mediaCaptionSrc: 'captions.vtt',
      mediaCaptionLang: 'en',
      mediaAutostart: false,
      mediaLoop: false,
      mediaMinPlays: 0,
      mediaMaxPlays: 0,
    },
    { identifier: 'item-media-captioned' },
  );

  const parsed = parseItemXml(xml);
  const draft = draftOfType<MediaDraft>(parsed, 'media');
  expect(draft.mediaCaptionSrc).toStrictEqual('captions.vtt');
  expect(draft.mediaCaptionLang).toStrictEqual('en');
});

testCase('media import round-trip preserves multiple player control tokens', () => {
  const xml = exportQti3TestItemXml(
    'media',
    {
      title: 'Video controls',
      promptHtml: '<p>Watch</p>',
      bodyHtml: '<p>Body</p>',
      responseIdentifier: 'RESPONSE',
      mediaKind: 'video',
      mediaSources: [{ src: 'clip.mp4', type: 'video/mp4' }],
      mediaAutostart: false,
      mediaLoop: false,
      mediaMinPlays: 0,
      mediaMaxPlays: 0,
      sharedVocabulary: { mediaPlayerControls: ['play', 'captions'] },
    },
    { identifier: 'item-media-controls' },
  );

  if (!(xml.includes('data-qti-media-player-controls="play captions"'))) {
    expect.unreachable('Expected xml.includes(\'data-qti-media-player-controls="play captions"\')');
  }

  const parsed = parseItemXml(xml);
  expect(parsed.draft.sharedVocabulary?.mediaPlayerControls).toStrictEqual(['play', 'captions']);
});

testCase('media import round-trip preserves inline transcript from companion materials', () => {
  const xml = exportQti3TestItemXml(
    'media',
    {
      title: 'Video with transcript',
      promptHtml: '<p>Watch</p>',
      bodyHtml: '<p>Body</p>',
      responseIdentifier: 'RESPONSE',
      mediaKind: 'video',
      mediaSources: [{ src: 'clip.mp4', type: 'video/mp4' }],
      mediaTranscript: 'Transcript content',
      mediaAutostart: false,
      mediaLoop: false,
      mediaMinPlays: 0,
      mediaMaxPlays: 0,
    },
    { identifier: 'item-media-transcript' },
  );

  const parsed = parseItemXml(xml);
  const draft = draftOfType<MediaDraft>(parsed, 'media');
  expect(draft.mediaTranscript).toStrictEqual('Transcript content');
});
