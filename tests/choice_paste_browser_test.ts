import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { DOMParser } from '@xmldom/xmldom';
import type { Locator, Page } from 'playwright';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';

const planets = ['Mercury', 'Venus', 'Earth', 'Mars'];
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function paste(target: Locator, text: string, html = '') {
  await target.focus();
  await target.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    if (content.text) clipboardData.setData('text/plain', content.text);
    if (content.html) clipboardData.setData('text/html', content.html);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, { text, html });
}

async function state(page: Page) {
  const raw: unknown = JSON.parse(await page.locator('output[data-state]').innerText());
  const mode = new URL(page.url()).searchParams.get('mode');
  if (!(mode === 'single_select' || mode === 'multi_select')) {
    expect.unreachable("Expected mode === 'single_select' || mode === 'multi_select'");
  }
  return parsePersistedDraft(raw, mode);
}

async function waitForChoices(page: Page, count: number) {
  await page.waitForFunction((expected) => {
    const output = document.querySelector('output[data-state]');
    return output && JSON.parse(output.textContent ?? '{}').choices?.length === expected;
  }, count);
}

testCase('choice paste splits document lists, preserves answers, and supports undo and export', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.choice-paste-browser-'));
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
    if (path === '/tw.css' || path === '/styles.css') {
      return new Response(_fsSync.readFileSync(`static${path}`, 'utf8'), {
        headers: { 'content-type': 'text/css' },
      });
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/tw.css"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script type="module" src="/bundle.js"></script>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
  const browser = await chromium.launch();
  const context: import('playwright').BrowserContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page: import('playwright').Page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = `http://${'127.0.0.1'}:${server.port}`;
  try {
    for (const locale of INTERFACE_LOCALES) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      for (const mode of ['single_select', 'multi_select'] as const) {
        for (const rich of [false, true]) {
          await page.goto(`${base}/?locale=${locale}&mode=${mode}&rich=${Number(rich)}`);
          const fields = page.locator(
            rich ? '[contenteditable="true"]' : 'textarea[placeholder]',
          );
          await fields.first().waitFor();
          await paste(fields.first(), ' Mercury\r\n\r\nVenus\r\n Earth \r\nMars\r\n');
          await waitForChoices(page, 4);
          let draft = await state(page);
          expect(draft.choices?.map((choice) => choice.text)).toStrictEqual(planets);
          expect(draft.choices?.map((choice) => choice.id)).toStrictEqual(['A', 'B', 'C', 'D']);
          expect(mode === 'single_select' ? draft.correctId : draft.correctIds).toStrictEqual(
            mode === 'single_select' ? '' : [],
          );
          await page.getByRole('button', { name: i18n.t('driver.undoChoicePaste') }).waitFor();
          expect(
            await page.getByRole('status').filter({
              hasText: i18n.t('driver.choicesPasted', { count: 4 }),
            }).innerText(),
          ).toContain(i18n.t('driver.choicesPasted', { count: 4 }));
          await fields.first().press(`${modifier}+z`);
          await waitForChoices(page, 2);
          expect((await state(page)).choices?.map((choice) => choice.text)).toStrictEqual(['', '']);

          await paste(
            fields.first(),
            '',
            '<div><p><b>Mercury</b></p><p>&nbsp;</p><p>Venus</p><p>Earth<br>Mars</p></div>',
          );
          await waitForChoices(page, 4);
          expect((await state(page)).choices?.map((choice) => choice.text)).toStrictEqual(planets);
          if (rich) expect((await state(page)).choices?.[0].html ?? '').toContain('<b>');
          await page.getByRole('button', { name: i18n.t('driver.keepPasteAsOneChoice') }).click();
          await waitForChoices(page, 2);
          draft = await state(page);
          expect(draft.choices?.[0].text).toStrictEqual(planets.join('\n'));
          if (!rich) {
            expect(await page.locator('textarea').first().inputValue()).toStrictEqual(
              planets.join('\n'),
            );
          }

          await page.goto(
            `${base}/?locale=${locale}&mode=${mode}&rich=${Number(rich)}&existing=1`,
          );
          await fields.first().waitFor();
          await paste(fields.first(), planets.join('\n'));
          await waitForChoices(page, 5);
          draft = await state(page);
          expect(draft.choices?.[4]).toStrictEqual({
            id: 'Q',
            text: 'Existing answer',
            label: 'Original',
            fixed: true,
          });
          expect(mode === 'single_select' ? draft.correctId : draft.correctIds).toStrictEqual(
            mode === 'single_select' ? 'Q' : ['Q'],
          );
          await page.getByRole('button', { name: 'Save and reopen' }).click();
          await waitForChoices(page, 5);
          expect(await state(page)).toStrictEqual(draft);
          const xml = exportQti3AssessmentItemXml(mode, draft, { identifier: 'paste-roundtrip' });
          const document = new DOMParser().parseFromString(xml, 'text/xml');
          const choices = Array.from(document.getElementsByTagName('qti-simple-choice'));
          expect(choices.map((choice) => choice.textContent)).toStrictEqual([
            ...planets,
            'Existing answer',
          ]);
          expect(xml).toContain('<qti-value>Q</qti-value>');
        }
      }
    }

    await page.goto(`${base}/?locale=en-US&mode=single_select&rich=0`);
    const fields = page.locator('textarea[placeholder]');
    await fields.first().waitFor();
    await page.evaluate(() => navigator.clipboard.writeText('Mercury\nVenus\nEarth\nMars'));
    await fields.first().press(`${modifier}+v`);
    await waitForChoices(page, 4);
    expect((await state(page)).choices?.map((choice) => choice.text)).toStrictEqual(planets);
    await page.screenshot({ path: '/tmp/qflow-choice-paste-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
      expect.unreachable(
        'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
      );
    }
    await page.screenshot({ path: '/tmp/qflow-choice-paste-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Undo paste' }).click();
    await waitForChoices(page, 2);
    await fields.first().fill('Option A');
    await fields.first().press(`${modifier}+a`);
    await fields.first().press(`${modifier}+v`);
    await waitForChoices(page, 4);
    await page.getByRole('button', { name: 'Remove choice' }).nth(1).click();
    await page.getByRole('button', { name: 'Add choice' }).click();
    const ids = (await state(page)).choices?.map((choice) => choice.id);
    expect(ids?.length).toStrictEqual(new Set(ids).size);

    await page.goto(`${base}/?locale=en-US&mode=single_select&rich=0`);
    await fields.first().waitFor();
    await page.evaluate(() => navigator.clipboard.writeText('Single answer'));
    await fields.first().press(`${modifier}+v`);
    expect((await state(page)).choices?.length).toStrictEqual(2);
    expect(await fields.first().inputValue()).toStrictEqual('Single answer');
    await page.evaluate(() => navigator.clipboard.writeText('One\nTwo'));
    await fields.first().press('End');
    await fields.first().press(`${modifier}+v`);
    expect((await state(page)).choices?.length).toStrictEqual(2);
    expect(await page.getByRole('button', { name: 'Undo paste' }).count()).toStrictEqual(0);

    await page.goto(`${base}/?locale=en-US&mode=multi_select&rich=0`);
    await fields.first().waitFor();
    await paste(
      fields.first(),
      Array.from({ length: 35 }, (_, i) => `Answer ${i + 1}`).join('\n'),
    );
    await waitForChoices(page, 35);
    const longDraft = await state(page);
    expect(longDraft.choices?.[26].id).toStrictEqual('AA');
    expect(new Set(longDraft.choices?.map((choice) => choice.id)).size).toStrictEqual(35);
    await fields.first().fill('Edited answer');
    expect(await page.getByRole('button', { name: 'Undo paste' }).count()).toStrictEqual(0);
    expect((await state(page)).choices?.[0].text).toStrictEqual('Edited answer');

    for (
      const sample of [
        { text: 'One\nTwo', html: '<span style="white-space: pre-wrap">One\nTwo</span>' },
        { text: '', html: '<pre>One\nTwo</pre>' },
        { text: '', html: '<b id="source"><i>One<br>Two</i></b>', expectedHtml: '<b><i>' },
        {
          text: '',
          html: '<b>One</b><br><i>Two</i>',
        },
        { text: '', html: '<div><b>One</b></div><section><em>Two</em></section>' },
        { text: '', html: '<ul><li><font face="Arial">One</font></li><li>Two</li></ul>' },
        {
          text: '',
          html:
            '<p onclick="alert(1)"><a href="javascript:alert(1)">One</a></p><p>Two<script>alert(1)</script></p>',
        },
      ]
    ) {
      await page.goto(`${base}/?locale=en-US&mode=single_select&rich=1`);
      const richFields = page.locator('[contenteditable="true"]');
      await richFields.first().waitFor();
      await paste(richFields.first(), sample.text, sample.html);
      await page.getByRole('button', { name: 'Undo paste' }).waitFor();
      const parsed = await state(page);
      expect(parsed.choices?.map((choice) => choice.text)).toStrictEqual(['One', 'Two']);
      for (const choice of parsed.choices ?? []) {
        if ((choice.html ?? '').includes('javascript:')) {
          expect.unreachable("Expected !(choice.html ?? '').includes('javascript:')");
        }
        if ((choice.html ?? '').includes('onclick')) {
          expect.unreachable("Expected !(choice.html ?? '').includes('onclick')");
        }
        if ((choice.html ?? '').includes('<script')) {
          expect.unreachable("Expected !(choice.html ?? '').includes('<script')");
        }
        if ((choice.html ?? '').includes('&lt;font')) {
          expect.unreachable("Expected !(choice.html ?? '').includes('&lt;font')");
        }
        if ((choice.html ?? '').includes('id="source"')) {
          expect.unreachable("Expected !(choice.html ?? '').includes('id=\"source\"')");
        }
        if (sample.expectedHtml) expect(choice.html ?? '').toContain(sample.expectedHtml);
      }
    }

    await page.goto(`${base}/?locale=en-US&mode=single_select&rich=0`);
    await fields.first().waitFor();
    await paste(fields.first(), '< & >\n2 ≤ 3\n漢字\n🌍');
    await waitForChoices(page, 4);
    expect((await state(page)).choices?.map((choice) => choice.text)).toStrictEqual([
      '< & >',
      '2 ≤ 3',
      '漢字',
      '🌍',
    ]);
    await page.getByRole('radio').nth(2).check();
    expect(await page.getByRole('button', { name: 'Undo paste' }).count()).toStrictEqual(0);
    expect((await state(page)).correctId).toStrictEqual('C');

    for (const mode of ['single_select', 'multi_select'] as const) {
      for (const rich of [false, true]) {
        await page.goto(`${base}/?locale=en-US&mode=${mode}&rich=${Number(rich)}&existing=1`);
        const answers = page.locator(rich ? '[contenteditable="true"]' : 'textarea[placeholder]');
        await answers.first().waitFor();
        await paste(answers.first(), planets.join('\n'));
        await waitForChoices(page, 5);
        await page.getByRole('button', { name: 'Undo paste' }).waitFor();
        if (mode === 'multi_select') {
          await page.getByRole('checkbox').first().check();
          await page.getByRole('checkbox').first().uncheck();
          expect((await state(page)).correctIds).toStrictEqual(['Q']);
        } else {
          await page.getByRole('radio').first().check();
          await page.getByRole('radio').last().check();
          expect((await state(page)).correctId).toStrictEqual('Q');
        }
        expect(await page.getByRole('button', { name: 'Undo paste' }).count()).toStrictEqual(0);
        // The shortcut must return to the editor after any author edit, even a reverted one.
        if (
          !(await answers.first().evaluate((element) =>
            element.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'z',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
              }),
            )
          ))
        ) {
          expect.unreachable(
            "Expected await answers.first().evaluate((element) => element.dispatchEvent( new KeyboardEvent('keyd",
          );
        }
        expect((await state(page)).choices?.map((choice) => choice.text)).toStrictEqual([
          ...planets,
          'Existing answer',
        ]);
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
      expect.unreachable(
        'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
      );
    }
    expect(errors).toStrictEqual([]);
  } catch (cause: unknown) {
    throw new Error(
      `Browser errors: ${errors.join('; ')}; body: ${await page.locator('body').innerText()}`,
      {
        cause,
      },
    );
  } finally {
    await context.close();
    await browser.close();
    await server.close();
    await _fs.rm(temp, { recursive: true });
  }
});
