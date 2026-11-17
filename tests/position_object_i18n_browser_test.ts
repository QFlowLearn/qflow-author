import { expect, test as testCase } from 'vitest';

import { type FetchFixtureServer, startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { Buffer } from 'node:buffer';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('position-object authoring interactions work in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.position-object-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { PositionObjectContent } from "${process.cwd()}/islands/drivers/position_object.tsx";
function App({config}) {
  const [state, setState] = useState(config.state);
  const update = (fn) => setState((prev) => ({...prev, ...fn(prev)}));
  return h(I18nProvider, {payload: config.payload}, h('main', null,
    h(PositionObjectContent, {
      responseIdentifier: state.responseIdentifier,
      stageImage: state.stageImage, objectImage: state.objectImage,
      centerPoint: state.centerPoint, targets: state.targets,
      correctPoints: state.correctPoints,
      renderPromptField: (placeholder) => h('input', {'data-testid':'prompt', placeholder}),
      fieldHasIssue: () => false, fieldIssueText: () => undefined,
      setResponseIdentifier: (value) => update(() => ({responseIdentifier:value})),
      setStageImage: (value) => update(() => ({stageImage:value})),
      setObjectImage: (value) => update(() => ({objectImage:value})),
      setCenterPoint: (value) => update(() => ({centerPoint:value})),
      addTarget: () => update((prev) => ({targets:[...prev.targets, {shape:'circle',coords:'120,120,12',mappedValue:1}]})),
      removeTarget: (index) => update((prev) => ({targets:prev.targets.filter((_,i) => i !== index)})),
      updateTargetShape: (index, shape) => update((prev) => ({targets:prev.targets.map((t,i) => i === index ? {...t,shape} : t)})),
      updateTargetCoords: (index, coords) => update((prev) => ({targets:prev.targets.map((t,i) => i === index ? {...t,coords} : t)})),
      updateTargetMappedValue: (index, mappedValue) => update((prev) => ({targets:prev.targets.map((t,i) => i === index ? {...t,mappedValue} : t)})),
      addCorrectPoint: () => update((prev) => ({correctPoints:[...prev.correctPoints,'']})),
      removeCorrectPoint: (index) => update((prev) => ({correctPoints:prev.correctPoints.filter((_,i) => i !== index)})),
      updateCorrectPoint: (index, value) => update((prev) => ({correctPoints:prev.correctPoints.map((p,i) => i === index ? value : p)})),
    }), h('output', {'data-state':'position-object'}, JSON.stringify(state))
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
      state: {
        responseIdentifier: 'RESPONSE_Ω',
        stageImage: {
          source:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="90" height="90"/%3E',
          alt: '<img data-position-stage-injection src=x>stage ALT Ω漢字',
          longDescription: 'STAGE-LONG-Ω',
          mimeType: 'image/svg+xml',
          width: 640,
          height: 360,
        },
        objectImage: {
          source:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/%3E',
          alt: '<img data-position-object-injection src=x>OBJECT-ALT-Ω',
          mimeType: 'image/png',
          width: 32,
          height: 24,
        },
        centerPoint: '16 12',
        targets: [],
        correctPoints: [],
      },
    }]));
    const uploadedStageUrl =
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="101" height="101"/%3E';
    const uploadedObjectUrl =
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="202" height="202"/%3E';
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
      if (!config) return new Response('Unsupported locale', { status: 400 });
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
      page.on('pageerror', (e) => pageErrors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        let uploadCount = 0;
        await page.route('**/api/uploads', (route) => {
          uploadCount += 1;
          const uploadedUrl = uploadCount === 1 ? uploadedStageUrl : uploadedObjectUrl;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'uploaded-position-image',
              name: 'position.svg',
              type: 'image/svg+xml',
              size: 42,
              url: uploadedUrl,
              createdAt: '2026-01-01T00:00:00.000Z',
            }),
          });
        });
        const url = `http://${address.hostname}:${address.port}/?locale=${locale}`;
        const output = page.locator('[data-state=position-object]');
        const state = async () => JSON.parse(await output.innerText());
        const visible = async () =>
          (await page.locator('body').innerText()).replace(await output.innerText(), '');
        const assertSafe = async () => {
          const text = await visible();
          if (text.includes('driver.')) {
            expect.unreachable("Expected !text.includes('driver.')");
          }
          if (text.includes('editor.')) {
            expect.unreachable("Expected !text.includes('editor.')");
          }
          if (/\{(?:count|plural|select)(?:[,}])/.test(text)) {
            expect.unreachable('Expected !/\\{(?:count|plural|select)(?:[,}])/.test(text)');
          }
          expect(
            await page.evaluate(() => (globalThis as { __UNHANDLED__?: unknown[] }).__UNHANDLED__),
          ).toStrictEqual([]);
          if (locale === 'es-ES' || locale === 'es-419') {
            for (
              const phrase of [
                'Stage image',
                'Draggable object',
                'Stage image source',
                'Object image source',
                'Stage alt text',
                'Object alt text',
                'Describe the stage',
                'Describe the draggable object',
                'Stage long description',
                'Object MIME type',
                'Stage MIME type',
                'Stage width',
                'Stage height',
                'Object width',
                'Object height',
                'Object center point',
                'Target areas',
                'Add target',
                'Shape',
                'Coordinates',
                'Coords',
                'Mapped value',
                'Remove',
                '>Circle<',
                '>Rect<',
                '>Poly<',
                '>Default<',
                'Correct points',
                'Add point',
                'Add point values',
                'Remove point 1',
                'Remove point 2',
                'Remove point',
              ]
            ) if (text.includes(phrase)) expect.unreachable('Expected !text.includes(phrase)');
          }
        };
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.getByText(i18n.t('driver.positionObjectTargets'), { exact: true }).waitFor();
        expect(await visible()).toContain(i18n.t('driver.positionObjectStageImage'));
        expect(await visible()).toContain(i18n.t('driver.positionObjectObjectImage'));
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        expect((await state()).stageImage.source).toStrictEqual(
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="90" height="90"/%3E',
        );
        expect((await state()).stageImage.alt).toStrictEqual(
          '<img data-position-stage-injection src=x>stage ALT Ω漢字',
        );
        const svgFile = {
          name: 'position.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
          ),
        };
        const fileInputs = page.locator('input[type="file"]');
        await fileInputs.nth(0).setInputFiles(svgFile);
        await page.waitForFunction((expected) => {
          const state = JSON.parse(
            document.querySelector('[data-state=position-object]')?.textContent ?? '{}',
          );
          return state.stageImage.source === expected;
        }, uploadedStageUrl);
        await fileInputs.nth(1).setInputFiles(svgFile);
        await page.waitForFunction((expected) => {
          const state = JSON.parse(
            document.querySelector('[data-state=position-object]')?.textContent ?? '{}',
          );
          return state.stageImage.source === expected.stage &&
            state.objectImage.source === expected.object;
        }, { stage: uploadedStageUrl, object: uploadedObjectUrl });
        expect(uploadCount).toStrictEqual(2);
        const field = (label: string) =>
          page.locator('label').filter({ hasText: label }).locator('input,textarea').last();
        await field(i18n.t('driver.positionObjectStageAlt')).fill(
          '<img data-position-stage-injection src=x>stage EDITED ALT Ω>',
        );
        await field(i18n.t('driver.positionObjectStageLongDescription')).fill(
          'STAGE-EDITED-LONG-Ω',
        );
        await field(i18n.t('driver.positionObjectStageMimeType')).fill('image/webp');
        await field(i18n.t('driver.positionObjectStageWidth')).fill('800');
        await field(i18n.t('driver.positionObjectStageHeight')).fill('600');
        await field(i18n.t('driver.positionObjectObjectAlt')).fill(
          '<img data-position-object-injection src=x>object EDITED ALT Ω>',
        );
        await field(i18n.t('driver.positionObjectObjectMimeType')).fill('image/avif');
        await field(i18n.t('driver.positionObjectObjectWidth')).fill('48');
        await field(i18n.t('driver.positionObjectObjectHeight')).fill('36');
        await field(i18n.t('driver.positionObjectCenterPoint')).fill('24 18');
        await page.waitForFunction(() => {
          const raw = document.querySelector('[data-state=position-object]')?.textContent ?? '{}';
          const state = JSON.parse(raw);
          return state.centerPoint === '24 18' && state.stageImage.width === 800 &&
            state.objectImage.height === 36;
        });
        expect((await state()).stageImage).toStrictEqual({
          source: uploadedStageUrl,
          alt: '<img data-position-stage-injection src=x>stage EDITED ALT Ω>',
          longDescription: 'STAGE-EDITED-LONG-Ω',
          mimeType: 'image/webp',
          width: 800,
          height: 600,
        });
        expect((await state()).objectImage).toStrictEqual({
          source: uploadedObjectUrl,
          alt: '<img data-position-object-injection src=x>object EDITED ALT Ω>',
          mimeType: 'image/avif',
          width: 48,
          height: 36,
        });
        expect((await state()).centerPoint).toStrictEqual('24 18');
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        expect(await page.locator('[data-position-stage-injection]').count()).toStrictEqual(0);
        expect(await page.locator('[data-position-object-injection]').count()).toStrictEqual(0);
        await assertSafe();
        await page.getByRole('button', { name: `+ ${i18n.t('driver.positionObjectAddTarget')}` })
          .click();
        const shape = page.locator('label').filter({ hasText: i18n.t('driver.shape') }).locator(
          'select',
        ).last();
        expect(
          await shape.locator('option').evaluateAll((opts) =>
            opts.map((o) => ({ value: o.getAttribute('value'), text: o.textContent }))
          ),
        ).toStrictEqual([
          { value: 'circle', text: i18n.t('driver.circle') },
          { value: 'rect', text: i18n.t('driver.rectangle') },
          { value: 'poly', text: i18n.t('driver.polygon') },
          { value: 'default', text: i18n.t('driver.positionObjectDefaultShape') },
        ]);
        await shape.selectOption('default');
        await page.locator('label').filter({ hasText: i18n.t('driver.positionObjectCoords') })
          .locator('input').last().fill('1,2,3,4');
        await page.locator('label').filter({
          hasText: i18n.t('driver.positionObjectMappedValue'),
        }).locator('input').last().fill('7');
        expect((await state()).targets).toStrictEqual([{
          shape: 'default',
          coords: '1,2,3,4',
          mappedValue: 7,
        }]);
        await page.getByRole('button', { name: i18n.t('driver.remove') }).last().click();
        expect((await state()).targets).toStrictEqual([]);
        await page.getByRole('button', {
          name: `+ ${i18n.t('driver.positionObjectAddCorrectPoint')}`,
        }).click();
        await page.getByRole('button', {
          name: `+ ${i18n.t('driver.positionObjectAddCorrectPoint')}`,
        }).click();
        const pointInputs = page.locator('input[placeholder="x y"]');
        const pointInputCount = await pointInputs.count();
        await pointInputs.nth(pointInputCount - 2).fill('118 184');
        await pointInputs.nth(pointInputCount - 1).fill('240 130');
        expect((await state()).correctPoints).toStrictEqual(['118 184', '240 130']);
        await page.getByRole('button', {
          name: i18n.t('driver.positionObjectRemovePoint', { number: 2 }),
        }).click();
        expect((await state()).correctPoints).toStrictEqual(['118 184']);
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        await assertSafe();
        expect(pageErrors).toStrictEqual([]);
        expect(consoleErrors).toStrictEqual([]);
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
