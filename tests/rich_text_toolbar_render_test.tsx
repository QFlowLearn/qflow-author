import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { ToolbarButton } from '../islands/rich_text/toolbar.tsx';
import { buildA11yMarkup } from '../islands/rich_text/a11y_insert.tsx';
import { normalizeLinkInput } from '../islands/rich_text/link_input.ts';

testCase('rich text toolbar command names are localized for every interface locale', () => {
  const locales: InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
  for (const locale of locales) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const html = render(
      <I18nProvider payload={payload}>
        <div role='toolbar' aria-label={payload.namespaces.authoring['editor.toolbar']}>
          <ToolbarButton
            label='B'
            tooltip={payload.namespaces.authoring['editor.bold']}
            ariaLabel={payload.namespaces.authoring['editor.bold']}
            onClick={() => {}}
          />
          <ToolbarButton
            label='I'
            tooltip={payload.namespaces.authoring['editor.italic']}
            ariaLabel={payload.namespaces.authoring['editor.italic']}
            onClick={() => {}}
          />
        </div>
      </I18nProvider>,
    );
    if (!(html.includes(payload.namespaces.authoring['editor.toolbar']))) {
      expect.unreachable("Expected html.includes(payload.namespaces.authoring['editor.toolbar'])");
    }
    if (!(html.includes(payload.namespaces.authoring['editor.bold']))) {
      expect.unreachable("Expected html.includes(payload.namespaces.authoring['editor.bold'])");
    }
    expect(html).not.toMatch(/editor\.(toolbar|bold|italic)/);
  }
});

testCase('link normalization keeps authored URL semantics independent of locale', () => {
  expect(normalizeLinkInput('example.org')).toStrictEqual('https://example.org');
  expect(normalizeLinkInput('mailto:test@example.org')).toStrictEqual('mailto:test@example.org');
  expect(normalizeLinkInput('https://example.org/a?b=1')).toStrictEqual(
    'https://example.org/a?b=1',
  );
});

testCase('toolbar button and accessibility markup preserve safe machine semantics', () => {
  const toggle = render(
    <ToolbarButton label='B' tooltip='Bold' ariaLabel='Bold' pressed onClick={() => {}} />,
  );
  if (!(toggle.includes('aria-pressed="true"'))) {
    expect.unreachable('Expected toggle.includes(\'aria-pressed="true"\')');
  }
  const action = render(
    <ToolbarButton label='X' tooltip='Remove' ariaLabel='Remove' onClick={() => {}} />,
  );
  if (action.includes('aria-pressed')) {
    expect.unreachable("Expected !action.includes('aria-pressed')");
  }
  const markup = buildA11yMarkup({
    text: '<script>alert(1)</script>',
    style: 'hidden',
    elementId: 'x" onmouseover="bad',
    a11yRole: 'long-description',
    ariaLabel: 'A"B',
    ariaLabelledBy: 'title',
    ariaDescribedBy: 'help',
    catalogIdRef: 'CAT-1',
    ariaHidden: true,
    suppressTts: true,
    ssmlJson: '{"sub":{"alias":"Froyd"}}',
    readingType: 'screen-reader',
  });
  expect(markup).toStrictEqual(
    '<span class="qti-visually-hidden" id="x&quot; onmouseover=&quot;bad" data-qti-a11y-content-role="long-description" data-qti-aria-label="A&quot;B" data-qti-aria-labelledby="title" data-qti-aria-describedby="help" data-catalog-idref="CAT-1" data-qti-aria-hidden="true" data-qti-suppress-tts="true" data-ssml="{&quot;sub&quot;:{&quot;alias&quot;:&quot;Froyd&quot;}}" data-reading-type="screen-reader">&lt;script&gt;alert(1)&lt;/script&gt;</span>',
  );
});
