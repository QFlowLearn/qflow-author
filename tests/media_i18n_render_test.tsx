import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { MediaContent } from '../islands/drivers/media.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const englishSurface = [
  'What are learners opening?',
  'Media file',
  'Image or document',
  'Accessible description',
  'Describe the image or document',
  'Describe the content or purpose for learners who cannot see it.',
  'Advanced source settings',
  'Edit an imported package path or URL, or add alternate encodings for wider player support.',
  'Add alternate source',
  'Primary source',
  'Alternate source',
  'MIME type',
  'Remove source',
  'Captions (VTT URL)',
  'Caption language',
  'Transcript',
  'Plain text transcript for audio/video.',
  'Upload video',
  'Replace video',
  'Upload image or PDF',
  'Replace image or PDF',
  'Drag and drop video here, or choose a file.',
  'Drag and drop image or PDF here, or choose a file.',
  'Maximum file size: 24 MB.',
  'Images up to 8 MB; PDFs up to 20 MB.',
  'This source cannot be previewed here.',
  'Upload a replacement or edit it in advanced settings.',
  'No media source has been added.',
  'This file has no inline preview. Use Open file to review it.',
  'Open file',
  'Remove file',
];
function media(locale: InterfaceLocale, kind: 'object' | 'video', withSource = false) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <MediaContent
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
        imageComposition={{
          bodyHtml: '<p>AUTHORED-BODY-Ω</p>',
          promptHtml: 'AUTHORED-PROMPT-漢字',
          accessibleDescription: 'AUTHORED-LABEL',
        }}
        responseIdentifier='RESPONSE_Ω'
        mediaKind={kind}
        mediaSources={kind === 'object' || withSource
          ? [{ src: 'assets/media.mp4', type: 'video/mp4' }, {
            src: 'https://example.test/alt?x=1&y=2',
            type: 'audio/ogg',
          }]
          : []}
        mediaCaptionSrc='assets/captions.vtt'
        mediaCaptionLang='en'
        mediaTranscript='AUTHORED-TRANSCRIPT-Ω'
        mediaObjectLabel='<b>AUTHORED-LABEL</b>'
        setResponseIdentifier={noop}
        setMediaKind={noop}
        setMediaCaptionSrc={noop}
        setMediaCaptionLang={noop}
        setMediaTranscript={noop}
        setMediaObjectLabel={noop}
        setPrimaryMediaSource={noop}
        clearPrimaryMediaSource={noop}
        addMediaSource={noop}
        updateMediaSourceSrc={noop}
        updateMediaSourceType={noop}
        removeMediaSource={noop}
      />
    </I18nProvider>,
  );
}
for (const locale of locales) {
  testCase(`media object surface is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = media(locale, 'object');
    for (
      const key of [
        'mediaPrompt',
        'mediaOpeningLabel',
        'mediaFile',
        'mediaAccessibleDescription',
        'mediaAccessibleDescriptionPlaceholder',
        'mediaAccessibleDescriptionHelp',
        'mediaAdvancedSettings',
        'mediaAdvancedHelp',
        'mediaAddAlternate',
        'mediaPrimarySource',
        'mediaAlternateSource',
        'mediaMimeType',
      ] as const
    ) {
      expect(html).toContain(i18n.t(`driver.${key}`));
    }
    for (
      const [value, label] of [['video', i18n.t('driver.mediaVideo')], [
        'audio',
        i18n.t('driver.mediaAudio'),
      ], ['object', i18n.t('driver.mediaImageDocument')]]
    ) expect(html).toContain(`value="${value}">${label}</option>`);
    expect(html).toContain('value="&lt;b>AUTHORED-LABEL&lt;/b>"');
    expect(html).toContain('value="assets/media.mp4"');
    expect(html).toContain('value="video/mp4"');
    expect(html).toContain('https://example.test/alt?x=1&amp;y=2');
    expect(html).toContain(i18n.t('editor.mediaReplace', {
      kind: i18n.t('editor.mediaKindImagePdf'),
    }));
    expect(html).toContain(i18n.t('editor.mediaUploadHelper', {
      kind: i18n.t('editor.mediaKindImagePdf'),
    }));
    expect(html).toContain(i18n.t('editor.mediaLimit'));
    expect(html).toContain(i18n.t('editor.mediaBlockedSource'));
    for (const number of [1, 2]) {
      expect(html).toContain(`aria-label="${i18n.t('driver.mediaRemoveSource', { number })}"`);
    }
    expect(
      (html.match(new RegExp(`>${i18n.t('driver.mediaRemoveSourceVisible')}<`, 'g')) ?? []).length,
    ).toStrictEqual(2);
    if (html.includes(i18n.t('driver.mediaCaptions'))) {
      expect.unreachable("Expected !html.includes(i18n.t('driver.mediaCaptions'))");
    }
    if (html.includes(i18n.t('driver.mediaCaptionLanguage'))) {
      expect.unreachable("Expected !html.includes(i18n.t('driver.mediaCaptionLanguage'))");
    }
    if (html.includes(i18n.t('driver.mediaTranscript'))) {
      expect.unreachable("Expected !html.includes(i18n.t('driver.mediaTranscript'))");
    }
    if (!(!html.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(html))) {
      expect.unreachable(
        "Expected !html.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(html)",
      );
    }
    if (locale === 'es-ES' || locale === 'es-419') {
      for (const phrase of englishSurface) {
        if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
      }
    }
  });
  testCase(`media video empty source state is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = media(locale, 'video');
    expect(html).toContain(i18n.t('editor.mediaUpload', {
      kind: i18n.t('editor.mediaKindVideo'),
    }));
    expect(html).toContain(i18n.t('editor.mediaUploadHelper', {
      kind: i18n.t('editor.mediaKindVideo'),
    }));
    expect(html).toContain(i18n.t('editor.mediaLimitSingle', { max: 24 }));
    expect(html).toContain(i18n.t('driver.mediaTranscriptPlaceholder'));
    expect(html).toContain(i18n.t('driver.mediaNoSources'));
    if (html.includes(i18n.t('driver.mediaAccessibleDescription'))) {
      expect.unreachable("Expected !html.includes(i18n.t('driver.mediaAccessibleDescription'))");
    }
    if (html.includes('driver.')) expect.unreachable("Expected !html.includes('driver.')");
    if (locale === 'es-ES' || locale === 'es-419') {
      for (const phrase of englishSurface) {
        if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
      }
    }
  });
  testCase(`media video populated captions are localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = media(locale, 'video', true);
    expect(html).toContain(i18n.t('editor.mediaReplace', {
      kind: i18n.t('editor.mediaKindVideo'),
    }));
    expect(html).toContain(i18n.t('editor.mediaUploadHelper', {
      kind: i18n.t('editor.mediaKindVideo'),
    }));
    expect(html).toContain(i18n.t('editor.mediaLimitSingle', { max: 24 }));
    for (
      const key of [
        'mediaVideo',
        'mediaCaptions',
        'mediaCaptionLanguage',
        'mediaTranscript',
        'mediaTranscriptPlaceholder',
        'mediaAdvancedSettings',
        'mediaAdvancedHelp',
        'mediaAddAlternate',
      ] as const
    ) expect(html).toContain(i18n.t(`driver.${key}`));
    for (const value of ['assets/captions.vtt', 'en', 'AUTHORED-TRANSCRIPT-Ω']) {
      expect(html).toContain(value);
    }
    expect(html).toContain('value="assets/media.mp4"');
    expect(html).toContain('value="video/mp4"');
    expect(html).toContain('placeholder="assets/captions.vtt"');
    expect(html).toContain('placeholder="en"');
    expect(html).toContain('>AUTHORED-TRANSCRIPT-Ω</textarea>');
    if (html.includes(i18n.t('driver.mediaAccessibleDescription'))) {
      expect.unreachable("Expected !html.includes(i18n.t('driver.mediaAccessibleDescription'))");
    }
    if (html.includes('driver.')) expect.unreachable("Expected !html.includes('driver.')");
    if (locale === 'es-ES' || locale === 'es-419') {
      for (const phrase of englishSurface) {
        if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
      }
    }
  });
}
