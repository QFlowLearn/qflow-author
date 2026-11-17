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
testCase('slider authoring state is localized in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.slider-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import {h, render} from "preact"; import {useState} from "preact/hooks";
import {I18nProvider} from "${process.cwd()}/lib/i18n/context.tsx"; import {SliderContent} from "${process.cwd()}/islands/drivers/slider.tsx";
function App({config}) { const [s,setS]=useState(config.state); const patch=(p)=>setS(x=>({...x,...p})); const updateMap=(i,p)=>patch({mappings:s.mappings.map((m,j)=>j===i?({...m,...p}):m)}); return h(I18nProvider,{payload:config.payload},h('main',null,h(SliderContent,{responseIdentifier:s.responseIdentifier,lowerBound:s.lowerBound,upperBound:s.upperBound,step:s.step,orientation:s.orientation,correctValue:s.correctValue,mappings:s.mappings,renderPromptField:(p)=>h('input',{placeholder:p}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,setResponseIdentifier:(v)=>patch({responseIdentifier:v}),setLowerBound:(v)=>patch({lowerBound:v}),setUpperBound:(v)=>patch({upperBound:v}),setStep:(v)=>patch({step:v}),setOrientation:(v)=>patch({orientation:v}),setCorrectValue:(v)=>patch({correctValue:v}),addMapping:()=>patch({mappings:[...s.mappings,{mapKey:s.correctValue??0,mappedValue:1}]}),removeMapping:(i)=>patch({mappings:s.mappings.filter((_,j)=>j!==i)}),updateMappingKey:(i,v)=>updateMap(i,{mapKey:v??0}),updateMappingValue:(i,v)=>updateMap(i,{mappedValue:v??0})}),h('output',{'data-state':'slider'},JSON.stringify(s)))); }
globalThis.mount=(c)=>render(h(App,{config:c}),document.getElementById('root')); globalThis.mount(globalThis.__CONFIG__);
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
    if (bundleText.includes('lib/i18n/messages/')) {
      expect.unreachable("Expected !bundleText.includes('lib/i18n/messages/')");
    }
    const configs = new Map(locales.map((locale) => [locale, {
      payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      state: {
        responseIdentifier: 'RESPONSE_Ω',
        lowerBound: 0,
        upperBound: 100,
        step: 1,
        orientation: 'horizontal',
        correctValue: 50,
        mappings: [{ mapKey: 10, mappedValue: -2 }, { mapKey: 20, mappedValue: 0 }],
      },
    }]));
    const json = (v: unknown) => JSON.stringify(v).replaceAll('<', '\\u003c');
    server = await startFetchServer((req) => {
      const u = new URL(req.url);
      if (u.pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const c = configs.get(u.searchParams.get('locale') as InterfaceLocale);
      if (!c) return new Response('bad', { status: 400 });
      return new Response(
        `<!doctype html><html lang="${
          u.searchParams.get('locale')
        }"><body><div id="root"></div><script>globalThis.__UNHANDLED__=[];addEventListener('unhandledrejection',e=>globalThis.__UNHANDLED__.push(String(e.reason??'unhandled')));globalThis.__CONFIG__=${
          json(c)
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    browser = await chromium.launch();
    const a = new URL(server.origin);
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      const pe: string[] = [];
      const ce: string[] = [];
      page.on('pageerror', (e) => pe.push(e.message));
      page.on('console', (m) => m.type() === 'error' && ce.push(m.text()));
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        await page.goto(`http://${a.hostname}:${a.port}/?locale=${locale}`, {
          waitUntil: 'domcontentloaded',
        });
        const out = page.locator('[data-state=slider]');
        const state = async () => JSON.parse(await out.innerText());
        const visible = async () =>
          (await page.locator('body').innerText()).replace(await out.innerText(), '');
        await page.getByText(i18n.t('driver.sliderMappings'), { exact: true }).waitFor();
        expect(await state()).toStrictEqual({
          responseIdentifier: 'RESPONSE_Ω',
          lowerBound: 0,
          upperBound: 100,
          step: 1,
          orientation: 'horizontal',
          correctValue: 50,
          mappings: [{ mapKey: 10, mappedValue: -2 }, { mapKey: 20, mappedValue: 0 }],
        });
        expect(
          await page.locator('input[placeholder="' + i18n.t('driver.sliderPrompt') + '"]')
            .count(),
        ).toStrictEqual(1);
        for (
          const key of [
            'sliderLowerBound',
            'sliderUpperBound',
            'sliderStep',
            'sliderOrientation',
            'sliderCorrectValue',
            'sliderMappings',
            'sliderMapKey',
            'sliderMappedValue',
          ] as const
        ) {
          expect(
            await page.getByText(i18n.t(`driver.${key}`), { exact: true }).count(),
            `missing ${key}`,
          ).toStrictEqual(key === 'sliderMapKey' || key === 'sliderMappedValue' ? 2 : 1);
        }
        expect(
          await page.getByRole('button', { name: `+ ${i18n.t('driver.sliderAddMapping')}` })
            .count(),
        ).toStrictEqual(1);
        expect(
          await page.locator('select option').evaluateAll((options) =>
            options.map((option) => {
              const optionElement = option as HTMLOptionElement;
              return { value: optionElement.value, text: optionElement.textContent };
            })
          ),
        ).toStrictEqual([
          { value: 'horizontal', text: i18n.t('driver.sliderHorizontal') },
          { value: 'vertical', text: i18n.t('driver.sliderVertical') },
        ]);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.sliderRemoveMapping', { number: 1 }),
          }).count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.sliderRemoveMapping', { number: 2 }),
          }).count(),
        ).toStrictEqual(1);
        const assertSafe = async () => {
          const t = await visible();
          const current = await state();
          if (!(!t.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(t))) {
            expect.unreachable(
              "Expected !t.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(t)",
            );
          }
          if (locale === 'es-ES' || locale === 'es-419') {
            for (
              const p of [
                'Drag the slider',
                'Lower bound',
                'Upper bound',
                'Step',
                'Orientation',
                'Correct value',
                'Mapping entries',
                'Add mapping',
                'Add map entries',
                'Map key',
                'Mapped value',
                'Remove mapping',
              ]
            ) if (t.includes(p)) expect.unreachable('Expected !t.includes(p)');
          }
          expect(
            await page.locator(`input[placeholder="${i18n.t('driver.sliderMapKeyPlaceholder')}"]`)
              .count(),
          ).toStrictEqual(current.mappings.length);
          expect(
            await page.locator(
              `input[placeholder="${i18n.t('driver.sliderMappedValuePlaceholder')}"]`,
            ).count(),
          ).toStrictEqual(current.mappings.length);
          expect(await page.getByText(i18n.t('driver.remove'), { exact: true }).count())
            .toStrictEqual(current.mappings.length);
          expect(pe).toStrictEqual([]);
          expect(ce).toStrictEqual([]);
          expect(
            await page.evaluate(() =>
              (globalThis as unknown as { __UNHANDLED__: unknown[] }).__UNHANDLED__
            ),
          ).toStrictEqual([]);
        };
        await assertSafe();
        const field = (label: string) =>
          page.locator('label').filter({ hasText: label }).locator('input,select');
        await field(i18n.t('driver.sliderLowerBound')).fill('-5');
        await field(i18n.t('driver.sliderUpperBound')).fill('250');
        await field(i18n.t('driver.sliderStep')).fill('0');
        await field(i18n.t('driver.sliderOrientation')).selectOption('vertical');
        await field(i18n.t('driver.sliderCorrectValue')).fill('0');
        let s = await state();
        expect(s.lowerBound).toStrictEqual(-5);
        expect(s.upperBound).toStrictEqual(250);
        expect(s.step).toStrictEqual(0);
        expect(s.orientation).toStrictEqual('vertical');
        expect(s.correctValue).toStrictEqual(0);
        await field(i18n.t('driver.sliderLowerBound')).fill('');
        await field(i18n.t('driver.sliderUpperBound')).fill('');
        await field(i18n.t('driver.sliderStep')).fill('');
        await field(i18n.t('driver.sliderCorrectValue')).fill('');
        s = await state();
        expect(s.lowerBound).toStrictEqual(undefined);
        expect(s.upperBound).toStrictEqual(undefined);
        expect(s.step).toStrictEqual(undefined);
        expect(s.correctValue).toStrictEqual(undefined);
        expect(s.responseIdentifier).toStrictEqual('RESPONSE_Ω');
        await field(i18n.t('driver.sliderLowerBound')).fill('-5');
        await field(i18n.t('driver.sliderUpperBound')).fill('250');
        await field(i18n.t('driver.sliderStep')).fill('0');
        await field(i18n.t('driver.sliderCorrectValue')).fill('0');
        await field(i18n.t('driver.sliderMapKey')).nth(0).fill('11');
        await field(i18n.t('driver.sliderMapKey')).nth(1).fill('');
        await field(i18n.t('driver.sliderMappedValue')).nth(0).fill('-7');
        await field(i18n.t('driver.sliderMappedValue')).nth(1).fill('');
        s = await state();
        expect(s.mappings).toStrictEqual([
          { mapKey: 11, mappedValue: -7 },
          { mapKey: 0, mappedValue: 0 },
        ]);
        await field(i18n.t('driver.sliderMapKey')).nth(1).fill('22');
        await page.getByRole('button', {
          name: i18n.t('driver.sliderRemoveMapping', { number: 1 }),
        }).click();
        s = await state();
        expect(s.mappings).toStrictEqual([{ mapKey: 22, mappedValue: 0 }]);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.sliderRemoveMapping', { number: 1 }),
          }).count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.sliderRemoveMapping', { number: 2 }),
          }).count(),
        ).toStrictEqual(0);
        await page.getByRole('button', { name: `+ ${i18n.t('driver.sliderAddMapping')}` })
          .click();
        s = await state();
        expect(s.mappings).toStrictEqual([
          { mapKey: 22, mappedValue: 0 },
          { mapKey: 0, mappedValue: 1 },
        ]);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.sliderRemoveMapping', { number: 1 }),
          }).count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.sliderRemoveMapping', { number: 2 }),
          }).count(),
        ).toStrictEqual(1);
        expect(s.responseIdentifier).toStrictEqual('RESPONSE_Ω');
        await assertSafe();
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
