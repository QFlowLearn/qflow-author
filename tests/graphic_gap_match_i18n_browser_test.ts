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
const choices = [
  {
    id: 'CHOICE-A',
    kind: 'text',
    text: 'AUTHORED-TEXT',
    html: '<em>AUTHORED-HTML</em>',
    matchMax: 2,
    fixed: true,
  },
  {
    id: 'CHOICE-B',
    kind: 'image',
    imgSrc: 'https://qflow.example/b.png',
    imgAlt: 'AUTHORED-IMAGE-ALT',
    imgType: 'image/png',
    matchMax: 1,
    fixed: false,
  },
];
const targets = [
  { id: 'TARGET-1', shape: 'circle', coords: '10,20,5', matchMax: 2 },
  { id: 'TARGET-2', shape: 'rect', coords: '30,40,50,60', matchMax: 1 },
];

testCase('Graphic Gap Match browser UI localizes and preserves interaction contracts', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.graphic-gap-browser-'));
    const entry = `${temp}/entry.tsx`, bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact"; import { useState } from "preact/hooks";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import { GraphicGapMatchContent } from "${process.cwd()}/islands/drivers/graphic_gap_match.tsx";
function App({config}) { const [s,setS]=useState(config.state); const [captures,setC]=useState([]); const cap=(name,value)=>setC(x=>[...x,{name,value}]); const patch=p=>setS(x=>({...x,...p})); const choices=v=>setS(x=>({...x,choices:typeof v==='function'?v(x.choices):v})); const targets=v=>setS(x=>({...x,targets:typeof v==='function'?v(x.targets):v})); const pairs=v=>setS(x=>({...x,pairs:typeof v==='function'?v(x.pairs):v})); return h(I18nProvider,{payload:config.payload},h('main',null,h(GraphicGapMatchContent,{graphicBackground:s.background,graphicResponseId:'RESPONSE-ID',graphicChoices:s.choices,graphicTargets:s.targets,graphicCorrectPairs:s.pairs,renderPromptField:p=>h('input',{placeholder:p}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,setGraphicBackground:v=>patch({background:v}),setGraphicResponseId:()=>{},addGraphicChoice:()=>{choices(x=>[...x,{id:'C',kind:'text',text:'Choice C',matchMax:1}]);cap('add-choice','C')},removeGraphicChoice:id=>{choices(x=>x.filter(c=>c.id!==id));pairs(x=>x.filter(p=>p.choiceId!==id));cap('remove-choice',id)},updateGraphicChoiceId:(id,v)=>{choices(x=>x.map(c=>c.id===id?{...c,id:v}:c));pairs(x=>x.map(p=>p.choiceId===id?{...p,choiceId:v}:p));cap('choice-id',v)},updateGraphicChoiceKind:(id,v)=>{choices(x=>x.map(c=>c.id===id?{...c,kind:v}:c));cap('kind',v)},updateGraphicChoiceText:(id,v)=>{choices(x=>x.map(c=>c.id===id?{...c,text:v}:c));cap("choice-text",{id,value:v})},updateGraphicChoiceHtml:(id,v)=>choices(x=>x.map(c=>c.id===id?{...c,html:v}:c)),updateGraphicChoiceImage:(id,v)=>choices(x=>x.map(c=>c.id===id?{...c,imgSrc:v.source,imgAlt:v.alt,imgType:v.mimeType}:c)),updateGraphicChoiceMatchMax:(id,v)=>{choices(x=>x.map(c=>c.id===id?{...c,matchMax:v}:c));cap('choice-max',v)},setGraphicChoiceFixed:(id,v)=>{choices(x=>x.map(c=>c.id===id?{...c,fixed:v}:c));cap('fixed',v)},addGraphicTarget:()=>{targets(x=>[...x,{id:'TARGET-3',shape:'circle',coords:'50,50,10',matchMax:1}]);cap('add-target','TARGET-3')},removeGraphicTarget:id=>{targets(x=>x.filter(t=>t.id!==id));pairs(x=>x.filter(p=>p.targetId!==id));cap('remove-target',id)},updateGraphicTargetId:(id,v)=>{targets(x=>x.map(t=>t.id===id?{...t,id:v}:t));pairs(x=>x.map(p=>p.targetId===id?{...p,targetId:v}:p));cap('target-id',v)},updateGraphicTargetShape:(id,v)=>{targets(x=>x.map(t=>t.id===id?{...t,shape:v}:t));cap('target-shape',v)},updateGraphicTargetCoords:(id,v)=>targets(x=>x.map(t=>t.id===id?{...t,coords:v}:t)),updateGraphicTargetMatchMax:(id,v)=>targets(x=>x.map(t=>t.id===id?{...t,matchMax:v}:t)),setGraphicCorrectPair:(tid,cid)=>{const next=s.pairs.filter(p=>p.targetId!==tid).concat(cid?[{targetId:tid,choiceId:cid}]:[]);pairs(next);cap('correct-pair',{targetId:tid,choiceId:cid})}}),h('output',{'data-state':true},JSON.stringify(s)),h('output',{'data-captures':true},JSON.stringify(captures)))); } globalThis.mount=c=>render(h(App,{config:c}),document.getElementById('root')); globalThis.mount(globalThis.__CONFIG__);
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
      if (
        bundleText.includes(
          createI18n(
            locale,
            createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
          ).t('driver.graphicGapMatchPrompt'),
        )
      ) {
        expect.unreachable(
          'Expected !bundleText.includes( createI18n( locale, createI18nPayload(locale, catalogForLocale(local',
        );
      }
    }
    const configs = new Map(locales.map((locale) => [locale, {
      payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      state: {
        background: {
          source: 'data:image/png;base64,TECHNICAL-SOURCE',
          alt: 'AUTHORED-BG-ALT',
          longDescription: 'AUTHORED-BG-DESC',
          mimeType: 'image/png',
        },
        choices,
        pairs: [{ targetId: 'TARGET-2', choiceId: 'CHOICE-A' }],
        targets,
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
        `<!doctype html><html><body><div id="root"></div><script>globalThis.__CONFIG__=${
          json(c)
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    browser = await chromium.launch();
    const a = new URL(server.origin);
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        await page.goto(`http://${a.hostname}:${a.port}/?locale=${locale}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.getByText(i18n.t('driver.graphicGapMatchChoices'), { exact: true }).waitFor();
        const body = page.locator('body'),
          state = page.locator('[data-state]'),
          captures = page.locator('[data-captures]');
        expect(JSON.parse(await captures.innerText())).toStrictEqual([]);
        const initial = JSON.parse(await state.innerText());
        expect(initial.background).toStrictEqual({
          source: 'data:image/png;base64,TECHNICAL-SOURCE',
          alt: 'AUTHORED-BG-ALT',
          longDescription: 'AUTHORED-BG-DESC',
          mimeType: 'image/png',
        });
        expect(initial).toStrictEqual({
          background: {
            source: 'data:image/png;base64,TECHNICAL-SOURCE',
            alt: 'AUTHORED-BG-ALT',
            longDescription: 'AUTHORED-BG-DESC',
            mimeType: 'image/png',
          },
          choices,
          targets,
          pairs: [{ targetId: 'TARGET-2', choiceId: 'CHOICE-A' }],
        });
        const text = await body.innerText();
        expect(await page.getByPlaceholder(i18n.t('driver.graphicGapMatchPrompt')).count())
          .toStrictEqual(1);
        for (
          const key of [
            'graphicGapMatchBackgroundSource',
            'graphicGapMatchBackgroundAlt',
            'graphicGapMatchChoices',
            'graphicGapMatchAddChoice',
            'graphicGapMatchTargets',
            'graphicGapMatchAddTarget',
            'graphicGapMatchTargetEditor',
            'graphicGapMatchEditingTarget',
          ] as const
        ) expect(text).toContain(i18n.t(`driver.${key}`));
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.graphicGapMatchRemoveChoice', { number: 1 }),
            exact: true,
          }).count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', {
            name: i18n.t('driver.graphicGapMatchRemoveTarget', { number: 1 }),
            exact: true,
          }).count(),
        ).toStrictEqual(1);
        expect(text).toContain('AUTHORED-BG-ALT');
        expect(text).toContain('AUTHORED-BG-DESC');
        expect(text).toContain('CHOICE-A');
        expect(text).toContain('TARGET-1');
        if (!(!text.includes('driver.') && !/\{(?:count|plural|select)[^}]*\}/.test(text))) {
          expect.unreachable(
            "Expected !text.includes('driver.') && !/\\{(?:count|plural|select)[^}]*\\}/.test(text)",
          );
        }
        if (locale === 'es-ES' || locale === 'es-419') {
          for (
            const p of [
              'Background image',
              'Background alt text',
              'Background long description',
              'Background MIME type',
              'Choices',
              'Add text or image choices',
              'Choice 1',
              'Kind',
              'Choice text',
              'Image source',
              'Image alt text',
              'Match max',
              'Advanced',
              'Choice identifier',
              'HTML (optional)',
              'Fixed',
              'Targets',
              'Add target',
              'drop zones',
              'Shape',
              'Coords',
              'Correct choice',
              'Select target',
              'Target editor',
              'Editing target',
              'Set a background image to draw targets.',
            ]
          ) if (text.includes(p)) expect.unreachable('Expected !text.includes(p)');
          if (text.split('\n').some((line) => line === 'Edit' || line === 'Remove')) {
            expect.unreachable(
              "Expected !text.split('\\n').some((line) => line === 'Edit' || line === 'Remove')",
            );
          }
        }
        await page.getByRole('button', {
          name: `+ ${i18n.t('driver.graphicGapMatchAddChoice')}`,
          exact: true,
        }).click();
        await page.getByRole('button', {
          name: `+ ${i18n.t('driver.graphicGapMatchAddTarget')}`,
          exact: true,
        }).click();
        await page.getByText(i18n.t('driver.graphicGapMatchAdvanced'), { exact: true }).first()
          .click();
        await page.getByText(i18n.t('driver.graphicGapMatchChoice', { number: 1 }), {
          exact: true,
        })
          .locator('..').locator('..')
          .getByPlaceholder(i18n.t('driver.graphicGapMatchTextPlaceholder')).fill('EDITED-TEXT');
        await page.getByRole('checkbox').first().click();
        await page.getByText(i18n.t('driver.graphicGapMatchTargetShape'), { exact: true }).first()
          .locator('..').locator('select').selectOption('rect');
        await page.getByText(i18n.t('driver.graphicGapMatchKind'), { exact: true }).first()
          .locator('..').locator('select').selectOption('image');
        await page.locator('input[type=number]').first().fill('4');
        await page.getByText(i18n.t('driver.graphicGapMatchChoiceIdentifier'), { exact: true })
          .first().locator('..').locator('input').fill('EDITED-A');
        const targetRows = page.locator('div.rounded-lg');
        const target3Index = await targetRows.evaluateAll((rows) =>
          rows.findIndex((row) =>
            Array.from(row.querySelectorAll('input')).some((input) => input.value === 'TARGET-3')
          )
        );
        if (!(target3Index >= 0)) expect.unreachable('Expected target3Index >= 0');
        const target3Row = targetRows.nth(target3Index);
        await target3Row.locator('label').filter({
          hasText: i18n.t('driver.graphicGapMatchCorrectChoice'),
        }).locator('select').selectOption('EDITED-A');
        await page.getByRole('button', {
          name: i18n.t('driver.graphicGapMatchEditTarget', { number: 2 }),
          exact: true,
        }).click();
        const edit1 = page.getByRole('button', {
          name: i18n.t('driver.graphicGapMatchEditTarget', { number: 1 }),
          exact: true,
        });
        const edit2 = page.getByRole('button', {
          name: i18n.t('driver.graphicGapMatchEditTarget', { number: 2 }),
          exact: true,
        });
        if (!((await edit2.getAttribute('class') ?? '').includes('ds-btn-primary'))) {
          expect.unreachable(
            "Expected (await edit2.getAttribute('class') ?? '').includes('ds-btn-primary')",
          );
        }
        if ((await edit1.getAttribute('class') ?? '').includes('ds-btn-primary')) {
          expect.unreachable(
            "Expected !(await edit1.getAttribute('class') ?? '').includes('ds-btn-primary')",
          );
        }
        await page.getByRole('button', {
          name: i18n.t('driver.graphicGapMatchRemoveTarget', { number: 2 }),
          exact: true,
        }).click();
        const final = JSON.parse(await state.innerText());
        expect(final).toStrictEqual({
          background: {
            source: 'data:image/png;base64,TECHNICAL-SOURCE',
            alt: 'AUTHORED-BG-ALT',
            longDescription: 'AUTHORED-BG-DESC',
            mimeType: 'image/png',
          },
          choices: [
            {
              id: 'EDITED-A',
              kind: 'image',
              text: 'EDITED-TEXT',
              html: '<em>AUTHORED-HTML</em>',
              matchMax: 4,
              fixed: false,
            },
            {
              id: 'CHOICE-B',
              kind: 'image',
              imgSrc: 'https://qflow.example/b.png',
              imgAlt: 'AUTHORED-IMAGE-ALT',
              imgType: 'image/png',
              matchMax: 1,
              fixed: false,
            },
            { id: 'C', kind: 'text', text: 'Choice C', matchMax: 1 },
          ],
          targets: [
            { id: 'TARGET-1', shape: 'rect', coords: '10,20,5', matchMax: 2 },
            { id: 'TARGET-3', shape: 'circle', coords: '50,50,10', matchMax: 1 },
          ],
          pairs: [{ targetId: 'TARGET-3', choiceId: 'EDITED-A' }],
        });
        const finalText = await body.innerText();
        if (
          !(!finalText.includes('driver.') && !/\{(?:count|plural|select)[^}]*\}/.test(finalText))
        ) {
          expect.unreachable(
            "Expected !finalText.includes('driver.') && !/\\{(?:count|plural|select)[^}]*\\}/.test(finalText)",
          );
        }
        if (locale === 'es-ES' || locale === 'es-419') {
          for (
            const phrase of [
              'Background image',
              'Add choice',
              'Add target',
              'Correct pairs',
              'Pairing is unordered',
            ]
          ) {
            if (finalText.includes(phrase)) {
              expect.unreachable('Expected !finalText.includes(phrase)');
            }
          }
          if (finalText.split('\n').some((line) => line === 'Edit' || line === 'Remove')) {
            expect.unreachable(
              "Expected !finalText.split('\\n').some((line) => line === 'Edit' || line === 'Remove')",
            );
          }
        }
        const got = JSON.parse(await captures.innerText());
        expect(got).toStrictEqual([
          { name: 'add-choice', value: 'C' },
          { name: 'add-target', value: 'TARGET-3' },
          { name: 'choice-text', value: { id: 'CHOICE-A', value: 'EDITED-TEXT' } },
          { name: 'fixed', value: false },
          { name: 'target-shape', value: 'rect' },
          { name: 'kind', value: 'image' },
          { name: 'choice-max', value: 4 },
          { name: 'choice-id', value: 'EDITED-A' },
          { name: 'correct-pair', value: { targetId: 'TARGET-3', choiceId: 'EDITED-A' } },
          { name: 'remove-target', value: 'TARGET-2' },
        ]);
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
