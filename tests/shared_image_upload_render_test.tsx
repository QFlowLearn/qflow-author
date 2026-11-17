import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import AssetUpload from '../components/ui/AssetUpload.tsx';
import ImageUpload from '../components/ui/ImageUpload.tsx';
import ImageAssetEditor from '../components/ui/ImageAssetEditor.tsx';
import MediaFileUpload from '../components/ui/MediaFileUpload.tsx';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

function localized(locale: InterfaceLocale, children: preact.ComponentChildren): string {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return render(<I18nProvider payload={payload}>{children}</I18nProvider>);
}

testCase('ImageUpload renders each source state with localized framing', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const upload = localized(
      locale,
      <AssetUpload
        accept='image/*'
        buttonLabel='AUTHORED-UPLOAD'
        busyLabel='AUTHORED-BUSY'
        helperText='AUTHORED-HELP'
        disabled
        onSelected={() => Promise.resolve({ _tag: 'ok' as const })}
      />,
    );
    expect(upload).toContain('AUTHORED-UPLOAD');
    expect(upload).toContain('AUTHORED-HELP');
    expect(upload).toContain('disabled');
    const empty = localized(
      locale,
      <ImageUpload label='EMPTY-LABEL' value='' onChange={() => {}} />,
    );
    expect(empty).toContain('EMPTY-LABEL');
    expect(empty).toContain(i18n.t('editor.uploadImage'));
    expect(empty).toContain(i18n.t('editor.uploadHelper'));
    expect(empty).toContain('accept="image/*"');
    if (empty.includes('role="alert"')) {
      expect.unreachable('Expected !empty.includes(\'role="alert"\')');
    }

    const safe = localized(
      locale,
      <ImageUpload
        label='AUTHORED-LABEL'
        value='https://cdn.example.test/a&b.png'
        alt='AUTHORED-ALT & <tag>'
        compact
        disabled
        onChange={() => {}}
      />,
    );
    expect(safe).toContain('AUTHORED-LABEL');
    expect(safe).toContain('AUTHORED-ALT &amp; &lt;tag>');
    expect(safe).toContain('https://cdn.example.test/a&amp;b.png');
    expect(safe).toContain('target="_blank"');
    expect(safe).toContain('rel="noopener noreferrer"');
    expect(safe).toContain(i18n.t('editor.replaceImage'));
    expect(safe).toContain('ds-btn-xs');

    const embedded = localized(
      locale,
      <ImageUpload
        label='EMBEDDED-LABEL'
        value='data:image/png;base64,abc'
        alt=''
        onChange={() => {}}
      />,
    );
    expect(embedded).toContain(i18n.t('editor.imageSource'));
    expect(embedded).toContain(i18n.t('editor.embeddedImage'));
    expect(embedded).toContain(i18n.t('editor.altGuidance'));

    const blocked = localized(
      locale,
      <ImageUpload
        label='BLOCKED-LABEL'
        value='javascript:alert(1)'
        alt=''
        onChange={() => {}}
      />,
    );
    expect((blocked.match(/role="alert"/g) ?? []).length).toStrictEqual(1);
    expect(blocked).toContain(i18n.t('editor.imageBlockedRecovery'));
    if (blocked.includes('href="javascript:alert')) {
      expect.unreachable("Expected !blocked.includes('href=\"javascript:alert')");
    }
    expect(blocked).toContain('value="javascript:alert(1)"');
  }
});

