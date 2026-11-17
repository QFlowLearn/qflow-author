import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { DrawingContent } from '../islands/drivers/drawing.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};

function renderDrawing(locale: InterfaceLocale, populated: boolean) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  const image = populated
    ? {
      source: 'https://example.test/drawing?a=1&b=2',
      alt: '<img data-drawing-injection src=x>ALT-Ω漢字',
      longDescription: '<b>AUTHORED-LONG-Ω</b>',
      mimeType: 'image/svg+xml',
      width: 640,
      height: 360,
    }
    : { source: '', alt: '', longDescription: '', mimeType: '' };
  return renderToString(
    <I18nProvider payload={payload}>
      <DrawingContent
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
        responseIdentifier='RESPONSE_Ω'
        image={image}
        setResponseIdentifier={noop}
        setImage={noop}
      />
    </I18nProvider>,
  );
}

for (const locale of locales) {
  testCase(`drawing surface is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderDrawing(locale, true);
    for (
      const key of [
        'drawingPrompt',
        'drawingImageSource',
        'drawingImageAlt',
        'drawingImageAltPlaceholder',
        'drawingImageLongDescription',
        'drawingImageMimeType',
        'drawingImageWidth',
        'drawingImageHeight',
      ] as const
    ) expect(html).toContain(i18n.t(`driver.${key}`));
    // ResponseIdentifierDisclosure intentionally has no SSR output; the browser
    // test verifies that the stable response identifier survives upload/edits.
    expect(html).toContain('https://example.test/drawing?a=1&amp;b=2');
    expect(html).toContain('&lt;img data-drawing-injection src=x>ALT-Ω漢字');
    expect(html).toContain('&lt;b>AUTHORED-LONG-Ω&lt;/b>');
    expect(html).toContain('image/svg+xml');
    expect(html).toContain('value="640"');
    expect(html).toContain('value="360"');
    if (html.includes('<img data-drawing-injection')) {
      expect.unreachable("Expected !html.includes('<img data-drawing-injection')");
    }
    if (html.includes('driver.')) expect.unreachable("Expected !html.includes('driver.')");
    if (/\{(?:count|plural|select)(?:[,}])/.test(html)) {
      expect.unreachable('Expected !/\\{(?:count|plural|select)(?:[,}])/.test(html)');
    }
    if (html.includes('assessments.')) {
      expect.unreachable("Expected !html.includes('assessments.')");
    }
    if (locale === 'es-ES' || locale === 'es-419') {
      for (
        const phrase of [
          'Draw or highlight',
          'Image source',
          'Image alt text',
          'Description of the canvas',
          'Image long description',
          'Image MIME type',
          'Image width',
          'Image height',
        ]
      ) if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
    }
  });

  testCase(`drawing empty image state is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderDrawing(locale, false);
    expect(html).toContain(i18n.t('driver.drawingPrompt'));
    expect(html).toContain(i18n.t('editor.uploadImage'));
    expect(html).toContain(i18n.t('editor.uploadHelper'));
    if (html.includes('driver.')) expect.unreachable("Expected !html.includes('driver.')");
  });
}
