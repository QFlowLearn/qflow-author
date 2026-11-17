import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import ImageQuestionCompositionPreview from '../components/ui/ImageQuestionCompositionPreview.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const LOCALES: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase(
  'image composition preview renders sanitized question context and accessibility review',
  () => {
    for (const locale of LOCALES) {
      const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
      const html = renderToString(
        <I18nProvider payload={payload}>
          <ImageQuestionCompositionPreview
            composition={{
              bodyHtml: '<p>Which region changed?</p><script>alert(1)</script>',
              promptHtml: '<strong>Review the timeline.</strong>',
              accessibleDescription: 'Four colored regions surrounding a transparent center.',
            }}
          >
            <canvas aria-label='Edited timeline' />
          </ImageQuestionCompositionPreview>
        </I18nProvider>,
      );

      const messages = payload.namespaces.authoring;
      expect(html).toContain(`aria-label="${messages['editor.questionCompositionPreview']}"`);
      expect(html).toContain('Which region changed?');
      expect(html).toContain('Review the timeline.');
      expect(html).toContain(messages['editor.accessibleDescription']);
      expect(html).toContain('Four colored regions surrounding a transparent center.');
      if (html.includes('<script>')) expect.unreachable("Expected !html.includes('<script>')");
    }
  },
);

testCase('image composition preview exposes missing accessibility text', () => {
  for (const locale of LOCALES) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const html = renderToString(
      <I18nProvider payload={payload}>
        <ImageQuestionCompositionPreview
          composition={{
            bodyHtml: '',
            promptHtml: '',
            accessibleDescription: ' ',
          }}
        >
          <canvas />
        </ImageQuestionCompositionPreview>
      </I18nProvider>,
    );

    const messages = payload.namespaces.authoring;
    expect(html).toContain(messages['editor.questionTextPreview']);
    expect(html).toContain(messages['editor.noAccessibleDescription']);
    expect(html).toContain('text-warning');
  }
});
