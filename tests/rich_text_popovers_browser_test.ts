import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { Buffer } from 'node:buffer';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('rich text popovers are localized, accessible, and preserve machine values', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.rich-text-popovers-'));
  const entry = `${temp}/entry.tsx`;
  const bundle = `${temp}/bundle.js`;
  await _fs.writeFile(
    entry,
    `
import { h, render } from "preact";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { A11yInsertPopover } from "${process.cwd()}/islands/rich_text/a11y_insert.tsx";
import { ImageInsertPopover } from "${process.cwd()}/islands/rich_text/image_insert.tsx";
const config = globalThis.__RICH_TEXT_CONFIG__;
const editor = { schema: {}, view: { state: { selection: { empty: true }, doc: { textBetween: () => "" } }, focus: () => {}, dispatch: () => {} } };
const sanitize = (html) => html.replaceAll(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, "").replaceAll(/\\son[a-z]+="[^"]*"/gi, "");
function App() { return h(I18nProvider, { payload: config.payload }, h("main", null,
  h("section", { id: "a11y-one" }, h(A11yInsertPopover, { editor, disabled: false, contentScope: "inline", sanitize, catalogIds: ["CATALOG-1"] })),
  h("section", { id: "a11y-two" }, h(A11yInsertPopover, { editor, disabled: false, contentScope: "inline", sanitize, catalogIds: ["CATALOG-1"] })),
  h("section", { id: "image-one" }, h(ImageInsertPopover, { editor, disabled: false, contentScope: "body", sanitize })),
  h("section", { id: "image-two" }, h(ImageInsertPopover, { editor, disabled: false, contentScope: "body", sanitize })))); }
render(h(App), document.getElementById("root"));
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
  const server = await startFetchServer((request) => {
    if (new URL(request.url).pathname === '/styles.css') {
      return new Response(
        _fsSync.readFileSync('static/tw.css', 'utf8') +
          _fsSync.readFileSync('static/styles.css', 'utf8'),
        {
          headers: { 'content-type': 'text/css' },
        },
      );
    }
    if (new URL(request.url).pathname === '/bundle.js') {
      return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    const locale = (new URL(request.url).searchParams.get('locale') ?? 'en-US') as InterfaceLocale;
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const config = JSON.stringify({ payload }).replaceAll('<', '\\u003c');
    return new Response(
      `<!doctype html><html lang="${locale}" data-theme="wireframe"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>globalThis.__RICH_TEXT_CONFIG__=${config}</script><script type="module" src="/bundle.js"></script></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
  const browser = await chromium.launch();
  try {
    const page: import('playwright').Page = await browser.newPage();
    page.setDefaultTimeout(3000);
    await page.route('**/api/uploads', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'HOSTILE-UPLOAD-SECRET' }),
      });
    });
    for (const locale of locales) {
      await page.goto(`http://${'127.0.0.1'}:${server.port}/?locale=${locale}`);
      const messages = catalogForLocale(locale).authoring;
      const a11y = page.locator('#a11y-one');
      const image = page.locator('#image-one');
      const a11yButton = a11y.getByRole('button', { name: messages['editor.a11yOpen'] });
      const imageButton = image.getByRole('button', { name: messages['editor.imageOpen'] });
      expect(await a11yButton.getAttribute('aria-label')).toStrictEqual(
        messages['editor.a11yOpen'],
      );
      expect(await imageButton.getAttribute('aria-label')).toStrictEqual(
        messages['editor.imageOpen'],
      );
      const a11yButtonTwo = page.locator('#a11y-two').getByRole('button', {
        name: messages['editor.a11yOpen'],
      });
      await a11yButton.click();
      await a11yButtonTwo.dispatchEvent('click');
      await page.waitForFunction(() =>
        document.activeElement === document.querySelector('#a11y-two input[name="a11y-text"]')
      );
      const a11yControls = [
        await a11yButton.getAttribute('aria-controls'),
        await a11yButtonTwo.getAttribute('aria-controls'),
      ];
      if (!(a11yControls[0] !== a11yControls[1])) {
        expect.unreachable('Expected a11yControls[0] !== a11yControls[1]');
      }
      expect(await page.locator('[role="dialog"]').count()).toStrictEqual(2);
      await page.keyboard.press('Escape');
      await a11y.getByRole('dialog').waitFor({ state: 'detached' });
      await page.locator('#a11y-two').getByRole('dialog').waitFor({ state: 'detached' });
      await a11yButton.click();
      const a11yDialog = a11y.getByRole('dialog');
      await a11yDialog.waitFor();
      const a11yTextContent = await a11yDialog.innerText();
      for (
        const text of [
          messages['editor.a11yTitle'],
          messages['editor.a11yText'],
          messages['editor.a11yStyle'],
          messages['editor.a11yNone'],
          messages['editor.a11yKeyword'],
          messages['editor.a11yHidden'],
          messages['editor.a11yRole'],
          messages['editor.a11yElementId'],
          messages['editor.a11yAriaLabel'],
          messages['editor.a11yAriaLabelledby'],
          messages['editor.a11yAriaDescribedby'],
          messages['editor.a11yCatalogReference'],
          messages['editor.a11yHide'],
          messages['editor.a11ySuppressTts'],
          messages['editor.a11ySsml'],
          messages['editor.a11yReadingType'],
          messages['editor.cancel'],
          messages['editor.insert'],
        ]
      ) {
        expect(a11yTextContent).toContain(text);
      }
      for (
        const placeholder of [
          messages['editor.a11yTextPlaceholder'],
          messages['editor.a11yRolePlaceholder'],
          messages['editor.a11yElementIdPlaceholder'],
          messages['editor.a11ySsmlPlaceholder'],
        ]
      ) {
        expect(await a11yDialog.locator(`[placeholder="${placeholder}"]`).count()).toStrictEqual(1);
      }
      expect(await a11yDialog.innerText()).toContain('computer-read-aloud');
      expect(await a11yButton.getAttribute('aria-expanded')).toStrictEqual('true');
      expect(await page.locator(`#${await a11yButton.getAttribute('aria-controls')}`).count())
        .toStrictEqual(1);
      const a11yText = a11y.locator('input[name="a11y-text"]');
      await a11yDialog.getByRole('button', { name: messages['editor.insert'] }).click();
      await a11y.getByRole('alert').waitFor();
      expect(await a11y.innerText()).toContain(messages['editor.a11yTextRequired']);
      await a11yText.fill('AUTHORED <tag>');
      await a11y.locator('textarea').fill('{bad');
      await a11yDialog.getByRole('button', { name: messages['editor.insert'] }).click();
      expect(await a11y.innerText()).toContain(messages['editor.a11yInvalidSsml']);
      await page.keyboard.press('Escape');
      await a11yDialog.waitFor({ state: 'detached' });
      expect(await a11yButton.getAttribute('aria-expanded')).toStrictEqual('false');
      const imageButtonTwo = page.locator('#image-two').getByRole('button', {
        name: messages['editor.imageOpen'],
      });
      await imageButton.click();
      await imageButtonTwo.dispatchEvent('click');
      await page.waitForFunction(() =>
        document.activeElement === document.querySelector('#image-two input[type="url"]')
      );
      const imageControls = [
        await imageButton.getAttribute('aria-controls'),
        await imageButtonTwo.getAttribute('aria-controls'),
      ];
      if (!(imageControls[0] !== imageControls[1])) {
        expect.unreachable('Expected imageControls[0] !== imageControls[1]');
      }
      expect(await page.locator('[role="dialog"]').count()).toStrictEqual(2);
      await page.keyboard.press('Escape');
      await image.getByRole('dialog').waitFor({ state: 'detached' });
      await page.locator('#image-two').getByRole('dialog').waitFor({ state: 'detached' });
      await imageButton.click();
      const imageDialog = image.getByRole('dialog');
      await imageDialog.waitFor();
      const imageTextContent = await imageDialog.innerText();
      for (
        const text of [
          messages['editor.imageTitle'],
          messages['editor.imageUrl'],
          messages['editor.imageOrUpload'],
          messages['editor.imageSelectFile'],
          messages['editor.imageAlt'],
          messages['editor.imageDecorative'],
          messages['editor.imageLongDescription'],
          messages['editor.cancel'],
          messages['editor.insert'],
        ]
      ) expect(imageTextContent).toContain(text);
      for (
        const placeholder of [
          messages['editor.imageAltPlaceholder'],
          messages['editor.imageLongDescriptionPlaceholder'],
        ]
      ) {
        expect(await imageDialog.locator(`[placeholder="${placeholder}"]`).count()).toStrictEqual(
          1,
        );
      }
      expect(await imageButton.getAttribute('aria-expanded')).toStrictEqual('true');
      const url = image.locator('input[type="url"]');
      await url.fill('https://example.test/AUTHORED-image.png?x=1');
      await imageDialog.getByRole('button', { name: messages['editor.insert'] }).click();
      await image.getByRole('alert').waitFor();
      expect(await image.innerText()).toContain(messages['editor.imageAltRequired']);
      await image.getByRole('checkbox').check();
      await imageDialog.getByRole('button', { name: messages['editor.insert'] }).click();
      await page.keyboard.press('Escape');
      await imageDialog.waitFor({ state: 'detached' });
      expect(await imageButton.getAttribute('aria-expanded')).toStrictEqual('false');
      await imageButton.click();
      const uploadDialog = image.getByRole('dialog');
      await uploadDialog.locator('input[type="file"]').setInputFiles({
        name: 'authored.png',
        mimeType: 'image/png',
        buffer: Buffer.from([1, 2, 3]),
      });
      await uploadDialog.locator('input').nth(2).fill('AUTHORED-ALT');
      await uploadDialog.getByRole('button', { name: messages['editor.insert'] }).click();
      await page.waitForTimeout(50);
      expect(await uploadDialog.innerText()).toContain(messages['editor.imageUploading']);
      await image.getByRole('alert').waitFor();
      expect(await image.innerText()).toContain(messages['editor.imageUploadFailed']);
      if ((await image.innerText()).includes('HOSTILE-UPLOAD-SECRET')) {
        expect.unreachable("Expected !(await image.innerText()).includes('HOSTILE-UPLOAD-SECRET')");
      }
      await page.keyboard.press('Escape');
      const allIds = await page.locator('[id]').evaluateAll((nodes) =>
        nodes.map((node) => node.id).filter(Boolean)
      );
      expect(new Set(allIds).size).toStrictEqual(allIds.length);
      if (locale.startsWith('es-')) {
        const text = await page.locator('body').innerText();
        if (text.includes('Insert accessibility markup')) {
          expect.unreachable("Expected !text.includes('Insert accessibility markup')");
        }
        if (text.includes('Insert image')) {
          expect.unreachable("Expected !text.includes('Insert image')");
        }
        if (text.includes('Text is required.')) {
          expect.unreachable("Expected !text.includes('Text is required.')");
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(temp, { recursive: true });
  }
});
