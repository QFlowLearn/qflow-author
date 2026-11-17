import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import { safeErrorSummary } from '../lib/error_summary.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { INTERFACE_LOCALES, parseInterfaceLocale } from '../lib/i18n/locale.ts';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';

const locales = INTERFACE_LOCALES;

testCase(
  'item editor canvas tabs and canonical save states are localized in every supported locale',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const evidence = await createBrowserEvidenceDirectory();
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.item-editor-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
      import { h, render } from 'preact';
      import { I18nProvider } from ${JSON.stringify(`${process.cwd()}/lib/i18n/context.tsx`)};
      import ItemEditorProvider from ${
        JSON.stringify(`${process.cwd()}/islands/item_editor/ItemEditorProvider.tsx`)
      };
      import ItemEditorCanvas from ${
        JSON.stringify(`${process.cwd()}/islands/item_editor/ItemEditorCanvas.tsx`)
      };
      import { TYPE_DRIVERS } from ${JSON.stringify(`${process.cwd()}/lib/types/registry.ts`)};
      const saveGate = Promise.withResolvers();
      globalThis.completeSave = () => saveGate.resolve({itemId: 'item', rev: 1, identifier: 'item'});
      globalThis.mount = (config) => render(h(I18nProvider, {payload: config.payload},
        h(ItemEditorProvider, {pointEditingAuthority: {_tag: 'Generated'}, persistence: {_tag: 'Assessment', save: (command) => {globalThis.savedDraft = command.draft; return saveGate.promise;}}, choiceRichText: false, payload: config.payload, playerCatalog: config.playerCatalog, initialDraft: {...TYPE_DRIVERS.single_select.defaults(), promptHtml: '', type: 'single_select', itemLanguage: 'en-US'}}, h(ItemEditorCanvas, {persistenceStatusLocation: 'canvas'}))), document.getElementById('root'));
    `,
      'utf8',
    );
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=iife',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      '--loader:.css=empty',
      `--outfile=${bundle}`,
    ], { cwd: process.cwd() });
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const browser = await chromium.launch();
    const server = await startFetchServer(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/styles.css') {
        return new Response(
          await _fs.readFile('static/tw.css', 'utf8') +
            await _fs.readFile('static/styles.css', 'utf8'),
          { headers: { 'content-type': 'text/css' } },
        );
      }
      if (path === '/fonts/public-sans-latin.woff2') {
        return new Response(await _fs.readFile('static/fonts/public-sans-latin.woff2'));
      }
      if (path === '/bundle.js') {
        return new Response(await _fs.readFile(bundle), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const url = new URL(request.url);
      const locale = parseInterfaceLocale(url.searchParams.get('locale'));
      if (!locale) return new Response('Invalid test locale', { status: 400 });
      const catalog = catalogForLocale(locale);
      return new Response(
        `<!doctype html><html lang="${locale}" data-theme="wireframe"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><body><main class="mx-auto max-w-4xl p-4"><div id="root"></div></main><script>globalThis.__CONFIG__=${
          JSON.stringify({
            payload: createI18nPayload(locale, catalog, ['authoring']),
            playerCatalog: playerMessageCatalogForLocale(locale),
          })
        }</script><script src="/bundle.js"></script><script>mount(__CONFIG__)</script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    try {
      const base = `http://${'127.0.0.1'}:${server.port}`;
      for (const locale of locales) {
        const page: import('playwright').Page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
        try {
          const i18n = createI18n(locale, catalogForLocale(locale));
          await page.goto(`${base}/?locale=${locale}`);
          await page.getByRole('tablist', { name: i18n.t('editor.tabs') }).waitFor();
          const contentTab = page.getByRole('tab', { name: i18n.t('editor.content'), exact: true });
          await contentTab.waitFor();
          expect(await contentTab.count()).toStrictEqual(1);
          expect(await page.getByRole('tab', { name: i18n.t('editor.preview') }).count())
            .toStrictEqual(1);
          expect(
            await page.getByRole('tab', { name: i18n.t('editor.content') }).getAttribute(
              'aria-selected',
            ),
          ).toStrictEqual('true');
          const addInstructions = page.getByRole('button', {
            name: i18n.t('editor.addInstructions'),
            exact: true,
          });
          await addInstructions.focus();
          await page.keyboard.press('Enter');
          const instructions = page.getByRole('textbox', {
            name: i18n.t('editor.optionalInstruction'),
            exact: true,
          });
          await page.waitForFunction(() =>
            document.activeElement?.matches('textarea[data-editor-field="prompt"]')
          );
          await instructions.fill('Choose the best answer.');
          await instructions.fill('');
          if (!(await instructions.isVisible())) {
            expect.unreachable('Expected await instructions.isVisible()');
          }
          await instructions.fill('Choose the best answer.');
          const help = page.getByText(i18n.t('driver.points.matching'), { exact: true });
          expect(await help.isVisible()).toStrictEqual(false);
          const scoringHelp = page.getByText(i18n.t('driver.points.help'), { exact: true });
          await scoringHelp.click();
          if (!(await help.isVisible())) expect.unreachable('Expected await help.isVisible()');
          await scoringHelp.click();
          const question = page.locator('[data-editor-field="body"] [contenteditable="true"]');
          expect(await question.getAttribute('aria-labelledby') !== null).toStrictEqual(true);
          const format = page.getByRole('button', { name: i18n.t('editor.format'), exact: true });
          const toolbar = page.getByRole('toolbar', {
            name: i18n.t('editor.toolbar'),
            exact: true,
          });
          expect(await toolbar.isVisible()).toStrictEqual(false);
          const openFormatting = async () => {
            if (!await toolbar.isVisible()) await format.click();
            await toolbar.waitFor();
          };
          const replaceQuestion = async (text: string) => {
            await question.focus();
            await question.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
            await page.keyboard.insertText(text);
          };
          await replaceQuestion('Short question.');
          const presentation = page.getByRole('combobox', {
            name: i18n.t('editor.presentation.label'),
            exact: true,
          });
          const desktopQuestion = await question.boundingBox();
          const desktopPresentation = await presentation.boundingBox();
          if (!(desktopQuestion && desktopPresentation)) {
            expect.unreachable('Expected desktopQuestion && desktopPresentation');
          }
          if (!(desktopPresentation.x >= desktopQuestion.x + desktopQuestion.width)) {
            expect.unreachable(
              'Expected desktopPresentation.x >= desktopQuestion.x + desktopQuestion.width',
            );
          }
          const shortHeight = await question.evaluate((element) =>
            element.getBoundingClientRect().height
          );
          if (!(shortHeight < 100)) expect.unreachable('Expected shortHeight < 100');
          await replaceQuestion(
            Array.from({ length: 8 }, (_, index) => `Question line ${index}`).join('\n'),
          );
          if (
            !(await question.evaluate((element) => element.getBoundingClientRect().height) >
              shortHeight)
          ) {
            expect.unreachable(
              'Expected await question.evaluate((element) => element.getBoundingClientRect().height) > shortHeight',
            );
          }
          await replaceQuestion('Short question.');
          const more = page.getByRole('button', {
            name: i18n.t('editor.moreFormatting'),
            exact: true,
          });
          const questionBounds = await question.boundingBox();
          await format.focus();
          await page.keyboard.press('Enter');
          await toolbar.waitFor();
          expect(await question.boundingBox()).toStrictEqual(questionBounds);
          await page.keyboard.press('Escape');
          await toolbar.waitFor({ state: 'hidden' });
          if (!(await format.evaluate((element) => document.activeElement === element))) {
            expect.unreachable(
              'Expected await format.evaluate((element) => document.activeElement === element)',
            );
          }
          await openFormatting();
          await more.focus();
          await page.keyboard.press('Enter');
          const formatting = page.getByRole('group', {
            name: i18n.t('editor.moreFormatting'),
            exact: true,
          });
          await formatting.waitFor();
          await page.keyboard.press('Escape');
          await formatting.waitFor({ state: 'hidden' });
          if (!(await more.evaluate((element) => document.activeElement === element))) {
            expect.unreachable(
              'Expected await more.evaluate((element) => document.activeElement === element)',
            );
          }
          await question.focus();
          await question.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
          await openFormatting();
          await more.click();
          await formatting.getByRole('button', { name: i18n.t('editor.underline'), exact: true })
            .click();
          expect(await question.locator('u').innerText()).toStrictEqual('Short question.');
          await formatting.waitFor({ state: 'hidden' });
          for (const theme of ['wireframe', 'dark']) {
            await page.evaluate((value) => {
              document.documentElement.dataset.theme = value;
              document.documentElement.classList.toggle('dark', value === 'dark');
            }, theme);
            await page.setViewportSize({ width: 390, height: 844 });
            const mobileQuestion = await question.boundingBox();
            const mobilePresentation = await presentation.boundingBox();
            if (!(mobileQuestion && mobilePresentation)) {
              expect.unreachable('Expected mobileQuestion && mobilePresentation');
            }
            if (!(mobilePresentation.y >= mobileQuestion.y + mobileQuestion.height)) {
              expect.unreachable(
                'Expected mobilePresentation.y >= mobileQuestion.y + mobileQuestion.height',
              );
            }
            await openFormatting();
            await more.click();
            const bounds = await formatting.boundingBox();
            if (!(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390)) {
              expect.unreachable(
                'Expected bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390',
              );
            }
            if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
              expect.unreachable(
                'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
              );
            }
            await page.keyboard.press('Escape');
            for (const key of ['editor.imageOpen', 'editor.a11yOpen']) {
              await openFormatting();
              await page.getByRole('button', { name: i18n.t(key), exact: true }).click();
              const dialog = page.getByRole('dialog');
              await dialog.waitFor();
              const toolBounds = await dialog.boundingBox();
              if (!(toolBounds && toolBounds.x >= 0 && toolBounds.x + toolBounds.width <= 390)) {
                expect.unreachable(
                  'Expected toolBounds && toolBounds.x >= 0 && toolBounds.x + toolBounds.width <= 390',
                );
              }
              await page.keyboard.press('Escape');
              await dialog.waitFor({ state: 'detached' });
            }
          }
          await page.evaluate(() => {
            document.documentElement.dataset.theme = 'wireframe';
            document.documentElement.classList.remove('dark');
          });
          await page.setViewportSize({ width: 1280, height: 900 });
          const answer = page.getByRole('textbox', {
            name: i18n.t('driver.choicePlaceholder', { id: 'A' }),
            exact: true,
          });
          await answer.fill('Changed answer');
          await page.getByRole('status').filter({ hasText: i18n.t('editor.unsavedChanges') })
            .waitFor();
          expect(await page.locator('.ds-badge-warning').count()).toStrictEqual(0);
          expect(
            await page.getByRole('status').filter({ hasText: i18n.t('editor.unsavedChanges') })
              .count(),
          ).toStrictEqual(1);
          await page.getByRole('button', { name: i18n.t('editor.save'), exact: true }).click();
          expect(
            await page.evaluate(() => {
              const saved: unknown = Reflect.get(globalThis, 'savedDraft');
              return saved && typeof saved === 'object' ? Reflect.get(saved, 'promptHtml') : null;
            }),
          ).toStrictEqual('Choose the best answer.');
          await page.getByRole('status').filter({ hasText: i18n.t('editor.saving') }).waitFor();
          expect(
            await page.getByRole('button', { name: i18n.t('editor.saving'), exact: true })
              .isDisabled(),
          ).toStrictEqual(true);
          await page.evaluate(() => {
            const complete: unknown = Reflect.get(globalThis, 'completeSave');
            if (typeof complete !== 'function') throw new Error('Test save gate is missing.');
            complete();
          });
          await page.getByRole('status').filter({ hasText: i18n.t('editor.itemSaved') }).waitFor();
          expect(errors).toStrictEqual([]);
          expect((await page.locator('body').innerText()).includes('authoring.')).toStrictEqual(
            false,
          );
          if (locale.startsWith('es-')) {
            expect((await page.locator('body').innerText()).includes('Item editor')).toStrictEqual(
              false,
            );
          }
          if (locale === 'en-US') {
            await replaceQuestion('Which planet is known as the red planet?');
            await question.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
            await openFormatting();
            await more.click();
            await formatting.getByRole('button', { name: i18n.t('editor.underline'), exact: true })
              .click();
            expect(await question.locator('u').count()).toStrictEqual(0);
            await answer.fill('Mars');
            await page.getByRole('textbox', {
              name: i18n.t('driver.choicePlaceholder', { id: 'B' }),
              exact: true,
            }).fill('Venus');
            if (await toolbar.isVisible()) await format.click();
            await toolbar.waitFor({ state: 'hidden' });
            await page.evaluate(() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              globalThis.scrollTo(0, 0);
            });
            await page.mouse.move(0, 0);
            await page.screenshot({
              path: evidence.path('calm-editor-desktop.png'),
              fullPage: true,
            });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.screenshot({
              path: evidence.path('calm-editor-mobile.png'),
              fullPage: true,
            });
          }
        } catch (cause: unknown) {
          await captureBrowserFailure(page, evidence, `qflow-canvas-status-${locale}`);
          throw cause;
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
