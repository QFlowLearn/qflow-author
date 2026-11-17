import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import Header from '../components/Header.tsx';
import { createI18nPayload } from '../lib/i18n/payload.ts';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { QFlowLearnLogo } from '../components/Logo.tsx';
import { AppDocument, PrimaryFontPreload } from '../components/AppDocument.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

testCase('app document preloads only the primary latin Inter face', () => {
  const html = renderToString(<PrimaryFontPreload />);

  expect(html).toContain('rel="preload"');
  expect(html).toContain('href="/fonts/inter-latin.woff2"');
  expect(html).toContain('as="font"');
  expect(html).toContain('type="font/woff2"');
  expect(html).toContain('crossorigin="anonymous"');
  expect(html.includes('inter-latin-ext.woff2')).toStrictEqual(false);
  if (!((html.includes('/fonts/cormorant-garamond')) === false)) {
    expect.unreachable("Expected html.includes('/fonts/cormorant-garamond') to be false");
  }
  if (!((html.includes('/fonts/public-sans')) === false)) {
    expect.unreachable("Expected html.includes('/fonts/public-sans') to be false");
  }
  if (!((html.includes('/fonts/roboto')) === false)) {
    expect.unreachable("Expected html.includes('/fonts/roboto') to be false");
  }
});

testCase('app document carries request locale and direction', () => {
  const renderedByLocale: Record<string, string> = {};
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const catalog = catalogForLocale(locale);
    const html = renderToString(
      <AppDocument
        state={{ interfaceLocale: locale }}
        notices={null}
        header={
          <Header
            currentPath='/login'
            i18n={createI18n(locale, catalog)}
            payload={createI18nPayload(locale, catalog, ['core'])}
          />
        }
      >
        <div>opaque-child-marker</div>
      </AppDocument>,
    );
    renderedByLocale[locale] = html;
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain(
      locale === 'es-ES' || locale === 'es-419' ? 'Iniciar sesión' : 'Sign in',
    );
    expect(html).toContain('opaque-child-marker');
    expect(html.includes('nav.signIn')).toStrictEqual(false);
  }
  expect(renderedByLocale['en-US'] !== renderedByLocale['es-ES']).toStrictEqual(true);
  expect(renderedByLocale['en-GB'] !== renderedByLocale['es-419']).toStrictEqual(true);
});

testCase('app typography matches the marketing sans stack', async () => {
  const css = await _fs.readFile(new URL('../static/styles.css', import.meta.url), 'utf8');

  expect(css).toContain("font-family: 'Inter Variable';");
  expect(css).toContain(
    "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue',",
  );
  expect(css).toContain('--font-body: var(--font-sans);');
  expect(css).toContain('--font-display: var(--font-sans);');
  if (!((css.includes('Cormorant Garamond')) === false)) {
    expect.unreachable("Expected css.includes('Cormorant Garamond') to be false");
  }

  for (const asset of ['inter-latin.woff2', 'inter-latin-ext.woff2']) {
    const info = await _fs.stat(new URL(`../static/fonts/${asset}`, import.meta.url));
    expect(info.isFile()).toStrictEqual(true);
  }
});

testCase('QFlowLearn wordmark owns a sans-serif typography contract', async () => {
  const html = renderToString(<QFlowLearnLogo />);
  const css = await _fs.readFile(new URL('../static/styles.css', import.meta.url), 'utf8');
  const rootDeclarations = css.match(/:root\s*{(?<declarations>[\s\S]*?)}/)?.groups?.declarations ??
    '';
  const wordmarkDeclarations = css.match(
    /\.qflow-wordmark\s*{(?<declarations>[\s\S]*?)}/,
  )?.groups?.declarations ?? '';

  expect(html).toContain('qflow-wordmark');
  if (!((html.includes('qf-display')) === false)) {
    expect.unreachable("Expected html.includes('qf-display') to be false");
  }
  expect(css.match(/--font-wordmark\s*:/g)?.length).toStrictEqual(1);
  expect(css.match(/\.qflow-wordmark\s*{/g)?.length).toStrictEqual(1);
  expect(rootDeclarations).toContain('--font-wordmark: var(--font-sans);');
  expect(wordmarkDeclarations).toContain('font-family: var(--font-wordmark);');
  expect(rootDeclarations).toContain("--font-sans:\n    'Inter Variable', ui-sans-serif");
  if (!((/(?:^|[\s,])serif(?:[\s,;]|$)/i.test(rootDeclarations)) === false)) {
    expect.unreachable(
      'Expected /(?:^|[\\s,])serif(?:[\\s,;]|$)/i.test(rootDeclarations) to be false',
    );
  }
});
