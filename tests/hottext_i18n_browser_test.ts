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
const surfaceKeys = [
  'driver.hottextSpans',
  'driver.hottextAddSpan',
  'driver.hottextEmpty',
  'driver.hottextPlaced',
  'driver.hottextNotPlaced',
  'driver.hottextInsertAction',
  'driver.correct',
  'driver.remove',
] as const;
const initial = {
  bodyHtml: '<p><span data-qti-hottext="A">FIRST-AUTHORED-Ω</span></p>',
  hottexts: [{ id: 'A', text: 'FIRST-AUTHORED-Ω' }, { id: 'B', text: 'SECOND-AUTHORED-漢字' }],
  correctIds: ['B'],
  responseIdentifier: 'RESPONSE_Ω',
};

testCase('hot text hydration and editing are localized in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.hottext-browser-'));
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `import {h,render} from "preact";
import {useState} from "preact/hooks";
import {I18nProvider} from "${process.cwd()}/lib/i18n/context.tsx";
import {HottextContent} from "${process.cwd()}/islands/drivers/hottext.tsx";
function App({config}) {
 const [s,setS]=useState(config.state); const [c,setC]=useState([]);
 const cap=x=>setC(p=>[...p,x]); const patch=f=>setS(p=>({...p,...f(p)}));
 const marker=(id,text)=>'<span data-qti-hottext="'+id+'">'+text+'</span>';
 return h(I18nProvider,{payload:config.payload},h('main',null,
   h(HottextContent,{...s,renderPromptField:p=>h('input',{placeholder:p}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,
   insertHottext:()=>{cap({type:'add',id:'C',text:'NEW-C'});patch(p=>({hottexts:[...p.hottexts,{id:'C',text:'NEW-C'}]}));},
   insertHottextMarker:id=>{cap({type:'insert',id});patch(p=>({bodyHtml:p.bodyHtml+marker(id,p.hottexts.find(x=>x.id===id).text)}));},
   removeHottext:id=>{cap({type:'remove',id});patch(p=>({bodyHtml:p.bodyHtml.replace(marker(id,p.hottexts.find(x=>x.id===id)?.text||''),''),hottexts:p.hottexts.filter(x=>x.id!==id),correctIds:p.correctIds.filter(x=>x!==id)}));},
   updateHottextText:(id,text)=>{cap({type:'text',id,text});patch(p=>({bodyHtml:p.bodyHtml.replace(marker(id,p.hottexts.find(x=>x.id===id)?.text||''),marker(id,text)),hottexts:p.hottexts.map(x=>x.id===id?({...x,text}):x)}));},
   setCorrectIds:ids=>{cap({type:'correct',ids});patch(()=>({correctIds:ids}));},setResponseIdentifier:id=>{cap({type:'response',id});patch(()=>({responseIdentifier:id}));}}),
  h('output',{'data-state':'hottext'},JSON.stringify(s)),h('output',{'data-captures':'hottext'},JSON.stringify(c))));
}
globalThis.mount=c=>render(h(App,{config:c}),document.getElementById('root'));globalThis.mount(globalThis.__CONFIG__);`,
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
    const samples = locales.map((l) =>
      createI18n(l, createI18nPayload(l, catalogForLocale(l), ['authoring']).namespaces).t(
        'driver.hottextSpans',
      )
    );
    for (const sample of samples) {
      if (bundleText.includes(sample)) {
        expect.unreachable('Expected !bundleText.includes(sample)');
      }
    }
    const configs = new Map(
      locales.map(
        (locale) => [locale, {
          payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
          state: initial,
        }],
      ),
    );
    const json = (v: unknown) => JSON.stringify(v).replaceAll('<', '\\u003c');
    server = await startFetchServer((req) => {
      const u = new URL(req.url);
      if (u.pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const x = configs.get(u.searchParams.get('locale') as InterfaceLocale);
      return x
        ? new Response(
          `<!doctype html><meta charset="utf-8"><div id="root"></div><script>globalThis.__CONFIG__=${
            json(x)
          }</script><script type="module" src="/bundle.js"></script>`,
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
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(String(error)));
        await page.goto(`http://${addr.hostname}:${addr.port}/?locale=${locale}`);
        try {
          await page.locator('[data-state=hottext]').waitFor({ timeout: 5_000 });
        } catch (error) {
          throw new Error(`Hot Text mount failed: ${pageErrors.join(' | ')}; ${error}`);
        }
        await page.getByText(i18n.t('driver.hottextSpans'), { exact: true }).waitFor();
        const out = page.locator('[data-state=hottext]');
        const state = async () => JSON.parse(await out.innerText());
        const assertSafe = async () => {
          const rendered = await page.locator('main').innerHTML();
          if (rendered.includes('driver.')) {
            expect.unreachable("Expected !rendered.includes('driver.')");
          }
          if (rendered.match(/\{(?:count|plural|select)(?:[,}])/)) {
            expect.unreachable('Expected !rendered.match(/\\{(?:count|plural|select)(?:[,}])/)');
          }
        };
        const assertSpanishIsolation = async () => {
          if (locale !== 'es-ES' && locale !== 'es-419') return;
          const en = createI18n('en-US', configs.get('en-US')!.payload.namespaces);
          const expectAbsentText = async (
            key: Parameters<typeof i18n.t>[0],
            args?: Readonly<Record<string, string | number | boolean | Date>>,
          ) => {
            const english = en.t(key, args);
            const localized = i18n.t(key, args);
            if (english !== localized) {
              expect(await page.getByText(english, { exact: true }).count()).toStrictEqual(0);
            }
          };
          for (const key of surfaceKeys) await expectAbsentText(key);
          const enPrompt = en.t('driver.hottextPrompt');
          const localizedPrompt = i18n.t('driver.hottextPrompt');
          if (enPrompt !== localizedPrompt) {
            expect(await page.locator(`input[placeholder="${enPrompt}"]`).count()).toStrictEqual(0);
          }
          const enSelectable = en.t('driver.hottextSelectablePlaceholder');
          const localizedSelectable = i18n.t('driver.hottextSelectablePlaceholder');
          if (enSelectable !== localizedSelectable) {
            expect(await page.locator(`input[placeholder="${enSelectable}"]`).count())
              .toStrictEqual(0);
          }
          for (const number of [1, 2]) {
            await expectAbsentText('driver.hottextSpan', { number });
            await expectAbsentText('driver.hottextCorrect', { number });
            const enCorrect = en.t('driver.hottextCorrect', { number });
            const localizedCorrect = i18n.t('driver.hottextCorrect', { number });
            if (enCorrect !== localizedCorrect) {
              expect(await page.getByRole('checkbox', { name: enCorrect }).count()).toStrictEqual(
                0,
              );
            }
            await expectAbsentText('driver.hottextRemove', { number });
            await expectAbsentText('driver.hottextInsert', { number });
            const enRemove = en.t('driver.hottextRemove', { number });
            const localizedRemove = i18n.t('driver.hottextRemove', { number });
            if (enRemove !== localizedRemove) {
              expect(await page.getByRole('button', { name: enRemove }).count()).toStrictEqual(0);
            }
            const enInsert = en.t('driver.hottextInsert', { number });
            const localizedInsert = i18n.t('driver.hottextInsert', { number });
            if (enInsert !== localizedInsert) {
              expect(await page.getByRole('button', { name: enInsert }).count()).toStrictEqual(0);
            }
          }
          expect(
            await page.getByRole('button', { name: `+ ${en.t('driver.hottextAddSpan')}` })
              .count(),
          ).toStrictEqual(0);
          if (en.t('driver.hottextInsertAction') !== i18n.t('driver.hottextInsertAction')) {
            expect(
              await page.getByRole('button', { name: en.t('driver.hottextInsertAction') })
                .count(),
            ).toStrictEqual(0);
          }
        };
        expect(JSON.parse(await page.locator('[data-captures=hottext]').innerText())).toStrictEqual(
          [],
        );
        expect(await state()).toStrictEqual(initial);
        expect(await page.locator(`input[placeholder="${i18n.t('driver.hottextPrompt')}"]`).count())
          .toStrictEqual(1);
        expect(
          await page.getByRole('button', { name: `+ ${i18n.t('driver.hottextAddSpan')}` })
            .count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.hottextInsert', { number: 2 }) })
            .count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.hottextInsert', { number: 1 }) })
            .count(),
        ).toStrictEqual(0);
        expect(await page.locator('input[type=checkbox]').count()).toStrictEqual(2);
        expect(await page.getByText(i18n.t('driver.hottextSpans'), { exact: true }).count())
          .toStrictEqual(1);
        expect(await page.getByText(i18n.t('driver.hottextPlaced'), { exact: true }).count())
          .toStrictEqual(1);
        expect(await page.getByText(i18n.t('driver.hottextNotPlaced'), { exact: true }).count())
          .toStrictEqual(1);
        expect(
          await page.getByText(i18n.t('driver.hottextSpan', { number: 1 }), { exact: true })
            .count(),
        ).toStrictEqual(1);
        expect(
          await page.getByText(i18n.t('driver.hottextSpan', { number: 2 }), { exact: true })
            .count(),
        ).toStrictEqual(1);
        expect(await page.getByText(i18n.t('driver.correct'), { exact: true }).count())
          .toStrictEqual(2);
        expect(await page.getByText(i18n.t('driver.hottextInsertAction'), { exact: true }).count())
          .toStrictEqual(1);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.hottextRemove', { number: 1 }) })
            .count(),
        ).toStrictEqual(1);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.hottextRemove', { number: 2 }) })
            .count(),
        ).toStrictEqual(1);
        expect(await page.getByText(i18n.t('driver.remove'), { exact: true }).count())
          .toStrictEqual(2);
        expect(
          await page.getByRole('checkbox', {
            name: i18n.t('driver.hottextCorrect', { number: 1 }),
          }).isChecked(),
        ).toStrictEqual(false);
        expect(
          await page.getByRole('checkbox', {
            name: i18n.t('driver.hottextCorrect', { number: 2 }),
          }).isChecked(),
        ).toStrictEqual(true);
        await assertSafe();
        await assertSpanishIsolation();
        const inputs = page.locator(
          'input[placeholder="' + i18n.t('driver.hottextSelectablePlaceholder') + '"]',
        );
        expect(await inputs.nth(0).inputValue()).toStrictEqual('FIRST-AUTHORED-Ω');
        expect(await inputs.nth(1).inputValue()).toStrictEqual('SECOND-AUTHORED-漢字');
        const bRow = page.getByText(i18n.t('driver.hottextSpan', { number: 2 }), { exact: true })
          .locator('..');
        await bRow.locator(
          'input[placeholder="' + i18n.t('driver.hottextSelectablePlaceholder') + '"]',
        ).fill('EDITED-AUTHORED-Ω');
        await page.getByRole('checkbox', { name: i18n.t('driver.hottextCorrect', { number: 1 }) })
          .check();
        await page.getByRole('button', { name: i18n.t('driver.hottextInsert', { number: 2 }) })
          .click();
        await page.getByRole('button', { name: `+ ${i18n.t('driver.hottextAddSpan')}` }).click();
        await page.getByRole('button', { name: i18n.t('driver.hottextRemove', { number: 3 }) })
          .click();
        // ResponseIdentifierDisclosure currently renders null, so responseIdentifier remains invariant.
        expect(await state()).toStrictEqual({
          bodyHtml:
            '<p><span data-qti-hottext="A">FIRST-AUTHORED-Ω</span></p><span data-qti-hottext="B">EDITED-AUTHORED-Ω</span>',
          hottexts: [{ id: 'A', text: 'FIRST-AUTHORED-Ω' }, {
            id: 'B',
            text: 'EDITED-AUTHORED-Ω',
          }],
          correctIds: ['B', 'A'],
          responseIdentifier: 'RESPONSE_Ω',
        });
        expect(await page.getByText(i18n.t('driver.hottextPlaced'), { exact: true }).count())
          .toStrictEqual(2);
        expect(await page.getByText(i18n.t('driver.hottextNotPlaced'), { exact: true }).count())
          .toStrictEqual(0);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.hottextInsert', { number: 2 }) })
            .count(),
        ).toStrictEqual(0);
        expect(
          await page.getByRole('button', { name: i18n.t('driver.hottextInsertAction') }).count(),
        ).toStrictEqual(0);
        const captures = JSON.parse(await page.locator('[data-captures=hottext]').innerText());
        expect(captures).toStrictEqual([
          { type: 'text', id: 'B', text: 'EDITED-AUTHORED-Ω' },
          { type: 'correct', ids: ['B', 'A'] },
          { type: 'insert', id: 'B' },
          { type: 'add', id: 'C', text: 'NEW-C' },
          { type: 'remove', id: 'C' },
        ]);
        await assertSafe();
        expect(await page.getByText(i18n.t('driver.remove'), { exact: true }).count())
          .toStrictEqual(2);
        await assertSpanishIsolation();
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
