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

testCase('graphic order authoring interactions are localized in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.graphic-order-browser-'));
  const entry = `${temp}/entry.tsx`;
  const bundle = `${temp}/bundle.js`;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    await _fs.writeFile(
      entry,
      `
import {h, render} from "preact"; import {useState} from "preact/hooks";
import {I18nProvider} from "${process.cwd()}/lib/i18n/context.tsx";
import {GraphicOrderContent} from "${process.cwd()}/islands/drivers/graphic_order.tsx";
function App({config}) { const [s,setS]=useState(config.state); const [captures,setCaptures]=useState([]); const capture=(record)=>setCaptures(p=>[...p,record]); const patch=(f)=>setS(p=>({...p,...f(p)})); const spots=(f)=>patch(p=>({graphicOrderHotspots:f(p.graphicOrderHotspots)})); const order=(f)=>patch(p=>({graphicOrderCorrectOrder:f(p.graphicOrderCorrectOrder)})); return h(I18nProvider,{payload:config.payload},h('main',null,h(GraphicOrderContent,{promptHtml:'',background:s.background,graphicOrderResponseId:s.responseId,graphicOrderHotspots:s.graphicOrderHotspots,graphicOrderOrder:s.graphicOrderCorrectOrder,dragIndex:null,renderPromptField:(p)=>h('input',{placeholder:p}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,setPromptHtml:()=>{},setBackground:(background)=>patch(()=>({background})),setGraphicOrderResponseId:(responseId)=>patch(()=>({responseId})),addGraphicOrderHotspot:()=>{capture({type:'add',id:'C'});spots(p=>[...p,{id:'C',shape:'circle',coords:'60,60,10',label:''}]);},removeGraphicOrderHotspot:(id)=>{capture({type:'remove',id});spots(p=>p.filter(x=>x.id!==id));order(p=>p.filter(x=>x!==id));},updateGraphicOrderHotspotId:(id,next)=>{capture({type:'id',from:id,to:next});spots(p=>p.map(x=>x.id===id?({...x,id:next}):x));order(p=>p.map(x=>x===id?next:x));},updateGraphicOrderHotspotShape:(id,shape)=>{capture({type:'shape',id,shape});spots(p=>p.map(x=>x.id===id?({...x,shape}):x));},updateGraphicOrderHotspotCoords:()=>{},updateGraphicOrderHotspotLabel:(id,label)=>{capture({type:'label',id,label});spots(p=>p.map(x=>x.id===id?({...x,label}):x));},setGraphicOrderOrder:(v)=>patch(()=>({graphicOrderCorrectOrder:v})),setDragIndex:()=>{},reorderGraphicOrder:(from,to)=>{capture({type:'reorder',from,to});order(p=>{const n=[...p];const [x]=n.splice(from,1);n.splice(to,0,x);return n;});}}),h('output',{'data-state':'graphic-order'},JSON.stringify(s)),h('output',{'data-captures':'graphic-order'},JSON.stringify(captures)))); }
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
    const catalogSamples = locales.map((locale) =>
      createI18n(
        locale,
        createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
      ).t('driver.graphicOrderHotspotsHelp')
    );
    for (
      const marker of ['catalogForLocale', ...catalogSamples]
    ) {
      if (bundleText.includes(marker)) expect.unreachable(`bundle leaked ${marker}`);
    }
    const configs = new Map(
      locales.map((
        locale,
      ) => [locale, {
        payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
        state: {
          responseId: 'RESPONSE-Ω',
          background: {
            source: 'data:image/png;base64,TECH-SOURCE',
            alt: 'ALT-Ω漢字',
            longDescription: 'LONG-DESC-Ω',
            mimeType: 'image/png',
            width: 640,
            height: 480,
          },
          graphicOrderHotspots: [{
            id: 'HOTSPOT-A',
            shape: 'rect',
            coords: '10,20,30,40',
            label: 'LABEL-A',
          }, { id: 'HOTSPOT-B', shape: 'circle', coords: '50,60,7', label: 'LABEL-B' }],
          graphicOrderCorrectOrder: ['HOTSPOT-A', 'HOTSPOT-B'],
        },
      }]),
    );
    const json = (v: unknown) => JSON.stringify(v).replaceAll('<', '\\u003c');
    server = await startFetchServer((req) => {
      const u = new URL(req.url);
      if (u.pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const c = configs.get(u.searchParams.get('locale') as InterfaceLocale);
      return c
        ? new Response(
          `<!doctype html><html><body><div id="root"></div><script>globalThis.__CONFIG__=${
            json(c)
          }</script><script type="module" src="/bundle.js"></script></body></html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        )
        : new Response('bad', { status: 400 });
    });
    browser = await chromium.launch();
    const addr = new URL(server.origin);
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        await page.goto(`http://${addr.hostname}:${addr.port}/?locale=${locale}`);
        await page.getByText(i18n.t('driver.graphicOrderHotspots'), { exact: true }).waitFor();
        const out = page.locator('[data-state=graphic-order]');
        const state = async () => JSON.parse(await out.innerText());
        const body = page.locator('body');
        const text = async () => (await body.innerText()).replace(await out.innerText(), '');
        expect(JSON.parse(await page.locator('[data-captures=graphic-order]').innerText()))
          .toStrictEqual([]);
        expect((await state()).responseId).toStrictEqual('RESPONSE-Ω');
        expect((await state()).graphicOrderHotspots.map((x: { id: string }) => x.id)).toStrictEqual(
          [
            'HOTSPOT-A',
            'HOTSPOT-B',
          ],
        );
        expect((await state()).graphicOrderCorrectOrder).toStrictEqual(['HOTSPOT-A', 'HOTSPOT-B']);
        expect((await state()).background.source).toStrictEqual(
          'data:image/png;base64,TECH-SOURCE',
        );
        expect((await state()).graphicOrderHotspots).toStrictEqual([
          { id: 'HOTSPOT-A', shape: 'rect', coords: '10,20,30,40', label: 'LABEL-A' },
          { id: 'HOTSPOT-B', shape: 'circle', coords: '50,60,7', label: 'LABEL-B' },
        ]);
        const surfaceKeys = [
          'graphicOrderBackgroundSource',
          'graphicOrderBackgroundAlt',
          'graphicOrderBackgroundLongDescription',
          'graphicOrderBackgroundMimeType',
          'graphicOrderBackgroundWidth',
          'graphicOrderBackgroundHeight',
          'graphicOrderHotspots',
          'graphicOrderHotspotsHelp',
          'graphicOrderId',
          'shape',
          'graphicOrderCoords',
          'label',
          'graphicOrderHotspotEditor',
          'graphicOrderEditingHotspot',
          'graphicOrderCorrectOrder',
          'dragToReorder',
          'graphicOrderOrderHelp',
        ] as const;
        for (const key of surfaceKeys) {
          if (!((await text()).includes(i18n.t(`driver.${key}`)))) {
            expect.unreachable('Expected (await text()).includes(i18n.t(`driver.${key}`))');
          }
        }
        expect(
          await page.locator(`input[placeholder="${i18n.t('driver.graphicOrderPrompt')}"]`)
            .count(),
        ).toStrictEqual(1);
        if (!((await text()).includes(`+ ${i18n.t('driver.graphicOrderAddHotspot')}`))) {
          expect.unreachable(
            "Expected (await text()).includes(`+ ${i18n.t('driver.graphicOrderAddHotspot')}`)",
          );
        }
        const shapeRow = page.locator('input[placeholder="A"]').first().locator(
          'xpath=ancestor::div[contains(@class,"grid")][1]',
        );
        const shapeSelect = shapeRow.locator('select');
        for (
          const [value, key] of [
            ['rect', 'graphicOrderRect'],
            ['circle', 'circle'],
            ['poly', 'graphicOrderPoly'],
            ['ellipse', 'graphicOrderEllipse'],
            ['default', 'graphicOrderDefaultShape'],
          ] as const
        ) {
          expect(await shapeSelect.locator(`option[value="${value}"]`).count()).toStrictEqual(1);
          expect(await shapeSelect.locator(`option[value="${value}"]`).innerText()).toStrictEqual(
            i18n.t(`driver.${key}`),
          );
        }
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.graphicOrderEditHotspot', { number: 1 }),
          }).count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.graphicOrderRemoveHotspot', { number: 2 }),
          }).count(),
        ).toStrictEqual(1);
        expect((await state()).background.alt).toStrictEqual('ALT-Ω漢字');
        expect((await state()).background.longDescription).toStrictEqual('LONG-DESC-Ω');
        expect((await state()).background.mimeType).toStrictEqual('image/png');
        expect((await state()).background.width).toStrictEqual(640);
        expect((await state()).background.height).toStrictEqual(480);
        expect(await page.locator('input[placeholder="x,y,r"]').count()).toStrictEqual(1);
        expect(await page.locator('input[placeholder="x1,y1,x2,y2"]').count()).toStrictEqual(1);
        await page.locator('input[placeholder="A"]').nth(1).fill('AUTHORED-ID-Ω');
        await page.locator(
          `input[placeholder="${i18n.t('driver.graphicOrderLabelPlaceholder')}"]`,
        ).nth(1).fill('AUTHORED-LABEL-Ω');
        await page.getByRole('button', {
          name: i18n.t('driver.graphicOrderEditHotspot', { number: 2 }),
        }).nth(0).click();
        expect(await page.locator('select').last().inputValue()).toStrictEqual('AUTHORED-ID-Ω');
        if (locale === 'es-ES' || locale === 'es-419') {
          const en = createI18n(
            'en-US',
            createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']).namespaces,
          );
          for (const key of surfaceKeys) {
            const english = en.t(`driver.${key}`);
            if (english !== i18n.t(`driver.${key}`)) {
              if ((await text()).split('\n').includes(english)) {
                expect.unreachable("Expected !(await text()).split('\\n').includes(english)");
              }
            }
          }
          for (const key of ['graphicOrderAddHotspot', 'edit', 'removeChoice'] as const) {
            const english = en.t(`driver.${key}`);
            if (english !== i18n.t(`driver.${key}`)) {
              if ((await text()).split('\n').includes(english)) {
                expect.unreachable("Expected !(await text()).split('\\n').includes(english)");
              }
            }
          }
          expect(
            await page.getByRole('button', {
              name: en.t('driver.graphicOrderEditHotspot', { number: 1 }),
            }).count(),
          ).toStrictEqual(0);
          expect(
            await page.getByRole('button', {
              name: en.t('driver.graphicOrderRemoveHotspot', { number: 1 }),
            }).count(),
          ).toStrictEqual(0);
          expect(
            await page.locator(`input[placeholder="${en.t('driver.graphicOrderPrompt')}"]`)
              .count(),
          ).toStrictEqual(0);
          expect(
            await page.locator(
              `input[placeholder="${en.t('driver.graphicOrderLabelPlaceholder')}"]`,
            ).count(),
          ).toStrictEqual(0);
          for (
            const key of [
              'graphicOrderRect',
              'circle',
              'graphicOrderPoly',
              'graphicOrderEllipse',
              'graphicOrderDefaultShape',
            ] as const
          ) {
            const english = en.t(`driver.${key}`);
            if (english !== i18n.t(`driver.${key}`)) {
              expect(await shapeSelect.getByText(english, { exact: true }).count()).toStrictEqual(
                0,
              );
            }
          }
          for (
            const p of [
              'Background image',
              'Add hotspot',
              'Shape',
              'Coords',
              'Edit hotspot',
              'Remove hotspot',
              'Correct order',
            ]
          ) {
            if ((await text()).includes(p)) {
              expect.unreachable('Expected !(await text()).includes(p)');
            }
          }
        }
        await page.locator('input[placeholder="A"]').first().locator(
          'xpath=ancestor::div[contains(@class,"grid")][1]',
        ).locator('select').selectOption('poly');
        expect((await state()).graphicOrderHotspots[0].shape).toStrictEqual('poly');
        const add = page.getByRole('button', {
          name: `+ ${i18n.t('driver.graphicOrderAddHotspot')}`,
        });
        await add.click();
        await page.getByRole('button', {
          name: i18n.t('driver.graphicOrderRemoveHotspot', { number: 3 }),
        }).click();
        if (
          !((await state()).graphicOrderHotspots.some((x: { id: string }) =>
            x.id === 'AUTHORED-ID-Ω'
          ))
        ) {
          expect.unreachable(
            "Expected (await state()).graphicOrderHotspots.some((x: { id: string }) => x.id === 'AUTHORED-ID-Ω' ",
          );
        }
        await page.locator('[tabindex="0"]').last().focus();
        await page.keyboard.press('Alt+ArrowUp');
        await page.waitForTimeout(20);
        expect((await state()).graphicOrderCorrectOrder).toStrictEqual([
          'AUTHORED-ID-Ω',
          'HOTSPOT-A',
        ]);
        expect((await state()).graphicOrderHotspots).toStrictEqual([
          {
            id: 'HOTSPOT-A',
            shape: 'poly',
            coords: '10,20,30,40',
            label: 'LABEL-A',
          },
          { id: 'AUTHORED-ID-Ω', shape: 'circle', coords: '50,60,7', label: 'AUTHORED-LABEL-Ω' },
        ]);
        const captures = JSON.parse(
          await page.locator('[data-captures=graphic-order]').innerText(),
        );
        expect(captures).toStrictEqual([
          { type: 'id', from: 'HOTSPOT-B', to: 'AUTHORED-ID-Ω' },
          { type: 'label', id: 'AUTHORED-ID-Ω', label: 'AUTHORED-LABEL-Ω' },
          { type: 'shape', id: 'HOTSPOT-A', shape: 'poly' },
          { type: 'add', id: 'C' },
          { type: 'remove', id: 'C' },
          { type: 'reorder', from: 1, to: 0 },
        ]);
        expect(captures[0].to).toStrictEqual('AUTHORED-ID-Ω');
        expect(captures[1].label).toStrictEqual('AUTHORED-LABEL-Ω');
        expect(captures[2].shape).toStrictEqual('poly');
        expect(captures[4].id).toStrictEqual('C');
        expect(captures[5].from).toStrictEqual(1);
        expect(captures[5].to).toStrictEqual(0);
        if ((await text()).includes('driver.')) {
          expect.unreachable("Expected !(await text()).includes('driver.')");
        }
        if ((await text()).match(/\{(?:count|plural|select)(?:[,}])/)) {
          expect.unreachable(
            'Expected !(await text()).match(/\\{(?:count|plural|select)(?:[,}])/)',
          );
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    await _fs.rm(temp, { recursive: true });
  }
});