testCase('MediaFileUpload renders kind-specific previews, limits, and blocked states', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const kind of ['audio', 'video', 'object'] as const) {
      const empty = localized(
        locale,
        <MediaFileUpload kind={kind} onChange={() => {}} onClear={() => {}} />,
      );
      const label = kind === 'audio'
        ? i18n.t('editor.mediaKindAudio')
        : kind === 'video'
        ? i18n.t('editor.mediaKindVideo')
        : i18n.t('editor.mediaKindImagePdf');
      expect(empty).toContain(i18n.t('editor.mediaUpload', { kind: label }));
      expect(empty).toContain(i18n.t('editor.mediaUploadHelper', { kind: label }));
      expect(empty).toContain(
        kind === 'object'
          ? i18n.t('editor.mediaLimit')
          : i18n.t('editor.mediaLimitSingle', { max: 24 }),
      );
      expect(empty).toContain(
        `accept="${kind === 'object' ? 'image/*,application/pdf' : `${kind}/*`}"`,
      );
    }
    const audio = localized(
      locale,
      <MediaFileUpload
        kind='audio'
        source={{ src: 'https://cdn.example.test/sound.mp3?a=1&b=2', type: 'audio/mpeg' }}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(audio).toContain('<audio');
    expect(audio).toContain('audio/mpeg');
    expect(audio).toContain('https://cdn.example.test/sound.mp3?a=1&amp;b=2');
    expect(audio).toContain(i18n.t('editor.mediaOpenFile'));
    expect(audio).toContain(i18n.t('editor.mediaRemoveFile'));
    expect(audio).toContain('rel="noopener noreferrer"');
    const video = localized(
      locale,
      <MediaFileUpload
        kind='video'
        source={{ src: 'https://cdn.example.test/movie.mp4', type: 'video/mp4' }}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(video).toContain('<video');
    expect(video).toContain('video/mp4');
    const pdf = localized(
      locale,
      <MediaFileUpload
        kind='object'
        source={{ src: 'https://cdn.example.test/guide.pdf', type: 'application/pdf' }}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(pdf).toContain(i18n.t('editor.mediaNoPreview'));
    expect(pdf).toContain(i18n.t('editor.mediaOpenFile'));
    if (pdf.includes('<img')) expect.unreachable("Expected !pdf.includes('<img')");
    const imageObject = localized(
      locale,
      <MediaFileUpload
        kind='object'
        source={{ src: 'https://cdn.example.test/photo.png', type: 'image/png' }}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(imageObject).toContain('<img');
    const blocked = localized(
      locale,
      <MediaFileUpload
        kind='video'
        source={{ src: 'javascript:alert(1)', type: 'video/mp4' }}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(blocked).toContain(i18n.t('editor.mediaBlockedSource'));
    if (blocked.includes('href="javascript:alert')) {
      expect.unreachable("Expected !blocked.includes('href=\"javascript:alert')");
    }
  }
});

testCase('ImageAssetEditor preserves authored metadata while localizing fallback framing', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = localized(
      locale,
      <ImageAssetEditor
        labels={{
          source: 'AUTHORED-SOURCE',
          alt: 'AUTHORED-ALT-FIELD',
          altPlaceholder: 'AUTHORED-ALT-PLACEHOLDER',
        }}
        value={{
          source: 'https://example.test/image.png?a=1&b=2',
          alt: 'AUTHORED & ALT',
          longDescription: 'AUTHORED-DESCRIPTION',
          mimeType: 'image/png',
          width: 320,
          height: 240,
        }}
        fields={['longDescription', 'mimeType', 'width', 'height']}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('AUTHORED-SOURCE');
    expect(html).toContain('AUTHORED-ALT-FIELD');
    expect(html).toContain('AUTHORED-ALT-PLACEHOLDER');
    expect(html).toContain('AUTHORED-DESCRIPTION');
    expect(html).toContain('https://example.test/image.png?a=1&amp;b=2');
    expect(html).toContain('AUTHORED &amp; ALT');
    expect(html).toContain('image/png');
    expect(html).toContain('value="320"');
    expect(html).toContain('value="240"');
    expect(html).toContain(i18n.t('editor.imageLongDescription'));
    expect(html).toContain(i18n.t('editor.mimeTypeOptional'));
    expect(html).toContain(i18n.t('editor.widthPixels'));
    expect(html).toContain(i18n.t('editor.heightPixels'));
    expect(html).not.toMatch(/editor\.[a-zA-Z]+/);
    if (locale.startsWith('es-')) {
      if (html.includes('Upload image')) {
        expect.unreachable("Expected !html.includes('Upload image')");
      }
      if (html.includes('Replace image')) {
        expect.unreachable("Expected !html.includes('Replace image')");
      }
      if (html.includes('Open file')) {
        expect.unreachable("Expected !html.includes('Open file')");
      }
      if (html.includes('Long description (optional)')) {
        expect.unreachable("Expected !html.includes('Long description (optional)')");
      }
    }
  }
});
