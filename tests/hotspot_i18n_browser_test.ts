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
type BrowserHotspotState = {
  choices: Array<{ id: string; shape: string; coords: string }>;
  correctIds: string[];
  image: { source: string; alt: string };
};

testCase('hotspot authoring interaction works in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.hotspot-browser-'));
  const entry = `${temp}/entry.tsx`;
  const bundle = `${temp}/bundle.js`;
  await _fs.writeFile(
    entry,
    `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { HotspotContent } from "${process.cwd()}/islands/drivers/hotspot.tsx";
function App({config}) {
  const [state, setState] = useState({choices: config.choices, correctIds: config.correctIds, image: config.image, responseIdentifier:'RESPONSE'});
  const setChoicesAndState = (value) => setState((prev) => ({...prev, choices: typeof value === 'function' ? value(prev.choices) : value}));
  const setCorrectAndState = (value) => setState((prev) => ({...prev, correctIds: typeof value === 'function' ? value(prev.correctIds) : value}));
  const setImageAndState = (value) => setState((prev) => ({...prev, image:value}));
  const update = (next) => setState((prev) => ({...prev, ...next}));
  return h(I18nProvider, {payload: config.payload}, h('main', null,
    h(HotspotContent, {
      image: state.image, responseIdentifier: state.responseIdentifier, choices: state.choices, correctIds: state.correctIds, maxChoices: config.maxChoices,
      renderPromptField: (placeholder) => h('label', null, h('span', null, 'Prompt'), h('input', {placeholder})),
      fieldHasIssue: () => false, fieldIssueText: () => undefined,
      setImage: setImageAndState, setResponseIdentifier: (value) => update({responseIdentifier:value}),
      setCorrectIds: setCorrectAndState, addHotspotChoice: () => setChoicesAndState((prev) => [...prev, {id:'C', shape:'circle', coords:'50,50,20'}]),
      removeHotspotChoice: (id) => { setChoicesAndState((prev) => prev.filter((choice) => choice.id !== id)); setCorrectAndState((prev) => prev.filter((id2) => id2 !== id)); },
      updateHotspotChoiceId: (id, nextId) => setState((prev) => ({...prev, choices: prev.choices.map((choice) => choice.id === id ? {...choice, id:nextId} : choice), correctIds: prev.correctIds.map((cid) => cid === id ? nextId : cid)})),
      updateHotspotChoiceShape: (id, shape) => setChoicesAndState((prev) => prev.map((choice) => choice.id === id ? {...choice, shape} : choice)),
      updateHotspotChoiceCoords: (id, coords) => setChoicesAndState((prev) => prev.map((choice) => choice.id === id ? {...choice, coords} : choice)),
    }), h('output', {'data-state':'hotspot'}, JSON.stringify(state)),
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
    choices: [{ id: 'A<&-Ω', shape: 'circle', coords: '50,50,10' }],
    correctIds: ['A<&-Ω'],
    image: {
      source:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',
      alt: '<img data-authored-hotspot>ALT<&-漢字',
    },
    maxChoices: 1,
  }]));
  const server = await startFetchServer((request) => {
    const locale = new URL(request.url).searchParams.get('locale') as InterfaceLocale;
    const url = new URL(request.url);
    const baseConfig = configs.get(locale);
    const mode = url.searchParams.get('mode');
    const config = !baseConfig ? undefined : mode === 'multi'
      ? {
        ...baseConfig,
        maxChoices: undefined,
        choices: [...baseConfig.choices, { id: 'B', shape: 'rect', coords: '10,10,30,30' }],
        correctIds: ['A<&-Ω'],
      }
      : mode === 'correct'
      ? {
        ...baseConfig,
        choices: [...baseConfig.choices, { id: 'B', shape: 'rect', coords: '10,10,30,30' }],
      }
      : mode === 'geometry'
      ? {
        ...baseConfig,
        choices: [{ id: 'A<&-Ω', shape: 'circle', coords: '50,50,10' }, {
          id: 'B',
          shape: 'rect',
          coords: '10,10,30,30',
        }, { id: 'C', shape: 'poly', coords: '' }],
      }
      : mode === 'no-active'
      ? { ...baseConfig, choices: [], correctIds: [] }
      : baseConfig;
    if (new URL(request.url).pathname === '/bundle.js') {
      return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (!config) return new Response('Unsupported locale', { status: 400 });
    const json = JSON.stringify(config).replaceAll('<', '\\u003c');
    return new Response(
      `<!doctype html><html lang="${locale}"><body><div id="root"></div><script>globalThis.__UNHANDLED__=[];addEventListener('unhandledrejection',event=>globalThis.__UNHANDLED__.push(String(event.reason??'unhandled')));globalThis.__CONFIG__=${json}</script><script type="module" src="/bundle.js"></script></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        const baseUrl = `http://${'127.0.0.1'}:${server.port}/?locale=${locale}`;
        await page.goto(baseUrl, {
          waitUntil: 'domcontentloaded',
        });
        await page.getByText(i18n.t('driver.hotspotRegions')).waitFor();
        const body = page.locator('body');
        const initial = await body.innerText();
        expect(initial).toContain(i18n.t('driver.hotspotAddRegion'));
        expect(initial).toContain('ALT<&-漢字');
        expect(initial).toContain('50,50,10');
        const presentationText = async () =>
          (await body.innerText()).replace(
            await page.locator('[data-state=hotspot]').innerText(),
            '',
          );
        const assertSafePresentation = async () => {
          const visible = await presentationText();
          if (visible.includes('driver.')) {
            expect.unreachable("Expected !visible.includes('driver.')");
          }
          if (visible.match(/\{(?:count|plural|select)(?:[,}])/)) {
            expect.unreachable('Expected !visible.match(/\\{(?:count|plural|select)(?:[,}])/)');
          }
        };
        await assertSafePresentation();
        const state = async (): Promise<BrowserHotspotState> =>
          JSON.parse(
            await page.locator('[data-state=hotspot]').innerText(),
          ) as BrowserHotspotState;
        const waitForCoords = async (index: number, coords: string) => {
          await page.waitForFunction(({ index, coords }) => {
            const output = document.querySelector('[data-state=hotspot]');
            if (!output) return false;
            const state = JSON.parse(output.textContent ?? '{}');
            return state.choices?.[index]?.coords === coords;
          }, { index, coords });
        };
        const remainingRemove = page.getByRole('button', { name: i18n.t('driver.remove') });
        expect(await remainingRemove.count()).toStrictEqual(1);
        expect(await remainingRemove.isDisabled()).toStrictEqual(true);
        await page.getByRole('button', { name: `+ ${i18n.t('driver.hotspotAddRegion')}` })
          .click();
        let current = await state();
        expect(current.choices.map((choice) => choice.id)).toStrictEqual(['A<&-Ω', 'C']);
        expect(current.choices[1].shape).toStrictEqual('circle');
        expect(current.choices[1].coords).toStrictEqual('50,50,20');
        expect(await remainingRemove.last().isDisabled()).toStrictEqual(false);
        await remainingRemove.last().click();
        current = await state();
        expect(current.choices.map((choice) => choice.id)).toStrictEqual(['A<&-Ω']);
        expect(current.correctIds).toStrictEqual(['A<&-Ω']);
        expect(await remainingRemove.first().isDisabled()).toStrictEqual(true);
        await page.goto(`${baseUrl}&mode=correct`, { waitUntil: 'domcontentloaded' });
        await page.getByText(i18n.t('driver.hotspotRegions')).waitFor();
        expect(await page.locator('input[type=radio]').count()).toStrictEqual(2);
        await page.locator('input[type=radio]').nth(1).check();
        current = await state();
        expect(current.correctIds).toStrictEqual(['B']);
        await page.getByRole('button', { name: i18n.t('driver.edit') }).click();
        expect(await body.innerText()).toContain(i18n.t('driver.editing'));
        const editingRegion = page.locator('label').filter({
          hasText: i18n.t('driver.editingRegion'),
        }).locator('select');
        expect(await editingRegion.inputValue()).toStrictEqual('B');
        const identifierLabels = page.locator('label').filter({
          hasText: i18n.t('driver.identifier'),
        });
        const bRow = identifierLabels.nth(1).locator(
          'xpath=ancestor::div[contains(@class,"grid")][1]',
        );
        expect(await bRow.innerText()).toContain(i18n.t('driver.editing'));
        const aRow = identifierLabels.nth(0).locator(
          'xpath=ancestor::div[contains(@class,"grid")][1]',
        );
        expect(await aRow.getByRole('button', { name: i18n.t('driver.edit') }).count())
          .toStrictEqual(1);
        const bIdInput = page.locator('label').filter({ hasText: i18n.t('driver.identifier') })
          .nth(1)
          .locator('input');
        await bIdInput.fill('B-EDIT');
        await page.locator('label').filter({ hasText: i18n.t('driver.shape') }).nth(1)
          .locator('select').selectOption('poly');
        current = await state();
        expect(current.choices.map((choice) => choice.id)).toStrictEqual(['A<&-Ω', 'B-EDIT']);
        expect(current.choices[1].shape).toStrictEqual('poly');
        expect(current.correctIds).toStrictEqual(['B-EDIT']);
        expect(await body.innerText()).toContain('A<&-Ω');
        current = await state();
        expect(current.image.alt).toStrictEqual('<img data-authored-hotspot>ALT<&-漢字');
        expect(await page.locator('[data-authored-hotspot]').count()).toStrictEqual(0);
        await assertSafePresentation();
        await page.goto(`${baseUrl}&mode=multi`, { waitUntil: 'domcontentloaded' });
        await page.getByText(i18n.t('driver.hotspotRegions')).waitFor();
        expect(await page.locator('input[type=checkbox]').count()).toStrictEqual(2);
        await page.locator('input[type=checkbox]').nth(1).check();
        current = await state();
        expect(current.correctIds).toStrictEqual(['A<&-Ω', 'B']);
        await page.locator('input[type=checkbox]').nth(0).uncheck();
        current = await state();
        expect(current.correctIds).toStrictEqual(['B']);
        await assertSafePresentation();
        await page.goto(`${baseUrl}&mode=geometry`, { waitUntil: 'domcontentloaded' });
        await page.getByText(i18n.t('driver.hotspotRegions')).waitFor();
        const svg = page.locator('svg[viewBox="0 0 100 100"]');
        const box = await svg.boundingBox();
        if (!box) expect.unreachable('Expected box');
        await page.waitForFunction(() => {
          const image = document.querySelector('img');
          return Boolean(image?.complete && image.naturalWidth > 0);
        });
        const imageBox = await svg.locator('xpath=..').boundingBox();
        if (!imageBox) expect.unreachable('Expected imageBox');
        await svg.evaluate((element) => element.style.setProperty('pointer-events', 'all'));
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width * 0.6,
          box.y + box.height / 2,
        );
        await page.mouse.up();
        await waitForCoords(0, '50,50,10');
        current = await state();
        const circleBefore = current.choices.map((choice) => choice.coords);
        expect(current.choices[0].coords, await svg.evaluate((el) => el.outerHTML)).toStrictEqual(
          '50,50,10',
        );
        expect(current.choices[1].coords).toStrictEqual('10,10,30,30');
        expect(current.choices[2].coords).toStrictEqual('');
        expect(circleBefore).toStrictEqual(['50,50,10', '10,10,30,30', '']);
        const activeRegion = page.locator('label').filter({
          hasText: i18n.t('driver.editingRegion'),
        })
          .locator('select');
        await activeRegion.selectOption('B');
        expect(await activeRegion.inputValue()).toStrictEqual('B');
        const rectBefore = (await state()).choices.map((choice) => choice.coords);
        await svg.locator('rect').first().dispatchEvent('pointerdown', {
          clientX: imageBox.x + imageBox.width * 0.2,
          clientY: imageBox.y + imageBox.height * 0.2,
          pointerId: 1,
          button: 0,
          buttons: 1,
          bubbles: true,
        });
        await svg.dispatchEvent('pointermove', {
          clientX: imageBox.x + imageBox.width * 0.4,
          clientY: imageBox.y + imageBox.height * 0.6,
          pointerId: 1,
          buttons: 1,
          bubbles: true,
        });
        await svg.dispatchEvent('pointerleave', {});
        await waitForCoords(1, '20,20,40,60');
        current = await state();
        expect(current.choices[1].coords).toStrictEqual('20,20,40,60');
        expect(current.choices[0].coords).toStrictEqual(rectBefore[0]);
        expect(current.choices[2].coords).toStrictEqual(rectBefore[2]);
        await activeRegion.selectOption('C');
        expect(await activeRegion.inputValue()).toStrictEqual('C');
        await svg.evaluate((element) => element.style.setProperty('pointer-events', 'all'));
        const polygonBefore = (await state()).choices.map((choice) => choice.coords);
        for (const [x, y] of [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]) {
          const point = {
            clientX: imageBox.x + imageBox.width * x,
            clientY: imageBox.y + imageBox.height * y,
            bubbles: true,
          };
          await svg.dispatchEvent('pointerdown', point);
          await page.waitForTimeout(10);
        }
        current = await state();
        expect(current.choices[2].coords).toStrictEqual('10,10,20,20,30,30');
        expect(current.choices[0].coords).toStrictEqual(polygonBefore[0]);
        expect(current.choices[1].coords).toStrictEqual(polygonBefore[1]);
        await page.getByRole('button', { name: i18n.t('driver.undoPolygonPoint') }).click();
        await waitForCoords(2, '10,10,20,20');
        current = await state();
        expect(current.choices[2].coords).toStrictEqual('10,10,20,20');
        expect(current.choices[0].coords).toStrictEqual(polygonBefore[0]);
        expect(current.choices[1].coords).toStrictEqual(polygonBefore[1]);
        await page.getByRole('button', { name: i18n.t('driver.clearPolygon') }).click();
        await waitForCoords(2, '');
        current = await state();
        expect(current.choices[2].coords).toStrictEqual('');
        expect(current.choices[0].coords).toStrictEqual('50,50,10');
        expect(current.choices[1].coords).toStrictEqual('20,20,40,60');
        await assertSafePresentation();
        if (locale === 'es-ES' || locale === 'es-419') {
          const interactedText = (await body.innerText()).replace(
            await page.locator('[data-state=hotspot]').innerText(),
            '',
          );
          for (
            const phrase of [
              'Hotspot regions',
              'Add region',
              'Image source',
              'Image alt text',
              'Image long description',
              'Image MIME type',
              'Coordinates',
              'Shape',
              'Correct answer',
              'Mark as correct',
              'Editing',
              'Edit region',
              'Remove region',
              'Region editor',
              'Editing region',
              'Circle',
              'Rectangle',
              'Polygon',
              'Undo polygon point',
              'Clear polygon',
              'Click the correct area on the image',
            ]
          ) {
            if (interactedText.includes(phrase)) {
              expect.unreachable(`${locale} leaked ${phrase}`);
            }
          }
        }
        await page.goto(`${baseUrl}&mode=no-active`, { waitUntil: 'domcontentloaded' });
        expect(await body.innerText()).toContain(i18n.t('driver.hotspotInstructionSelect'));
        expect(await page.locator('svg[viewBox="0 0 100 100"]').count()).toStrictEqual(1);
        const noActiveBefore = await state();
        const noActiveSvg = page.locator('svg[viewBox="0 0 100 100"]');
        const noActiveBox = await noActiveSvg.boundingBox();
        if (!noActiveBox) expect.unreachable('Expected noActiveBox');
        await page.mouse.click(
          noActiveBox.x + noActiveBox.width / 2,
          noActiveBox.y + noActiveBox.height / 2,
        );
        expect(await state()).toStrictEqual(noActiveBefore);
        await assertSafePresentation();
        if (locale === 'es-ES' || locale === 'es-419') {
          const noActiveText = await body.innerText();
          for (
            const phrase of ['Hotspot regions', 'Add region', 'Coordinates', 'Mark as correct']
          ) {
            if (noActiveText.includes(phrase)) {
              expect.unreachable('Expected !noActiveText.includes(phrase)');
            }
          }
        }
        expect(pageErrors).toStrictEqual([]);
        expect(consoleErrors).toStrictEqual([]);
        expect(
          await page.evaluate(() => (globalThis as { __UNHANDLED__?: unknown[] }).__UNHANDLED__),
        ).toStrictEqual([]);
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
