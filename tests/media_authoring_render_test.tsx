import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import ImageUpload from '../components/ui/ImageUpload.tsx';
import { MediaContent } from '../islands/drivers/media.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);
const i18n = createI18n('en-US', payload.namespaces);

testCase('image upload summarizes embedded sources without exposing a URL field', () => {
  const html = renderToString(
    <I18nProvider payload={payload}>
      <ImageUpload
        label='Image src'
        value='data:image/svg+xml;base64,PHN2Zy8+'
        alt='Timeline'
        onChange={() => {}}
      />
    </I18nProvider>,
  );

  expect(html).toContain(i18n.t('editor.imageSource'));
  expect(html).toContain(i18n.t('editor.embeddedImage'));
  expect(html).toContain(i18n.t('editor.uploadHelper'));
  expect(html.includes('Current URL')).toStrictEqual(false);
});

testCase('image upload keeps ordinary source URLs inspectable', () => {
  const html = renderToString(
    <I18nProvider payload={payload}>
      <ImageUpload
        label='Image src'
        value='https://example.com/timeline.png'
        alt='Timeline'
        onChange={() => {}}
      />
    </I18nProvider>,
  );

  expect(html).toContain(i18n.t('editor.currentUrl'));
  expect(html).toContain('https://example.com/timeline.png');
});

testCase(
  'media authoring presents an upload-first image workflow with advanced source access',
  () => {
    const html = renderToString(
      <I18nProvider payload={payload}>
        <MediaContent
          renderPromptField={() => <span />}
          fieldHasIssue={() => false}
          fieldIssueText={() => undefined}
          imageComposition={{
            bodyHtml: '<p>Review the presidential timeline.</p>',
            promptHtml: 'Open the media object.',
            accessibleDescription: 'Presidential timeline',
          }}
          responseIdentifier='RESPONSE'
          mediaKind='object'
          mediaSources={[{
            src: 'data:image/svg+xml;base64,PHN2Zy8+',
            type: 'image/svg+xml',
          }]}
          mediaCaptionSrc=''
          mediaCaptionLang='en'
          mediaTranscript=''
          mediaObjectLabel='Presidential timeline'
          setResponseIdentifier={() => {}}
          setMediaKind={() => {}}
          setMediaCaptionSrc={() => {}}
          setMediaCaptionLang={() => {}}
          setMediaTranscript={() => {}}
          setMediaObjectLabel={() => {}}
          setPrimaryMediaSource={() => {}}
          clearPrimaryMediaSource={() => {}}
          addMediaSource={() => {}}
          updateMediaSourceSrc={() => {}}
          updateMediaSourceType={() => {}}
          removeMediaSource={() => {}}
        />
      </I18nProvider>,
    );

    expect(html).toContain(i18n.t('driver.mediaOpeningLabel'));
    expect(html).toContain(i18n.t('driver.mediaImageDocument'));
    expect(html.includes('QTI calls images and documents')).toStrictEqual(false);
    expect(html).toContain('Drag and drop image or PDF here');
    expect(html).toContain('Edit image');
    expect(html).toContain(i18n.t('driver.mediaAccessibleDescription'));
    expect(html).toContain('Presidential timeline');
    expect(html).toContain(i18n.t('driver.mediaAdvancedSettings'));
    expect(html).toContain(i18n.t('driver.mediaPrimarySource'));
  },
);

testCase('media authoring labels uploaded video controls in instructor language', () => {
  const html = renderToString(
    <I18nProvider payload={payload}>
      <MediaContent
        renderPromptField={() => <span />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
        imageComposition={{
          bodyHtml: '<p>Watch the introduction.</p>',
          promptHtml: 'Play the video.',
          accessibleDescription: '',
        }}
        responseIdentifier='RESPONSE'
        mediaKind='video'
        mediaSources={[]}
        mediaCaptionSrc=''
        mediaCaptionLang='en'
        mediaTranscript=''
        mediaObjectLabel=''
        setResponseIdentifier={() => {}}
        setMediaKind={() => {}}
        setMediaCaptionSrc={() => {}}
        setMediaCaptionLang={() => {}}
        setMediaTranscript={() => {}}
        setMediaObjectLabel={() => {}}
        setPrimaryMediaSource={() => {}}
        clearPrimaryMediaSource={() => {}}
        addMediaSource={() => {}}
        updateMediaSourceSrc={() => {}}
        updateMediaSourceType={() => {}}
        removeMediaSource={() => {}}
      />
    </I18nProvider>,
  );

  expect(html).toContain(i18n.t('editor.mediaUpload', { kind: i18n.t('editor.mediaKindVideo') }));
  expect(html).toContain(
    i18n.t('editor.mediaUploadHelper', { kind: i18n.t('editor.mediaKindVideo') }),
  );
  expect(html).toContain(i18n.t('driver.mediaCaptions'));
  expect(html).toContain(i18n.t('driver.mediaTranscript'));
});
