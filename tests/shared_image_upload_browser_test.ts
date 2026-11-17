import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase(
  'shared upload browser matrix',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.shared-upload-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import AssetUpload from "${process.cwd()}/components/ui/AssetUpload.tsx";
function App({ config }) {
  const [mode, setMode] = useState('ok');
  const [disabled, setDisabled] = useState(false);
  const [selected, setSelected] = useState('');
  const [calls, setCalls] = useState(0);
  globalThis.__UPLOAD_COMMANDS__ = {
    mode: setMode,
    disabled: setDisabled,
    resolve: () => globalThis.__RESOLVE_PENDING__?.(),
  };
  const onSelected = (file) => {
    setCalls((count) => count + 1);
    setSelected(file.name);
    if (mode === 'pending') return new Promise((resolve) => { globalThis.__RESOLVE_PENDING__ = () => resolve({ _tag: 'ok' }); });
    if (mode === 'throw') throw new Error('stack-secret');
    if (mode === 'wrong') return Promise.resolve({ _tag: 'error', error: { code: 'wrong-kind', expected: 'image' } });
    if (mode === 'empty') return Promise.resolve({ _tag: 'error', error: { code: 'empty' } });
    if (mode === 'large') return Promise.resolve({ _tag: 'error', error: { code: 'too-large', kind: 'image', maxMebibytes: 8 } });
    if (mode === 'failed') return Promise.resolve({ _tag: 'error', error: { code: 'processing-failed' } });
    return Promise.resolve({ _tag: 'ok' });
  };
  return h(I18nProvider, { payload: config.payload },
    h('main', null,
      h(AssetUpload, { accept: 'image/*', buttonLabel: config.button, busyLabel: config.busy, helperText: config.helper, disabled, onSelected }),
      h('output', { id: 'selected' }, selected),
      h('output', { id: 'calls' }, String(calls)),
    ),
  );
}
globalThis.renderUpload = (config) => render(h(App, { config }), document.getElementById('root'));
globalThis.renderUpload(globalThis.__UPLOAD_CONFIG__);
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
    if (bundleText.includes('Finalizar intento')) {
      expect.unreachable("Expected !bundleText.includes('Finalizar intento')");
    }

    const configs = new Map(locales.map((locale) => {
      const catalog = catalogForLocale(locale);
      const i18n = createI18n(locale, catalog);
      const payload = createI18nPayload(locale, catalog, ['authoring']);
      return [locale, {
        payload,
        button: catalog.authoring['editor.uploadImage'],
        busy: catalog.authoring['editor.uploading'],
        helper: catalog.authoring['editor.uploadHelper'],
        errors: {
          wrong: i18n.t('editor.uploadWrongKind', { kind: i18n.t('editor.mediaKindImage') }),
          empty: i18n.t('editor.uploadEmpty'),
          large: i18n.t('editor.uploadTooLarge', { kind: i18n.t('editor.mediaKindImage'), max: 8 }),
          failed: i18n.t('editor.uploadFailed'),
          one: i18n.t('editor.uploadOneFile'),
        },
      }];
    }));
    const safeJson = (value: unknown) =>
      JSON.stringify(value).replaceAll('<', '\\u003c')
        .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    const server = await startFetchServer((request) => {
      if (new URL(request.url).pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const locale = new URL(request.url).searchParams.get('locale') as InterfaceLocale;
      const config = configs.get(locale);
      if (!config) return new Response('Unsupported locale', { status: 400 });
      return new Response(
        `<!doctype html><meta charset="utf-8"><div id="root"></div><script>globalThis.__UPLOAD_CONFIG__=${
          safeJson(config)
        }</script><script type="module" src="/bundle.js"></script>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    const browser = await chromium.launch();
    try {
      const base = `http://${'127.0.0.1'}:${server.port}`;
      for (const locale of locales) {
        const page: import('playwright').Page = await browser.newPage();
        try {
          await page.goto(`${base}/?locale=${locale}`);
          const config = configs.get(locale)!;
          const input = page.locator('input[type=file]');
          const button = page.locator('button').filter({ hasText: config.button });
          await button.waitFor();
          expect(await input.getAttribute('accept')).toStrictEqual('image/*');

          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.mode('wrong'));
          await input.setInputFiles({
            name: 'note.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('x'),
          });
          await page.getByRole('alert').waitFor();
          expect(await page.getByRole('alert').innerText()).toStrictEqual(config.errors.wrong);
          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.mode('ok'));
          await input.setInputFiles({
            name: 'image.png',
            mimeType: 'image/png',
            buffer: Buffer.from('x'),
          });
          await page.waitForFunction(() => !document.querySelector('[role=alert]'));

          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.mode('pending'));
          await input.setInputFiles({
            name: 'pending.png',
            mimeType: 'image/png',
            buffer: Buffer.from('x'),
          });
          await page.locator('button').filter({ hasText: config.busy }).waitFor();
          expect(await page.locator('button').first().getAttribute('aria-busy')).toStrictEqual(
            'true',
          );
          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.resolve());
          await button.waitFor();

          for (const mode of ['empty', 'large', 'failed', 'throw'] as const) {
            await page.evaluate((next) => globalThis.__UPLOAD_COMMANDS__.mode(next), mode);
            await input.setInputFiles({
              name: 'bad.png',
              mimeType: 'image/png',
              buffer: Buffer.from('x'),
            });
            await page.getByRole('alert').waitFor();
            const text = await page.getByRole('alert').innerText();
            const expected = mode === 'empty'
              ? config.errors.empty
              : mode === 'large'
              ? config.errors.large
              : config.errors.failed;
            expect(text).toStrictEqual(expected);
            if (!(text.length > 0 && !text.includes('stack-secret') && !text.includes('editor.'))) {
              expect.unreachable(
                "Expected text.length > 0 && !text.includes('stack-secret') && !text.includes('editor.')",
              );
            }
          }

          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.mode('ok'));
          await page.evaluate(() => {
            const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
            const transfer = new DataTransfer();
            transfer.items.add(new File(['x'], 'one.png', { type: 'image/png' }));
            transfer.items.add(new File(['x'], 'two.png', { type: 'image/png' }));
            Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await page.getByRole('alert').waitFor();
          expect(await page.getByRole('alert').innerText()).toStrictEqual(config.errors.one);

          const dropped = await page.locator('div.rounded-lg.border-dashed').first().evaluate(
            (node) => {
              const transfer = new DataTransfer();
              transfer.items.add(new File(['x'], 'drop-one.png', { type: 'image/png' }));
              transfer.items.add(new File(['x'], 'drop-two.png', { type: 'image/png' }));
              node.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
              return true;
            },
          );
          if (!dropped) expect.unreachable('Expected dropped');
          await page.getByRole('alert').waitFor();

          const callsBeforeDrop = await page.locator('#calls').innerText();
          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.mode('ok'));
          await page.locator('div.rounded-lg.border-dashed').first().evaluate((node) => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['x'], 'drop-success.png', { type: 'image/png' }));
            node.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
          });
          await page.waitForFunction(() =>
            document.querySelector('#selected')?.textContent === 'drop-success.png'
          );
          await page.waitForFunction(() => !document.querySelector('[role=alert]'));
          expect(Number(await page.locator('#calls').innerText())).toStrictEqual(
            Number(callsBeforeDrop) + 1,
          );

          const selectedBeforeDisabled = await page.locator('#selected').innerText();
          const callsBeforeDisabled = await page.locator('#calls').innerText();
          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.disabled(true));
          if (!(await input.isDisabled())) expect.unreachable('Expected await input.isDisabled()');
          await page.locator('div.rounded-lg.border-dashed').first().evaluate((node) => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['x'], 'disabled.png', { type: 'image/png' }));
            node.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
          });
          await page.waitForTimeout(50);
          expect(await page.locator('#selected').innerText()).toStrictEqual(selectedBeforeDisabled);
          expect(await page.locator('#calls').innerText()).toStrictEqual(callsBeforeDisabled);
          await page.evaluate(() => globalThis.__UPLOAD_COMMANDS__.disabled(false));
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
      await server.close();
      await _fs.rm(temp, { recursive: true });
    }
  },
);

declare global {
  var __UPLOAD_CONFIG__: Record<string, unknown>;
  var __UPLOAD_COMMANDS__: {
    mode: (mode: string) => void;
    disabled: (disabled: boolean) => void;
    resolve: () => void;
  };
  var __RESOLVE_PENDING__: (() => void) | undefined;
  var renderUpload: (config: Record<string, unknown>) => void;
}
