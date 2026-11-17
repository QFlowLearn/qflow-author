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
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('select-point authoring interactions work in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.select-point-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { SelectPointContent } from "${process.cwd()}/islands/drivers/select_point.tsx";
function App({config}) {
  const [state, setState] = useState(config.state);
  const update = (fn) => setState((prev) => ({...prev, ...fn(prev)}));
  return h(I18nProvider, {payload: config.payload}, h('main', null,
    h(SelectPointContent, {
      responseIdentifier: state.responseIdentifier,
      image: state.image,
      maxChoices: config.maxChoices,
      targets: state.targets,
      correctPoints: state.correctPoints,
      renderPromptField: (placeholder) => h('input', {'data-testid':'prompt', placeholder}),
      fieldHasIssue: () => false, fieldIssueText: () => undefined,
      setResponseIdentifier: (value) => update(() => ({responseIdentifier:value})),
      setImage: (value) => update(() => ({image:value})),
      addTarget: () => update((prev) => ({targets:[...prev.targets, {shape:'circle', coords:'120,120,12', mappedValue:1}]})),
      removeTarget: (index) => update((prev) => ({targets:prev.targets.filter((_, i) => i !== index)})),
      updateTargetShape: (index, shape) => update((prev) => ({targets:prev.targets.map((target, i) => i === index ? {...target, shape} : target)})),
      updateTargetCoords: (index, coords) => update((prev) => ({targets:prev.targets.map((target, i) => i === index ? {...target, coords} : target)})),
      updateTargetMappedValue: (index, mappedValue) => update((prev) => ({targets:prev.targets.map((target, i) => i === index ? {...target, mappedValue} : target)})),
      setCorrectPoints: (points) => update(() => ({correctPoints:points})),
    }), h('output', {'data-state':'select-point'}, JSON.stringify(state)),
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
      if (bundleText.includes(marker)) expect.unreachable(`bundle leaked ${marker}`);
    }
    const configs = new Map(locales.map((locale) => [locale, {
      payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      maxChoices: 1,
      state: {
        responseIdentifier: 'RESPONSE_Ω',
        image: {
          source:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',
          alt: '<img data-authored-point>ALT<&>Ω漢字',
        },
        targets: [],
        correctPoints: [],
      },
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
      const base = configs.get(locale);
      const mode = url.searchParams.get('mode');
      if (!base) return new Response('Unsupported locale', { status: 400 });
      const config = mode === 'finite'
        ? { ...base, maxChoices: 2 }
        : mode === 'unlimited'
        ? { ...base, maxChoices: 0 }
        : mode === 'targets'
        ? {
          ...base,
          maxChoices: 1,
          state: {
            ...base.state,
            targets: [{ shape: 'circle', coords: '10,20,5', mappedValue: 1 }],
          },
        }
        : mode === 'canvas'
        ? { ...base, maxChoices: 0, state: { ...base.state, correctPoints: [] } }
        : mode === 'no-image'
        ? { ...base, state: { ...base.state, image: { source: '', alt: '' } } }
        : base;
      return new Response(
        `<!doctype html><html lang="${locale}"><body><div id="root"></div><script>globalThis.__UNHANDLED__=[];addEventListener('unhandledrejection',e=>globalThis.__UNHANDLED__.push(String(e.reason??'unhandled')));globalThis.__CONFIG__=${
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
        const baseUrl = `http://${address.hostname}:${address.port}/?locale=${locale}`;
        const output = () => page.locator('[data-state=select-point]');
        const state = async () => JSON.parse(await output().innerText());
        const safeText = async () =>
          (await page.locator('body').innerText()).replace(await output().innerText(), '');
        const assertSafe = async () => {
          const text = await safeText();
          if (text.includes('driver.')) {
            expect.unreachable("Expected !text.includes('driver.')");
          }
          if (text.includes('editor.')) {
            expect.unreachable("Expected !text.includes('editor.')");
          }
          if (text.match(/\{(?:count|plural|select)(?:[,}])/)) {
            expect.unreachable('Expected !text.match(/\\{(?:count|plural|select)(?:[,}])/)');
          }
          expect(
            await page.evaluate(() => (globalThis as { __UNHANDLED__?: unknown[] }).__UNHANDLED__),
          ).toStrictEqual([]);
          if (locale === 'es-ES' || locale === 'es-419') {
            for (
              const phrase of [
                'Image source',
                'Image alt text',
                'Describe the image',
                'Image long description',
                'Image MIME type',
                'Image width',
                'Image height',
                'Target areas',
                'Add target',
                'Add target areas for scoring',
                'Shape',
                'Coordinates',
                'Mapped value',
                'Remove',
                'Circle',
                'Rectangle',
                'Polygon',
                'Default',
                'Correct point',
                'Correct points',
                'Set point',
                'Add point',
                'Set the point on the image',
                'Add points on the image',
                'Point 1',
                'Edit point 1',
                'Remove point 1',
                'Editing',
                'Point editor',
                'Editing point',
                'Place point 1 on the image',
                'Click the image to place',
                'Upload an image to place correct points visually',
              ]
            ) if (text.includes(phrase)) expect.unreachable(`${locale} leaked ${phrase}`);
          }
        };
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.getByText(i18n.t('driver.selectPointCorrectPoint')).waitFor();
        expect(await safeText()).toContain(i18n.t('driver.selectPointTargets'));
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        expect((await state()).image.alt).toStrictEqual('<img data-authored-point>ALT<&>Ω漢字');
        expect(await page.locator('[data-authored-point]').count()).toStrictEqual(0);
        expect(await safeText()).toContain(i18n.t('driver.selectPointEmptySingle'));
        await assertSafe();
        expect(await safeText()).toContain(i18n.t('driver.selectPointSetPoint'));
        await page.getByRole('button', { name: i18n.t('driver.selectPointSetPoint') }).click();
        expect(
          await page.getByRole('button', { name: i18n.t('driver.selectPointSetPoint') }).count(),
        ).toStrictEqual(0);
        await page.locator('input[placeholder="x y"]').fill('12 13');
        await page.waitForFunction(() =>
          JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
            .correctPoints?.[0] === '12 13'
        );
        expect((await state()).correctPoints).toStrictEqual(['12 13']);
        await page.goto(`${baseUrl}&mode=finite`, { waitUntil: 'domcontentloaded' });
        await page.getByText(i18n.t('driver.selectPointCountOfLimit', { count: 0, limit: 2 }))
          .waitFor();
        await assertSafe();
        await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') }).click();
        await page.getByText(i18n.t('driver.selectPointCountOfLimit', { count: 1, limit: 2 }))
          .waitFor();
        await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') }).click();
        await page.getByText(i18n.t('driver.selectPointCountOfLimit', { count: 2, limit: 2 }))
          .waitFor();
        expect((await state()).correctPoints.length).toStrictEqual(2);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') })
            .isDisabled(),
        ).toStrictEqual(true);
        const editingPoint = page.locator('label').filter({
          hasText: i18n.t('driver.selectPointEditing'),
        })
          .locator('select');
        await editingPoint.selectOption('1');
        await page.locator('input[placeholder="x y"]').nth(1).fill('22 23');
        await page.waitForFunction(() =>
          JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
            .correctPoints?.[1] === '22 23'
        );
        expect((await state()).correctPoints).toStrictEqual(['', '22 23']);
        await page.getByRole('button', {
          name: i18n.t('driver.selectPointRemove', { number: 2 }),
        }).click();
        expect((await state()).correctPoints.length).toStrictEqual(1);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') })
            .isDisabled(),
        ).toStrictEqual(false);
        await assertSafe();
        await page.goto(`${baseUrl}&mode=unlimited`, { waitUntil: 'domcontentloaded' });
        await page.getByText(i18n.t('driver.selectPointCount', { count: 0 })).waitFor();
        await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') }).click();
        await page.getByText(i18n.t('driver.selectPointCount', { count: 1 })).waitFor();
        await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') }).click();
        await page.getByText(i18n.t('driver.selectPointCount', { count: 2 })).waitFor();
        await page.getByRole('button', {
          name: i18n.t('driver.selectPointRemove', { number: 1 }),
        }).click();
        await page.getByText(i18n.t('driver.selectPointCount', { count: 1 })).waitFor();
        expect((await state()).correctPoints.length).toStrictEqual(1);
        await assertSafe();
        await page.goto(`${baseUrl}&mode=targets`, { waitUntil: 'domcontentloaded' });
        await assertSafe();
        await page.getByRole('button', { name: `+ ${i18n.t('driver.selectPointAddTarget')}` })
          .click();
        const shapes = page.locator('label').filter({ hasText: i18n.t('driver.shape') }).locator(
          'select',
        );
        expect(
          await shapes.last().locator('option').evaluateAll((options) =>
            options.map((option) => ({
              value: option.getAttribute('value'),
              text: option.textContent,
            }))
          ),
        ).toStrictEqual([
          { value: 'circle', text: i18n.t('driver.circle') },
          { value: 'rect', text: i18n.t('driver.rectangle') },
          { value: 'poly', text: i18n.t('driver.polygon') },
          { value: 'default', text: i18n.t('driver.selectPointDefaultShape') },
        ]);
        await shapes.last().selectOption('default');
        const coords = page.locator('label').filter({ hasText: i18n.t('driver.coordinates') })
          .locator('input');
        await coords.last().fill('1,2,3,4');
        const mapped = page.locator('label').filter({
          hasText: i18n.t('driver.selectPointMappedValue'),
        }).locator('input');
        await mapped.last().fill('7');
        expect((await state()).targets[1]).toStrictEqual({
          shape: 'default',
          coords: '1,2,3,4',
          mappedValue: 7,
        });
        await page.getByRole('button', { name: i18n.t('driver.remove') }).last().click();
        expect((await state()).targets.length).toStrictEqual(1);
        await page.goto(`${baseUrl}&mode=canvas`, { waitUntil: 'domcontentloaded' });
        await assertSafe();
        const canvas = page.getByRole('button', {
          name: i18n.t('driver.selectPointPlace', { number: 1 }),
        });
        await page.waitForFunction(() => {
          const image = document.querySelector('img');
          return Boolean(image?.complete && image.naturalWidth > 0);
        });
        const imageBox = await page.locator('img').last().boundingBox();
        if (!imageBox) expect.unreachable('Expected imageBox');
        const beforeCanvas = await output().innerText();
        await page.mouse.click(
          imageBox.x + imageBox.width * 0.25,
          imageBox.y + imageBox.height * 0.25,
        );
        await page.waitForFunction(
          (before) => document.querySelector('[data-state=select-point]')?.textContent !== before,
          beforeCanvas,
        );
        expect((await state()).correctPoints[0]).toStrictEqual('25 25');
        await canvas.focus();
        await canvas.press('ArrowRight');
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
              .correctPoints?.[0] === '26 25',
        );
        await canvas.press('Shift+ArrowDown');
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
              .correctPoints?.[0] === '26 35',
        );
        await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') }).click();
        await page.getByRole('button', { name: i18n.t('driver.selectPointPlace', { number: 2 }) })
          .press('Enter');
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
              .correctPoints?.[1] === '50 50',
        );
        await page.getByRole('button', { name: i18n.t('driver.selectPointAddPoint') }).click();
        await page.getByRole('button', { name: i18n.t('driver.selectPointPlace', { number: 3 }) })
          .press('Space');
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
              .correctPoints?.[2] === '50 50',
        );
        expect((await state()).correctPoints).toStrictEqual(['26 35', '50 50', '50 50']);
        const activePoint = page.locator('label').filter({
          hasText: i18n.t('driver.selectPointEditing'),
        }).locator('select');
        await activePoint.selectOption('0');
        expect(await activePoint.inputValue()).toStrictEqual('0');
        expect((await state()).correctPoints).toStrictEqual(['26 35', '50 50', '50 50']);
        await activePoint.selectOption('1');
        const secondPoint = page.getByRole('button', {
          name: i18n.t('driver.selectPointPlace', { number: 2 }),
        });
        await page.locator('input[placeholder="x y"]').nth(1).fill('99 99');
        await secondPoint.focus();
        await secondPoint.press('Shift+ArrowRight');
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
              .correctPoints?.join('|') === '26 35|100 99|50 50',
        );
        expect((await state()).correctPoints).toStrictEqual(['26 35', '100 99', '50 50']);
        await secondPoint.press('Shift+ArrowDown');
        await page.waitForFunction(() =>
          JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
            .correctPoints?.join('|') === '26 35|100 100|50 50'
        );
        expect((await state()).correctPoints).toStrictEqual(['26 35', '100 100', '50 50']);
        await activePoint.selectOption('0');
        const firstPoint = page.getByRole('button', {
          name: i18n.t('driver.selectPointPlace', { number: 1 }),
        });
        await firstPoint.focus();
        await firstPoint.press('ArrowLeft');
        await page.waitForFunction(
          () =>
            JSON.parse(document.querySelector('[data-state=select-point]')?.textContent ?? '{}')
              .correctPoints?.join('|') === '25 35|100 100|50 50',
        );
        expect((await state()).correctPoints).toStrictEqual(['25 35', '100 100', '50 50']);
        const canvasDescribedBy = await firstPoint.getAttribute('aria-describedby');
        if (!canvasDescribedBy) expect.unreachable('Expected canvasDescribedBy');
        const instruction = page.locator(`#${canvasDescribedBy}`);
        expect(await instruction.count()).toStrictEqual(1);
        expect(await instruction.innerText()).toStrictEqual(
          i18n.t('driver.selectPointInstruction', {
            point: i18n.t('driver.selectPointIndexed', { number: 1 }),
          }),
        );
        expect(await safeText()).toContain(i18n.t('driver.selectPointInstruction', {
          point: i18n.t('driver.selectPointIndexed', { number: 1 }),
        }));
        await page.goto(`${baseUrl}&mode=no-image`, { waitUntil: 'domcontentloaded' });
        expect(await safeText()).toContain(i18n.t('driver.selectPointNoImage'));
        await assertSafe();
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
    if (server) await server.close();
    if (temp) await _fs.rm(temp, { recursive: true });
  }
});
