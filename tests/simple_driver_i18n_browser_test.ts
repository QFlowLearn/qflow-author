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
type CapturedDriverDraft = {
  correctId?: string;
  correctIds?: string[];
  correctOrder?: string[];
  choices: Array<{ id: string; text?: string; label?: string; fixed?: boolean }>;
  textEntries?: Array<{
    widthClass?: string;
    patternMask?: string;
    answers: Array<{ id: string; value: string; caseSensitive?: boolean }>;
  }>;
  responseIdentifier?: string;
  endAttemptTitle?: string;
};

testCase('registered simple drivers preserve authored and machine values across locales', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.simple-driver-browser-'));
  const entry = `${temp}/entry.tsx`;
  const bundle = `${temp}/bundle.js`;
  await _fs.writeFile(
    entry,
    `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { parsePersistedDraft } from "${process.cwd()}/lib/persisted_draft.ts";
import { driverViewsFor } from "${process.cwd()}/islands/drivers/view_registry.ts";
import "${process.cwd()}/islands/drivers/single_select.tsx";
import "${process.cwd()}/islands/drivers/multi_select.tsx";
import "${process.cwd()}/islands/drivers/order.tsx";
import "${process.cwd()}/islands/drivers/text_entry.tsx";
import "${process.cwd()}/islands/drivers/extended_text.tsx";
import "${process.cwd()}/islands/drivers/end_attempt.tsx";
import "${process.cwd()}/islands/drivers/upload.tsx";
import "${process.cwd()}/islands/drivers/choice_list_editor.tsx";

const TYPES = ['single_select','multi_select','order','text_entry','extended_text','end_attempt','upload'];
const common = {
  renderPromptField: (placeholder) => h('label', null, placeholder, h('input', { placeholder })),
  fieldHasIssue: () => false,
  fieldIssueText: () => undefined,
  plainTextValue: (text) => text || '',
  useRteForChoices: false,
  settings: { allowPins: true },
};
function initial(type) {
  const base = { type, itemLanguage: 'en-US', title: 'AUTHORED-TITLE-Ω', bodyHtml: '<p>AUTHORED-UNICODE-Ω</p>' };
  if (type === 'single_select' || type === 'multi_select') return { ...base, choices: [{id:'A',text:'AUTHORED-CHOICE-漢字'}, {id:'B',text:'Second'}], correctId:'A', correctIds:['A'], shuffle:true };
  if (type === 'order') return { ...base, choices: [{id:'A',text:'AUTHORED-A'}, {id:'B',text:'AUTHORED-B'}], correctOrder:['A','B'] };
  if (type === 'text_entry') return { ...base, textEntries:[{id:'RESPONSE',label:'AUTHORED-BLANK',expectedLength:4,widthClass:'qti-input-width-4',patternMask:'^[0-9]+$',patternMessage:'AUTHORED-PATTERN',answers:[{id:'answer-1',value:'42',score:1,caseSensitive:true}]}], requirePattern:true };
  if (type === 'end_attempt') return { ...base, responseIdentifier:'RESPONSE', endAttemptTitle:'AUTHORED-END-Ω', endAttemptCountAttempt:false };
  if (type === 'upload') return { ...base, responseIdentifier:'RESPONSE' };
  return base;
}
function RegisteredDriver({ type }) {
  const [draft, setDraft] = useState(() => parsePersistedDraft(initial(type), type));
  const views = driverViewsFor(type);
  if (!views) throw new Error('missing driver registration');
  const editor = type === 'text_entry'
    ? { ...common, setDraftListField: (key, value) => setDraft((previous) => ({
      ...previous,
      [key]: typeof value === 'function' ? value(previous[key]) : value,
    })) }
    : common;
  return h('section', { 'data-driver': type },
    views.ui({ draft, update: setDraft, editor }),
    h('output', { 'data-state': type }, JSON.stringify(draft)),
  );
}
function App({ config }) {
  return h(I18nProvider, { payload: config.payload }, h('main', null,
    TYPES.map((type) => h(RegisteredDriver, { type, key: type })),
  ));
}
globalThis.renderDrivers = (config) => render(h(App, { config }), document.getElementById('root'));
globalThis.renderDrivers(globalThis.__DRIVER_CONFIG__);
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
  if (bundleText.includes('lib/i18n/messages/')) {
    expect.unreachable("Expected !bundleText.includes('lib/i18n/messages/')");
  }
  const configs = new Map(locales.map((locale) => {
    const catalog = catalogForLocale(locale);
    return [locale, { payload: createI18nPayload(locale, catalog, ['authoring']) }];
  }));
  const safeJson = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
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
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"></head><body><div id="root"></div><script>globalThis.__DRIVER_ERRORS__={console:[],window:[],unhandled:[]};addEventListener('error',e=>globalThis.__DRIVER_ERRORS__.window.push(String(e.message||e.type)));addEventListener('unhandledrejection',e=>globalThis.__DRIVER_ERRORS__.unhandled.push(String(e.reason||'unhandled')));globalThis.__DRIVER_CONFIG__=${
        safeJson(config)
      }</script><script type="module" src="/bundle.js"></script></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      try {
        page.setDefaultTimeout(3_000);
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        await page.goto(`http://${'127.0.0.1'}:${server.port}/?locale=${locale}`, {
          waitUntil: 'domcontentloaded',
          timeout: 10_000,
        });
        try {
          await page.getByText(i18n.t('driver.choices')).first().waitFor({ timeout: 5_000 });
        } catch (error) {
          throw new Error(
            `Driver harness failed for ${locale}: ${pageErrors.join('; ')} body=${await page
              .locator('body').innerText()} ${error}`,
          );
        }
        const body = page.locator('body');
        const text = await body.innerText();
        expect(text).toContain(i18n.t('driver.choices'));
        expect(text).toContain(i18n.t('driver.blanks'));
        expect(text).toContain(i18n.t('driver.reorderHelp'));
        expect(text).toContain(i18n.t('driver.identifiersHelp'));
        expect(text).toContain(i18n.t('driver.acceptedAnswers'));
        expect(text).toContain(i18n.t('driver.scorerRubric'));
        expect(text).toContain(i18n.t('driver.buttonLabel'));
        expect(text).toContain(i18n.t('driver.uploadPrompt'));
        expect(text).toContain('AUTHORED-CHOICE-漢字');
        expect(text).toContain('AUTHORED-UNICODE-Ω');
        expect(text).toContain('^[0-9]+$');
        const single = page.locator('[data-driver="single_select"]');
        const state = async (type: string): Promise<CapturedDriverDraft> =>
          JSON.parse(
            await page.locator('[data-state="' + type + '"]').innerText(),
          ) as CapturedDriverDraft;
        await single.getByRole('radio').nth(1).click();
        const singleAfterCorrect = await state('single_select');
        expect(singleAfterCorrect.correctId).toStrictEqual('B');
        expect(singleAfterCorrect.choices.map((choice) => choice.id)).toStrictEqual(['A', 'B']);
        expect(singleAfterCorrect.choices[0].text).toStrictEqual('AUTHORED-CHOICE-漢字');
        await single.getByText(i18n.t('driver.pinChoice')).first().click();
        const singleAfterPin = await state('single_select');
        expect(singleAfterPin.choices[0].fixed).toStrictEqual(true);
        expect(singleAfterPin.choices[0].id).toStrictEqual('A');
        expect(singleAfterPin.choices[0].text).toStrictEqual('AUTHORED-CHOICE-漢字');
        await single.getByRole('button', { name: i18n.t('driver.editChoice', { label: 'A' }) })
          .click();
        const labelInput = single.locator(
          'input[aria-label="' + i18n.t('driver.choiceLabel') + '"]',
        );
        await labelInput.fill('AUTHORED-EDIT-✓');
        await labelInput.press('Enter');
        const singleAfterLabel = await state('single_select');
        expect(singleAfterLabel.choices[0].label).toStrictEqual('AUTHORED-EDIT-✓');
        expect(singleAfterLabel.choices[0].text).toStrictEqual('AUTHORED-CHOICE-漢字');
        const multi = page.locator('[data-driver="multi_select"]');
        await multi.locator('[title="' + i18n.t('driver.markCorrect') + '"]').nth(1).click();
        const multiAfterCorrect = await state('multi_select');
        expect(multiAfterCorrect.correctIds).toStrictEqual(['A', 'B']);
        expect(multiAfterCorrect.choices.map((choice) => choice.id)).toStrictEqual(['A', 'B']);
        expect(multiAfterCorrect.choices[0].text).toStrictEqual('AUTHORED-CHOICE-漢字');
        const order = page.locator('[data-driver="order"] [draggable]').first();
        await order.focus();
        await page.keyboard.down('Alt');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.up('Alt');
        const orderState = await state('order');
        expect(orderState.choices.map((choice) => choice.id)).toStrictEqual(['B', 'A']);
        expect(orderState.correctOrder).toStrictEqual(['B', 'A']);
        const entrySection = page.locator('[data-driver="text_entry"]');
        const width = entrySection.locator('select').first();
        await page.waitForTimeout(300);
        await width.selectOption('qti-input-width-6');
        await page.waitForTimeout(50);
        const pattern = entrySection.locator('select').nth(1);
        await pattern.selectOption('__custom__');
        await entrySection.getByPlaceholder(i18n.t('driver.regexPlaceholder')).fill('^[A-Z]{2}$');
        await entrySection.getByPlaceholder(i18n.t('driver.answerPlaceholder')).fill(
          'AUTHORED-ANSWER-✓',
        );
        await entrySection.getByRole('checkbox', { name: i18n.t('driver.caseSensitive') })
          .click();
        const entryState = await state('text_entry');
        const entry = entryState.textEntries?.[0];
        if (!entry) expect.unreachable('Text-entry state did not retain its slot');
        expect(await width.inputValue()).toStrictEqual('qti-input-width-6');
        expect(entry.widthClass).toStrictEqual('qti-input-width-6');
        expect(entry.patternMask).toStrictEqual('^[A-Z]{2}$');
        expect(entry.answers[0].id).toStrictEqual('answer-1');
        expect(entry.answers[0].value).toStrictEqual('AUTHORED-ANSWER-✓');
        expect(entry.answers[0].caseSensitive).toStrictEqual(false);
        const endState = await state('end_attempt');
        expect(endState.responseIdentifier).toStrictEqual('RESPONSE');
        expect(endState.endAttemptTitle).toStrictEqual('AUTHORED-END-Ω');
        const uploadState = await state('upload');
        expect(uploadState.responseIdentifier).toStrictEqual('RESPONSE');
        const finalText = await body.innerText();
        if (locale.startsWith('es')) {
          for (
            const forbidden of [
              'Choices',
              'Blanks',
              'Add choice',
              'Drag rows or press Alt+↑/↓ to reorder.',
              'Accepted answers',
              'Insert blank',
              'Show identifiers',
              'Require a pattern mask for each blank',
              'Expected length',
              'Pattern mask',
              'Custom regex',
              'Add answer',
              'Scorer rubric',
              'Button label',
              'Count this as an attempt when used',
              'Upload the requested file',
            ]
          ) {
            expect(finalText.includes(forbidden), `${locale} leaked ${forbidden}`).toStrictEqual(
              false,
            );
          }
        }
        expect(pageErrors, `Page errors for ${locale}`).toStrictEqual([]);
        const browserErrors = await page.evaluate(() =>
          (globalThis as typeof globalThis & {
            __DRIVER_ERRORS__: { window: string[]; unhandled: string[] };
          })
            .__DRIVER_ERRORS__
        );
        expect(browserErrors.window, `Window errors for ${locale}`).toStrictEqual([]);
        expect(browserErrors.unhandled, `Unhandled rejections for ${locale}`).toStrictEqual([]);
        expect(consoleErrors, `Console errors for ${locale}`).toStrictEqual([]);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
    await _fs.rm(temp, { recursive: true });
  }
});
