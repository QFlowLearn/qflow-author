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
const hotspots = [
  { id: 'ZONE-A', shape: 'circle', coords: '120,90,18', matchMax: 2 },
  { id: 'ZONE-B', shape: 'rect', coords: '10,20,30,40', matchMax: 2 },
  { id: 'ZONE-C', shape: 'poly', coords: '1,2,3,4,5,6', matchMax: 2 },
];

testCase('Graphic Associate browser UI localizes and preserves interaction contracts', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.graphic-associate-browser-'));
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { GraphicAssociateContent } from "${process.cwd()}/islands/drivers/graphic_associate.tsx";
function App({config}) {
  const [s,setS] = useState(config.state);
  const [captures,setCaptures] = useState([]);
  const patch = p => setS(x => ({...x,...p}));
  const hotspots = v => setS(x => ({...x, hotspots: typeof v === 'function' ? v(x.hotspots) : v}));
  const pairs = v => setS(x => ({...x, pairs: typeof v === 'function' ? v(x.pairs) : v}));
  const cap = (name,value) => setCaptures(x => [...x, {name,value}]);
  return h(I18nProvider,{payload:config.payload},h('main',null,h(GraphicAssociateContent,{
    promptHtml:'<p>AUTHORED-PROMPT-Ω</p>', background:s.background, graphicAssociateResponseId:'RESPONSE-ID', graphicAssociateHotspots:s.hotspots, graphicAssociateCorrectPairs:s.pairs, maxAssociations:s.maxAssociations,
    renderPromptField:p=>h('input',{placeholder:p}), fieldHasIssue:()=>false, fieldIssueText:()=>undefined,
    setPromptHtml:()=>{}, setBackground:v=>patch({background:v}), setGraphicAssociateResponseId:()=>{},
    addGraphicAssociateHotspot:()=>{hotspots(x=>[...x,{id:'D',shape:'circle',coords:'50,50,10',matchMax:2}]);cap('add-hotspot','D')},
    removeGraphicAssociateHotspot:id=>{hotspots(x=>x.filter(h=>h.id!==id));pairs(x=>x.filter(p=>p.sourceId!==id&&p.targetId!==id));cap('remove-hotspot',id)},
    updateGraphicAssociateHotspotId:(id,v)=>{hotspots(x=>x.map(h=>h.id===id?{...h,id:v}:h));pairs(x=>x.map(p=>p.sourceId===id?{...p,sourceId:v}:p.targetId===id?{...p,targetId:v}:p));cap('hotspot-id',v)},
    updateGraphicAssociateHotspotShape:(id,v)=>{hotspots(x=>x.map(h=>h.id===id?{...h,shape:v}:h));cap('shape',v)},
    updateGraphicAssociateHotspotCoords:(id,v)=>hotspots(x=>x.map(h=>h.id===id?{...h,coords:v}:h)),
    updateGraphicAssociateHotspotMatchMax:(id,v)=>{hotspots(x=>x.map(h=>h.id===id?{...h,matchMax:v}:h));cap('match-max',v)},
    setGraphicAssociatePairs:v=>{pairs(v);cap('pair',v)},
  }),h('output',{'data-state':true},JSON.stringify(s)),h('output',{'data-captures':true},JSON.stringify(captures))));
}
globalThis.mount=c=>render(h(App,{config:c}),document.getElementById('root')); globalThis.mount(globalThis.__CONFIG__);
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
      const marker of [
        'catalogForLocale',
        'lib/i18n/catalogs.ts',
        'playerMessageCatalogForLocale',
      ]
    ) {
      if (bundleText.includes(marker)) {
        expect.unreachable('Expected !bundleText.includes(marker)');
      }
    }
    for (const locale of locales) {
      const sample = createI18n(
        locale,
        createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
      ).t('driver.graphicAssociatePrompt');
      if (bundleText.includes(sample)) {
        expect.unreachable('Expected !bundleText.includes(sample)');
      }
    }
    const configs = new Map(locales.map((locale) => [locale, {
      payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      state: {
        background: {
          source: 'data:image/png;base64,TECHNICAL-SOURCE',
          alt: 'AUTHORED-ALT-漢字',
          longDescription: 'AUTHORED-DESC',
          mimeType: 'image/png',
          width: 640,
          height: 480,
        },
        hotspots,
        pairs: [{ sourceId: 'ZONE-A', targetId: 'ZONE-B' }],
        maxAssociations: 3,
      },
    }]));
    const json = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
    server = await startFetchServer((request) => {
      const url = new URL(request.url);
      const config = configs.get(url.searchParams.get('locale') as InterfaceLocale);
      if (url.pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      if (!config) return new Response('bad locale', { status: 400 });
      return new Response(
        `<!doctype html><html lang="${
          url.searchParams.get('locale')
        }"><body><div id="root"></div><script>globalThis.__CONFIG__=${
          json(config)
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    browser = await chromium.launch();
    const address = new URL(server.origin);
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.getByText(i18n.t('driver.graphicAssociateHotspots'), { exact: true })
          .waitFor();
        const body = page.locator('body');
        const text = await body.innerText();
        expect(JSON.parse(await page.locator('[data-captures]').innerText())).toStrictEqual([]);
        expect(JSON.parse(await page.locator('[data-state]').innerText())).toStrictEqual({
          background: {
            source: 'data:image/png;base64,TECHNICAL-SOURCE',
            alt: 'AUTHORED-ALT-漢字',
            longDescription: 'AUTHORED-DESC',
            mimeType: 'image/png',
            width: 640,
            height: 480,
          },
          hotspots,
          pairs: [{ sourceId: 'ZONE-A', targetId: 'ZONE-B' }],
          maxAssociations: 3,
        });
        expect(await page.getByPlaceholder(i18n.t('driver.graphicAssociatePrompt')).count())
          .toStrictEqual(1);
        for (
          const key of [
            'graphicAssociateBackgroundSource',
            'graphicAssociateBackgroundAlt',
            'graphicAssociateHotspots',
            'graphicAssociateAddHotspot',
            'graphicAssociateHotspotsHelp',
            'graphicAssociateId',
            'graphicAssociateShape',
            'graphicAssociateCoords',
            'graphicAssociateMaxLinks',
            'graphicAssociateHotspotEditor',
            'graphicAssociateEditingHotspot',
            'graphicAssociateCorrectPairs',
            'graphicAssociateUnorderedPairHelp',
          ] as const
        ) expect(text).toContain(i18n.t(`driver.${key}`, { id: 'ZONE-A' }));
        expect(text).toContain('AUTHORED-ALT-漢字');
        expect(text).toContain('AUTHORED-DESC');
        expect(text).toContain('TECHNICAL-SOURCE');
        expect(text).toContain('120,90,18');
        expect(await page.locator('[data-state]').innerText()).toContain('"matchMax":2');
        expect(
          await page.getByRole('checkbox', {
            name: i18n.t('driver.pairLabel', { source: 'ZONE-A', target: 'ZONE-B' }),
            exact: true,
          }).count(),
        ).toStrictEqual(1);
        if (!(!text.includes('driver.') && !/\{(?:count|plural|select)[^}]*\}/.test(text))) {
          expect.unreachable(
            "Expected !text.includes('driver.') && !/\\{(?:count|plural|select)[^}]*\\}/.test(text)",
          );
        }
        if (locale === 'es-ES' || locale === 'es-419') {
          for (
            const phrase of [
              'Background image',
              'Background alt text',
              'Background long description',
              'Background MIME type',
              'Background width',
              'Background height',
              'Add hotspot',
              'Define hotspot shapes visually below',
              'Shape',
              'Coords',
              'Max links',
              'Maximum links for hotspot',
              'Hotspot editor',
              'Editing hotspot',
              'Correct pairs',
              'Pairing is unordered',
            ]
          ) if (text.includes(phrase)) expect.unreachable('Expected !text.includes(phrase)');
          if (text.split('\n').some((line) => line === 'Edit' || line === 'Remove')) {
            expect.unreachable(
              "Expected !text.split('\\n').some((line) => line === 'Edit' || line === 'Remove')",
            );
          }
        }
        await page.getByRole('button', {
          name: `+ ${i18n.t('driver.graphicAssociateAddHotspot')}`,
          exact: true,
        }).click();
        const pair = page.getByRole('checkbox', {
          name: i18n.t('driver.pairLabel', { source: 'ZONE-A', target: 'ZONE-C' }),
          exact: true,
        });
        await pair.check();
        expect(await page.locator('[data-captures]').innerText()).toContain('"name":"pair"');
        await page.getByText(i18n.t('driver.graphicAssociateShape'), { exact: true }).first()
          .locator('..').locator('select').selectOption('rect');
        await page.locator(
          'input[aria-label="' + i18n.t('driver.graphicAssociateMaximumLinks', { id: 'ZONE-A' }) +
            '"]',
        ).fill('4');
        await page.getByText(i18n.t('driver.graphicAssociateId'), { exact: true }).first()
          .locator('..').locator('input').fill('EDITED-ID');
        await page.getByRole('button', {
          name: i18n.t('driver.graphicAssociateEditHotspot', { number: 2 }),
          exact: true,
        }).click();
        const editOne = page.getByRole('button', {
          name: i18n.t('driver.graphicAssociateEditHotspot', { number: 1 }),
          exact: true,
        });
        const editTwo = page.getByRole('button', {
          name: i18n.t('driver.graphicAssociateEditHotspot', { number: 2 }),
          exact: true,
        });
        if (!((await editTwo.getAttribute('class'))?.includes('ds-btn-primary'))) {
          expect.unreachable(
            "Expected (await editTwo.getAttribute('class'))?.includes('ds-btn-primary')",
          );
        }
        if ((await editOne.getAttribute('class'))?.includes('ds-btn-primary')) {
          expect.unreachable(
            "Expected !(await editOne.getAttribute('class'))?.includes('ds-btn-primary')",
          );
        }
        await page.getByRole('button', {
          name: i18n.t('driver.graphicAssociateRemoveHotspot', { number: 3 }),
          exact: true,
        }).click();
        const captures = JSON.parse(await page.locator('[data-captures]').innerText());
        expect(captures).toStrictEqual([
          { name: 'add-hotspot', value: 'D' },
          {
            name: 'pair',
            value: [
              { sourceId: 'ZONE-A', targetId: 'ZONE-B' },
              { sourceId: 'ZONE-A', targetId: 'ZONE-C' },
            ],
          },
          { name: 'shape', value: 'rect' },
          { name: 'match-max', value: 4 },
          { name: 'hotspot-id', value: 'EDITED-ID' },
          { name: 'remove-hotspot', value: 'ZONE-C' },
        ]);
        expect(JSON.parse(await page.locator('[data-state]').innerText())).toStrictEqual({
          background: {
            source: 'data:image/png;base64,TECHNICAL-SOURCE',
            alt: 'AUTHORED-ALT-漢字',
            longDescription: 'AUTHORED-DESC',
            mimeType: 'image/png',
            width: 640,
            height: 480,
          },
          hotspots: [
            { id: 'EDITED-ID', shape: 'rect', coords: '120,90,18', matchMax: 4 },
            { id: 'ZONE-B', shape: 'rect', coords: '10,20,30,40', matchMax: 2 },
            { id: 'D', shape: 'circle', coords: '50,50,10', matchMax: 2 },
          ],
          pairs: [{ sourceId: 'EDITED-ID', targetId: 'ZONE-B' }],
          maxAssociations: 3,
        });
        expect(await page.locator('[data-captures]').count()).toStrictEqual(1);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await server?.close();
    if (temp) await _fs.rm(temp, { recursive: true });
  }
});
