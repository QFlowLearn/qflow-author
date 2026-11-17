import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import type { Page } from 'playwright';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function state(page: Page) {
  const mode = new URL(page.url()).searchParams.get('mode');
  if (!(mode === 'single_select' || mode === 'multi_select')) {
    expect.unreachable("Expected mode === 'single_select' || mode === 'multi_select'");
  }
  return parsePersistedDraft(
    JSON.parse(await page.locator('output[data-state]').innerText()),
    mode,
  );
}
async function count(page: Page, expected: number) {
  await page.waitForFunction((value) => {
    const output = document.querySelector('output[data-state]');
    return JSON.parse(output?.textContent ?? '{}').choices?.length === value;
  }, expected);
}
testCase(
  'option removal restores content, position and answer keys without stealing native text undo',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.choice-removal-browser-'));
    const bundle = `${temp}/bundle.js`;
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      'tests/helpers/choice_paste_browser_fixture.tsx',
      '--bundle',
      '--format=esm',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      `--outfile=${bundle}`,
    ], {});
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const script = await _fs.readFile(bundle, 'utf8');
    const server = await startFetchServer((request) => {
      const path = new URL(request.url).pathname;
      if (path === '/bundle.js') {
        return new Response(script, { headers: { 'content-type': 'text/javascript' } });
      }
      if (path === '/tw.css') {
        return new Response(_fsSync.readFileSync('static/tw.css', 'utf8'), {
          headers: { 'content-type': 'text/css' },
        });
      }
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/tw.css"><div id="root"></div><script type="module" src="/bundle.js"></script>',
        { headers: { 'content-type': 'text/html' } },
      );
    });
    const browser = await chromium.launch();
    const page: import('playwright').Page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://${'127.0.0.1'}:${server.port}`;
    try {
      for (const locale of INTERFACE_LOCALES) {
        const i18n = createI18n(locale, catalogForLocale(locale));
        for (const mode of ['single_select', 'multi_select'] as const) {
          for (const rich of [false, true]) {
            await page.goto(
              `${base}/?locale=${locale}&mode=${mode}&rich=${Number(rich)}&removal=1`,
            );
            const remove = page.getByRole('button', {
              name: i18n.t('driver.removeChoiceLabel', { label: 'City' }),
              exact: true,
            });
            await remove.waitFor();
            const original = await state(page);
            await remove.click();
            await count(page, 2);
            const deleted = await state(page);
            expect(deleted.choices?.map((choice) => choice.id)).toStrictEqual(['A', 'C']);
            expect(mode === 'single_select' ? deleted.correctId : deleted.correctIds).toStrictEqual(
              mode === 'single_select' ? '' : ['A'],
            );
            if (mode === 'single_select') {
              expect(await page.locator('[data-validation]').innerText()).toContain(
                'Correct choice',
              );
            }
            expect(
              await page.getByRole('button', { name: i18n.t('driver.undoChoiceRemoval') }).evaluate(
                (button) => button === document.activeElement,
              ),
            ).toStrictEqual(true);
            await page.keyboard.press(`${modifier}+z`);
            await count(page, 3);
            expect(
              await page.evaluate(() =>
                (document.activeElement?.closest('[data-choice-id]') as HTMLElement | null)
                  ?.dataset.choiceId
              ),
            ).toStrictEqual('B');
            if (rich) {
              await page.waitForFunction(() =>
                document.activeElement?.matches('[data-choice-id="B"] [contenteditable="true"]')
              );
            }
            expect(await state(page)).toStrictEqual(original);
            await page.keyboard.press(`${modifier}+Shift+z`);
            await count(page, 2);
            await page.getByRole('button', { name: i18n.t('driver.undoChoiceRemoval') }).click();
            await count(page, 3);
            expect(await state(page)).toStrictEqual(original);
            expect(exportQti3AssessmentItemXml(mode, original, { identifier: 'undo-removal' }))
              .toContain('<qti-value>B</qti-value>');
            // Two removals unwind in reverse order, including deleting all correct answers.
            await remove.click();
            await page.getByRole('button', {
              name: i18n.t('driver.removeChoiceLabel', { label: 'A' }),
              exact: true,
            }).click();
            await count(page, 1);
            await page.keyboard.press(`${modifier}+z`);
            await count(page, 2);
            await page.keyboard.press(`${modifier}+z`);
            await count(page, 3);
            expect(await state(page)).toStrictEqual(original);
            // A successful save settles local history; reopening does not resurrect it.
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await page.getByRole('button', { name: i18n.t('driver.undoChoiceRemoval') }).waitFor({
              state: 'detached',
            });
            await remove.click();
            const answers = page.locator(
              rich ? '[contenteditable="true"]' : 'textarea[placeholder]',
            );
            await answers.first().focus();
            await page.keyboard.press('End');
            await page.keyboard.type(' edited');
            await page.keyboard.press(`${modifier}+z`);
            await count(page, 2);
            await page.waitForFunction(() =>
              !document.querySelector('output[data-state]')?.textContent?.includes(' edited')
            );
            // Visible structural undo remains available and preserves surviving options' current text.
            await answers.first().fill('New Paris');
            if (mode === 'single_select') await page.getByRole('radio').first().check();
            else await page.getByRole('checkbox').first().uncheck();
            await page.getByRole('button', { name: i18n.t('driver.undoChoiceRemoval') }).click();
            await count(page, 3);
            const restored = await state(page);
            expect(restored.choices?.[0][rich ? 'html' : 'text']?.includes('New Paris'))
              .toStrictEqual(true);
            expect(restored.choices?.[1]).toStrictEqual(original.choices?.[1]);
            expect(mode === 'single_select' ? restored.correctId : restored.correctIds)
              .toStrictEqual(mode === 'single_select' ? 'A' : []);
            await page.getByRole('button', { name: 'Save and reopen', exact: true }).click();
            expect(await state(page)).toStrictEqual(restored);
            expect(
              await page.getByRole('button', { name: i18n.t('driver.undoChoiceRemoval') }).count(),
            ).toStrictEqual(0);
          }
        }
      }
      // Even a reverted answer-key edit is an explicit decision, not permission to restore an older key.
      await page.goto(`${base}/?locale=en-US&mode=multi_select&rich=0&removal=1`);
      await page.getByRole('button', { name: 'Remove choice City', exact: true }).click();
      await page.getByRole('checkbox').first().uncheck();
      await page.getByRole('checkbox').first().check();
      await page.getByRole('button', { name: 'Undo removal', exact: true }).click();
      await count(page, 3);
      expect((await state(page)).correctIds).toStrictEqual(['A']);
      await page.getByRole('button', { name: 'Remove choice City', exact: true }).click();
      await page.screenshot({ path: '/tmp/qflow-option-undo-desktop.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '/tmp/qflow-option-undo-mobile.png' });
      if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
        expect.unreachable(
          'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
        );
      }
      expect(errors).toStrictEqual([]);
    } finally {
      await browser.close();
      await server.close();
      await _fs.rm(temp, { recursive: true });
    }
  },
);
