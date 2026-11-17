import { expect, test as testCase } from 'vitest';

import { type FetchFixtureServer, startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { Buffer } from 'node:buffer';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('drawing authoring interactions are localized in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.drawing-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { DrawingContent } from "${process.cwd()}/islands/drivers/drawing.tsx";
function App({config}) {
  const [state, setState] = useState(config.state);
  const update = (patch) => setState((prev) => ({...prev, ...patch}));
  return h(I18nProvider, {payload: config.payload}, h('main', null,
    h(DrawingContent, {
      responseIdentifier: state.responseIdentifier, image: state.image,
      renderPromptField: (placeholder) => h('input', {placeholder, 'data-testid':'prompt'}),
      fieldHasIssue: () => false, fieldIssueText: () => undefined,
      setResponseIdentifier: (responseIdentifier) => update({responseIdentifier}),
      setImage: (image) => update({image}),
    }), h('output', {'data-state':'drawing'}, JSON.stringify(state))
  ));
}
globalThis.mount = (config) => render(h(App, {config}), document.getElementById('root'));
globalThis.mount(globalThis.__CONFIG__);
`,
      'utf8',
    );
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=esm',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      `--outfile=${bundle}`,
    ], { cwd: process.cwd() });
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const bundleText = await _fs.readFile(bundle, 'utf8');
    for (
      const marker of ['catalogForLocale', 'lib/i18n/messages/', 'playerMessageCatalogForLocale']
    ) {
      if (bundleText.includes(marker)) {
        expect.unreachable('Expected !bundleText.includes(marker)');
      }
    }
    const configs = new Map(locales.map((locale) => [locale, {
      payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      state: {
        responseIdentifier: 'RESPONSE_Ω',
        image: {
          source: 'https://example.test/initial.png',
          alt: '<img data-drawing-stage-injection src=x>ALT-Ω漢字',
          longDescription: '<b>LONG-Ω</b>',
          mimeType: 'image/png',
          width: 640,
          height: 360,
        },
      },
    }]));
    const uploadedUrl = 'https://cdn.example.test/drawing-uploaded.svg';
    const json = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
    server = await startFetchServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const config = configs.get(url.searchParams.get('locale') as InterfaceLocale);
      if (!config) return new Response('Unsupported locale', { status: 400 });
      return new Response(
        `<!doctype html><html lang="${
          url.searchParams.get('locale')
        }"><body><div id="root"></div><script>globalThis.__UNHANDLED__=[];addEventListener('unhandledrejection',e=>globalThis.__UNHANDLED__.push(String(e.reason??'unhandled')));globalThis.__CONFIG__=${
          json(config)
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    browser = await chromium.launch();
    const address = new URL(server.origin);
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on(
        'console',
        (message) => message.type() === 'error' && consoleErrors.push(message.text()),
      );
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        let uploadCount = 0;
        await page.route('**/api/uploads', (route) => {
          uploadCount += 1;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'drawing-upload',
              name: 'drawing.svg',
              type: 'image/svg+xml',
              size: 42,
              url: uploadedUrl,
              createdAt: '2026-01-01T00:00:00.000Z',
            }),
          });
        });
        for (const host of ['https://example.test/**', 'https://cdn.example.test/**']) {
          await page.route(host, (route) =>
            route.fulfill({
              status: 200,
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
            }));
        }
        await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`, {
          waitUntil: 'domcontentloaded',
        });
        const output = page.locator('[data-state=drawing]');
        await page.getByPlaceholder(i18n.t('driver.drawingPrompt')).waitFor();
        const state = async () => JSON.parse(await output.innerText());
        const field = (label: string) =>
          page.locator('label').filter({ hasText: label }).locator('input,textarea').last();
        const visible = async () =>
          (await page.locator('body').innerText()).replace(await output.innerText(), '');
        const assertSafe = async () => {
          const text = await visible();
          if (text.includes('driver.')) {
            expect.unreachable("Expected !text.includes('driver.')");
          }
          if (/\{(?:count|plural|select)(?:[,}])/.test(text)) {
            expect.unreachable('Expected !/\\{(?:count|plural|select)(?:[,}])/.test(text)');
          }
          expect(await page.locator('[data-drawing-stage-injection]').count()).toStrictEqual(0);
          expect(pageErrors).toStrictEqual([]);
          expect(consoleErrors).toStrictEqual([]);
          expect(
            await page.evaluate(() =>
              (globalThis as unknown as { __UNHANDLED__: unknown[] }).__UNHANDLED__
            ),
          ).toStrictEqual([]);
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
            ) if (text.includes(phrase)) expect.unreachable('Expected !text.includes(phrase)');
          }
        };
        expect(await visible()).toContain(i18n.t('driver.drawingImageSource'));
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        expect((await state()).image).toStrictEqual({
          source: 'https://example.test/initial.png',
          alt: '<img data-drawing-stage-injection src=x>ALT-Ω漢字',
          longDescription: '<b>LONG-Ω</b>',
          mimeType: 'image/png',
          width: 640,
          height: 360,
        });
        expect(await field(i18n.t('driver.drawingImageAlt')).inputValue()).toStrictEqual(
          '<img data-drawing-stage-injection src=x>ALT-Ω漢字',
        );
        expect(await field(i18n.t('driver.drawingImageLongDescription')).inputValue())
          .toStrictEqual('<b>LONG-Ω</b>');
        expect(await page.locator('img').getAttribute('alt')).toStrictEqual(
          '<img data-drawing-stage-injection src=x>ALT-Ω漢字',
        );
        await assertSafe();
        const file = {
          name: 'drawing.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
          ),
        };
        await page.locator('input[type=file]').setInputFiles(file);
        await page.waitForFunction(
          (expected) => {
            const image = JSON.parse(
              document.querySelector('[data-state=drawing]')?.textContent ?? '{}',
            ).image;
            return JSON.stringify(image) === JSON.stringify(expected);
          },
          {
            source: uploadedUrl,
            alt: '<img data-drawing-stage-injection src=x>ALT-Ω漢字',
            longDescription: '<b>LONG-Ω</b>',
            mimeType: 'image/svg+xml',
            width: 100,
            height: 100,
          },
        );
        expect(uploadCount).toStrictEqual(1);
        await field(i18n.t('driver.drawingImageAlt')).fill(
          '<img data-drawing-stage-injection src=x>EDITED-ALT-Ω',
        );
        await field(i18n.t('driver.drawingImageLongDescription')).fill('EDITED-LONG-Ω');
        await field(i18n.t('driver.drawingImageMimeType')).fill('image/webp');
        await field(i18n.t('driver.drawingImageWidth')).fill('800');
        await field(i18n.t('driver.drawingImageHeight')).fill('600');
        await page.waitForFunction(() => {
          const image =
            JSON.parse(document.querySelector('[data-state=drawing]')?.textContent ?? '{}').image;
          return image.alt.includes('EDITED-ALT') && image.width === 800 && image.height === 600;
        });
        expect((await state()).image).toStrictEqual({
          source: uploadedUrl,
          alt: '<img data-drawing-stage-injection src=x>EDITED-ALT-Ω',
          longDescription: 'EDITED-LONG-Ω',
          mimeType: 'image/webp',
          width: 800,
          height: 600,
        });
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        expect(await page.locator('[data-drawing-stage-injection]').count()).toStrictEqual(0);
        await assertSafe();
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    if (temp) await _fs.rm(temp, { recursive: true });
  }
});
