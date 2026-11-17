import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { type InterfaceLocale, parseInterfaceLocale } from '../lib/i18n/locale.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
type Messages = Readonly<{ label: string; help: string; required: string; invalid: string }>;

testCase('item language control browser contract', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tmp = await _fs.mkdtemp(_path.join(process.cwd(), '.item-language-browser-'));
  const entry = `${tmp}/entry.ts`;
  const bundle = `${tmp}/bundle.js`;
  await _fs.writeFile(
    entry,
    `
import { h, render } from "preact";
import { useMemo, useState } from "preact/hooks";
import { ItemLanguageSection } from "../islands/drivers/right_rail/sections.tsx";
import { buildRightRailControls } from "../islands/drivers/right_rail/build_controls.tsx";
import { TYPE_DRIVERS } from "../lib/types/registry.ts";
import { parseItemLanguage } from "../lib/types/item_language.ts";
const root = document.getElementById("root");
function App({ config }) {
  const [draft, setDraft] = useState({ ...TYPE_DRIVERS.single_select.defaults(), itemLanguage: parseItemLanguage(config.value), title: "AUTHORED-SENTINEL" });
  const [messages, setMessages] = useState(config.messages);
  const [updates, setUpdates] = useState(0);
  const controls = useMemo(() => buildRightRailControls("single_select", TYPE_DRIVERS.single_select.capabilities, draft, (next) => { setDraft(next); setUpdates((count) => count + 1); }, { itemLanguageMessages: messages, t: (id) => id }), [draft, messages]);
  globalThis.__ITEM_LANGUAGE_COMMANDS__ = {
    swap: (next) => { setMessages(next.messages); },
    external: (value) => setDraft((current) => ({ ...current, itemLanguage: parseItemLanguage(value) })),
    updates: () => updates,
  };
  return h("main", null, h("div", { id: "control-one" }, controls.itemLanguage && h(ItemLanguageSection, { controls })), h("div", { id: "control-two" }, controls.itemLanguage && h(ItemLanguageSection, { controls })), h("output", { id: "draft-language" }, draft.itemLanguage), h("output", { id: "sentinel" }, draft.title), h("output", { id: "update-count" }, String(updates)));
}
globalThis.renderItemLanguage = (config) => render(h(App, { config }), root);
globalThis.renderItemLanguage(globalThis.__ITEM_LANGUAGE_CONFIG__);
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
  if (bundleText.includes('Item language is required.')) {
    expect.unreachable("Expected !bundleText.includes('Item language is required.')");
  }
  if (bundleText.includes('Finalizar intento')) {
    expect.unreachable("Expected !bundleText.includes('Finalizar intento')");
  }
  if (bundleText.includes('Pregunta sin título')) {
    expect.unreachable("Expected !bundleText.includes('Pregunta sin título')");
  }

  const messagesFor = (locale: InterfaceLocale): Messages => {
    const authoring = catalogForLocale(locale).authoring;
    return {
      label: authoring['itemLanguage.label'],
      help: authoring['itemLanguage.help'],
      required: authoring['itemLanguage.required'],
      invalid: authoring['itemLanguage.invalid'],
    };
  };
  const configs = new Map(locales.map((locale) => [locale, {
    messages: messagesFor(locale),
    value: 'en-US',
  }]));
  const safe = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
  const server = await startFetchServer((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/bundle.js') {
      return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    const locale = parseInterfaceLocale(url.searchParams.get('locale') ?? 'en-US');
    if (!locale) return new Response('Unsupported locale', { status: 400 });
    const config = configs.get(locale)!;
    if (url.pathname === '/messages') {
      return new Response(JSON.stringify({ messages: config.messages }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      `<!doctype html><meta charset="utf-8"><div id="root"></div><script>globalThis.__ITEM_LANGUAGE_CONFIG__=${
        safe(config)
      }</script><script type="module" src="/bundle.js"></script>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
  const browser = await chromium.launch();
  try {
    const page: import('playwright').Page = await browser.newPage();
    const base = `http://${'127.0.0.1'}:${server.port}`;
    for (const locale of locales) {
      await page.goto(`${base}/?locale=${locale}`);
      const messages = messagesFor(locale);
      const input = page.locator('#control-one input');
      await page.getByText(messages.label).first().waitFor();
      await page.getByText(messages.help).first().waitFor();
      const bodyText = await page.locator('body').innerText();
      for (const example of ['BCP 47', 'en-US', 'es-419', 'fr-CA']) {
        if (!(bodyText.includes(example))) {
          expect.unreachable('Expected bodyText.includes(example)');
        }
      }
      await input.fill('');
      await input.blur();
      await page.getByRole('alert').filter({ hasText: messages.required }).waitFor();
      if (!(await input.getAttribute('aria-invalid') === 'true')) {
        expect.unreachable("Expected await input.getAttribute('aria-invalid') === 'true'");
      }
      const described = (await input.getAttribute('aria-describedby'))!.split(' ');
      for (const id of described) {
        if (!(await page.locator(`[id="${id}"]`).count() === 1)) {
          expect.unreachable('Expected await page.locator(`[id="${id}"]`).count() === 1');
        }
      }
      const secondInput = page.locator('#control-two input');
      await secondInput.fill('');
      await secondInput.blur();
      const errorIds = await page.locator('input').evaluateAll((nodes) =>
        nodes.map((node) => ({ id: node.id, described: node.getAttribute('aria-describedby') }))
      );
      if (!(new Set(errorIds.map((item) => item.id)).size === errorIds.length)) {
        expect.unreachable(
          'Expected new Set(errorIds.map((item) => item.id)).size === errorIds.length',
        );
      }
      const allDescribedIds = errorIds.flatMap((item) => item.described?.split(' ') ?? []);
      if (!(new Set(allDescribedIds).size === allDescribedIds.length)) {
        expect.unreachable('Expected new Set(allDescribedIds).size === allDescribedIds.length');
      }
      if (!(await page.getByRole('alert').count() === 2)) {
        expect.unreachable("Expected await page.getByRole('alert').count() === 2");
      }
      await page.evaluate(() => globalThis.__ITEM_LANGUAGE_COMMANDS__.external('en-US'));
      await input.fill('not a language');
      await input.blur();
      await page.getByRole('alert').filter({ hasText: messages.invalid }).waitFor();
      if (!(await input.getAttribute('aria-invalid') === 'true')) {
        expect.unreachable("Expected await input.getAttribute('aria-invalid') === 'true'");
      }
      await input.fill(' FR-ca ');
      await input.blur();
      await page.waitForFunction(() =>
        document.querySelector<HTMLInputElement>('#control-one input')?.value === 'fr-CA'
      );
      if (!(await page.locator('#draft-language').innerText() === 'fr-CA')) {
        expect.unreachable(
          "Expected await page.locator('#draft-language').innerText() === 'fr-CA'",
        );
      }
      if (!(await page.locator('#update-count').innerText() === '1')) {
        expect.unreachable(await page.locator('#update-count').innerText());
      }
      await page.evaluate(() => globalThis.__ITEM_LANGUAGE_COMMANDS__.external('fr-CA'));
      if (!(await page.getByRole('alert').count() === 0)) {
        expect.unreachable("Expected await page.getByRole('alert').count() === 0");
      }
      if (!(await input.getAttribute('aria-invalid') === null)) {
        expect.unreachable("Expected await input.getAttribute('aria-invalid') === null");
      }
      const ids = await page.locator('input').evaluateAll((nodes) =>
        nodes.map((node) => ({ id: node.id, described: node.getAttribute('aria-describedby') }))
      );
      if (!(new Set(ids.map((item) => item.id)).size === ids.length)) {
        expect.unreachable('Expected new Set(ids.map((item) => item.id)).size === ids.length');
      }
      const describedIds = ids.flatMap((item) => item.described?.split(' ') ?? []);
      if (!(new Set(describedIds).size === describedIds.length)) {
        expect.unreachable('Expected new Set(describedIds).size === describedIds.length');
      }
      const before = await page.locator('#sentinel').innerText();
      await input.fill('not a language');
      await input.blur();
      await page.getByRole('alert').filter({ hasText: messages.invalid }).waitFor();
      if (!(await input.getAttribute('aria-invalid') === 'true')) {
        expect.unreachable("Expected await input.getAttribute('aria-invalid') === 'true'");
      }
      const beforeExternalUpdates = await page.locator('#update-count').innerText();
      await page.evaluate(() => globalThis.__ITEM_LANGUAGE_COMMANDS__.external('de-DE'));
      await page.waitForFunction(() =>
        document.querySelector<HTMLInputElement>('#control-one input')?.value === 'de-DE'
      );
      if (!(await page.getByRole('alert').count() === 0)) {
        expect.unreachable("Expected await page.getByRole('alert').count() === 0");
      }
      if (!(await input.getAttribute('aria-invalid') === null)) {
        expect.unreachable("Expected await input.getAttribute('aria-invalid') === null");
      }
      if (!(await page.locator('#update-count').innerText() === beforeExternalUpdates)) {
        expect.unreachable(
          "Expected await page.locator('#update-count').innerText() === beforeExternalUpdates",
        );
      }
      const spanish = await page.request.get(`${base}/messages?locale=es-ES`).then((response) =>
        response.json()
      );
      await page.evaluate(
        (messages) => globalThis.__ITEM_LANGUAGE_COMMANDS__.swap(messages),
        spanish,
      );
      await page.getByText(spanish.messages.label).first().waitFor();
      await page.getByText(spanish.messages.help).first().waitFor();
      if (!(await input.inputValue() === 'de-DE')) {
        expect.unreachable("Expected await input.inputValue() === 'de-DE'");
      }
      if (!(await page.locator('#draft-language').innerText() === 'de-DE')) {
        expect.unreachable(
          "Expected await page.locator('#draft-language').innerText() === 'de-DE'",
        );
      }
      if (!(await page.locator('#sentinel').innerText() === before)) {
        expect.unreachable("Expected await page.locator('#sentinel').innerText() === before");
      }
      const beforeSwapUpdates = await page.locator('#update-count').innerText();
      const regional = await page.request.get(`${base}/messages?locale=es-419`).then((response) =>
        response.json()
      );
      await page.evaluate(
        (messages) => globalThis.__ITEM_LANGUAGE_COMMANDS__.swap(messages),
        regional,
      );
      await page.getByText(regional.messages.label).first().waitFor();
      await page.getByText(regional.messages.help).first().waitFor();
      if (!(await input.inputValue() === 'de-DE')) {
        expect.unreachable("Expected await input.inputValue() === 'de-DE'");
      }
      if (!(await page.locator('#draft-language').innerText() === 'de-DE')) {
        expect.unreachable(
          "Expected await page.locator('#draft-language').innerText() === 'de-DE'",
        );
      }
      if (!(await page.locator('#update-count').innerText() === beforeSwapUpdates)) {
        expect.unreachable(
          "Expected await page.locator('#update-count').innerText() === beforeSwapUpdates",
        );
      }
      if (!(await page.locator('#sentinel').innerText() === before)) {
        expect.unreachable("Expected await page.locator('#sentinel').innerText() === before");
      }
    }
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tmp, { recursive: true });
  }
});

declare global {
  var __ITEM_LANGUAGE_CONFIG__: Record<string, unknown>;
  var __ITEM_LANGUAGE_COMMANDS__: {
    swap: (config: Record<string, unknown>) => void;
    external: (value: string) => void;
    updates: () => number;
  };
  var renderItemLanguage: (config: Record<string, unknown>) => void;
}
