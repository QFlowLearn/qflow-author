import { expect, test as testCase } from 'vitest';

import { type FetchFixtureServer, startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { parseCanvasPublishView } from '../lib/lms/canvas_publish_wire.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const publishId = 'a505462d-2f72-4d99-ae04-77e10bc783e8';
const packageUrl = `https://qflow.example/api/publishes/${publishId}/package`;
const receiptUrl = 'https://qflow.example/api/publishes/receipt';
const rawSentinel = 'RAW-WIRE-MESSAGE-MUST-NOT-RENDER';

function publishView(state: 'RemoteIdentityUnknown' | 'Published') {
  const remote = { contentMigrationId: '42', workflowState: 'created' };
  const parsed = parseCanvasPublishView({
    id: publishId,
    connection: {
      id: '8fdcd9d7-3cb3-4f7e-8c92-31bd3272fda0',
      name: 'Canvas production',
      baseUrl: 'https://canvas.example.edu',
    },
    targetId: 'canvas-classic',
    destination: { _tag: 'Course', courseId: '17' },
    exportReceiptId: 'a'.repeat(64),
    artifact: {
      filename: 'assessment.zip',
      mediaType: 'application/zip',
      sha256: 'a'.repeat(64),
      byteLength: 3,
      packageUrl,
    },
    attemptCount: 1,
    state: state === 'Published'
      ? { _tag: 'Published', remote, receiptUrl, publishedAt: '2026-08-05T12:00:01.000Z' }
      : {
        _tag: 'RemoteIdentityUnknown',
        startedAt: '2026-08-05T12:00:00.000Z',
        failure: { code: 'CanvasRemoteIdentityUnknown', message: rawSentinel, extra: rawSentinel },
      },
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:01.000Z',
  });
  if (!parsed) throw new Error('Expected valid Canvas publish fixture.');
  return parsed;
}

testCase('Canvas publish browser UI is localized and preserves wire contracts', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.canvas-publish-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import CanvasPublishStatus from "${process.cwd()}/islands/assessment_builder/CanvasPublishStatus.tsx";
function App({config}) {
  const [publish, setPublish] = useState(config.unknown);
  const [captures, setCaptures] = useState([]);
  globalThis.setPublished = () => setPublish(config.published);
  return h(I18nProvider, {payload: config.payload}, h('main', null,
    h(CanvasPublishStatus, {publish, busy:false, requestFailure:null, onResume:()=>{}, onResolveUnknown:(outcome)=>setCaptures(x=>[...x,outcome])}),
    h('output', {'data-captures':true}, JSON.stringify(captures))));
}
globalThis.mount = config => render(h(App, {config}), document.getElementById('root'));
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
    if (bundleText.includes('catalogForLocale')) {
      expect.unreachable("Expected !bundleText.includes('catalogForLocale')");
    }
    const configs = new Map(locales.map((locale) => [locale, {
      payload: createI18nPayload(locale, catalogForLocale(locale), ['delivery']),
      unknown: publishView('RemoteIdentityUnknown'),
      published: publishView('Published'),
    }]));
    const json = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
    server = await startFetchServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const locale = url.searchParams.get('locale') as InterfaceLocale;
      const config = configs.get(locale);
      if (!config) return new Response('bad locale', { status: 400 });
      return new Response(
        `<!doctype html><html lang="${locale}"><body><div id="root"></div><script>globalThis.__CONFIG__=${
          json(config)
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    browser = await chromium.launch();
    const address = new URL(server.origin);
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.getByText(i18n.t('delivery.canvas.unknownHeading'), { exact: true }).waitFor();
        const body = page.locator('body');
        const text = await body.innerText();
        for (
          const key of [
            'unknownHeading',
            'importFound',
            'importNotFound',
            'downloadPackage',
            'publishId',
            'packagePrefix',
          ] as const
        ) expect(text).toContain(i18n.t(`delivery.canvas.${key}`));
        expect(text).toContain(publishId);
        expect(text).toContain(`qflow-${publishId}-`);
        expect(text).toContain('Canvas production');
        expect(text).toContain('CanvasRemoteIdentityUnknown');
        expect(text).toContain(i18n.t('delivery.canvas.course', { id: '17' }));
        expect(text).toContain(
          i18n.t('delivery.canvas.failureMessage', { code: 'CanvasRemoteIdentityUnknown' }),
        );
        expect(text).not.toMatch(/delivery\.canvas\.|\{(?:count|plural|select|code)[^}]*\}/);
        if (text.includes(rawSentinel)) {
          expect.unreachable('Expected !text.includes(rawSentinel)');
        }
        if (locale === 'es-ES' || locale === 'es-419') {
          for (
            const phrase of [
              'Sending to Canvas',
              'I found the import',
              'No import found',
              'Download preserved package',
              'Publish ID',
            ]
          ) if (text.includes(phrase)) expect.unreachable('Expected !text.includes(phrase)');
        }
        await page.getByRole('button', {
          name: i18n.t('delivery.canvas.importFound'),
          exact: true,
        }).click();
        await page.getByRole('button', {
          name: i18n.t('delivery.canvas.importNotFound'),
          exact: true,
        })
          .click();
        expect(await page.locator('[data-captures]').innerText()).toStrictEqual(
          '["import-found","import-not-found"]',
        );
        await page.evaluate(() =>
          (globalThis as unknown as { setPublished: () => void }).setPublished()
        );
        await page.getByText(i18n.t('delivery.canvas.published'), { exact: true }).waitFor();
        const publishedText = await body.innerText();
        expect(publishedText).toContain(i18n.t('delivery.canvas.publishedMessage'));
        expect(publishedText).toContain(i18n.t('delivery.canvas.migration', { id: '42' }));
        expect(publishedText).not.toMatch(
          /delivery\.canvas\.|\{(?:count|plural|select|code)[^}]*\}/,
        );
        if (publishedText.includes(rawSentinel)) {
          expect.unreachable('Expected !publishedText.includes(rawSentinel)');
        }
        if (locale === 'es-ES' || locale === 'es-419') {
          for (
            const phrase of [
              'Sending to Canvas',
              'I found the import',
              'No import found',
              'Download preserved package',
              'Publish ID',
            ]
          ) {
            if (publishedText.includes(phrase)) {
              expect.unreachable('Expected !publishedText.includes(phrase)');
            }
          }
        }
        const packageLink = page.getByRole('link', {
          name: i18n.t('delivery.canvas.downloadPackage'),
        });
        expect(await packageLink.getAttribute('href')).toStrictEqual(packageUrl);
        if (!(await packageLink.evaluate((element) => element.hasAttribute('download')))) {
          expect.unreachable(
            "Expected await packageLink.evaluate((element) => element.hasAttribute('download'))",
          );
        }
        const receiptLink = page.getByRole('link', {
          name: i18n.t('delivery.canvas.downloadReceipt'),
        });
        expect(await receiptLink.getAttribute('href')).toStrictEqual(receiptUrl);
        if (!(await receiptLink.evaluate((element) => element.hasAttribute('download')))) {
          expect.unreachable(
            "Expected await receiptLink.evaluate((element) => element.hasAttribute('download'))",
          );
        }
        expect(await page.locator('[data-captures]').innerText()).toStrictEqual(
          '["import-found","import-not-found"]',
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await server?.close();
    if (temp) await _fs.rm(temp, { recursive: true });
  }
});
