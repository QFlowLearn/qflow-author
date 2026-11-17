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

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'sv-SE', 'es-419'];

declare global {
  var mount: (config: unknown) => void;
  var __CONFIG__: unknown;
  var __ERRORS__: string[];
}

testCase('match-family controls render localized production surfaces in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.match-family-browser-'));
  const entry = `${temp}/entry.tsx`;
  const bundle = `${temp}/bundle.js`;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    await _fs.writeFile(
      entry,
      `
        import { h, render } from 'preact';
        import { useState } from 'preact/hooks';
        import { I18nProvider } from '${process.cwd()}/lib/i18n/context.tsx';
        import { parsePersistedDraft } from '${process.cwd()}/lib/persisted_draft.ts';
        import { driverViewsFor } from '${process.cwd()}/islands/drivers/view_registry.ts';
        import '${process.cwd()}/islands/drivers/match.tsx';
        import '${process.cwd()}/islands/drivers/associate.tsx';
        import '${process.cwd()}/islands/drivers/inline_choice.tsx';
        import '${process.cwd()}/islands/drivers/gap_match.tsx';
        import { createInlineChoiceMarkerHtml } from '${process.cwd()}/lib/types/inline_choice.ts';
        import { createGapMarkerHtml } from '${process.cwd()}/lib/types/gap_match.ts';
        const common={renderPromptField:(p)=>h('input',{placeholder:p}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,plainTextValue:(x)=>x||''};
        function RegisteredMatch({config}) { const [draft,setDraft]=useState(()=>parsePersistedDraft({type:'match',itemLanguage:'en-US',title:'AUTHORED-TITLE',bodyHtml:'<p>AUTHORED-BODY-Ω</p>',sources:[{id:'S1',text:'AUTHORED-SOURCE-Ω',matchMax:1},{id:'S2',text:'Source two',matchMax:1}],targets:[{id:'T1',text:'AUTHORED-TARGET-漢字',matchMax:1},{id:'T2',text:'Target two',matchMax:1}],correctPairs:[],maxAssociations:1},'match')); const views=driverViewsFor('match'); if(!views) throw new Error('match registration missing'); return h(I18nProvider,{payload:config.payload},h('section',{'data-kind':'match'},views.ui({draft,update:setDraft,editor:common}),h('output',{hidden:true,'data-state':'match'},JSON.stringify(draft)))); }
        function RegisteredAssociate({config}) { const [draft,setDraft]=useState(()=>parsePersistedDraft({type:'associate',itemLanguage:'en-US',title:'AUTHORED-ASSOCIATE-TITLE',bodyHtml:'<p>AUTHORED-ASSOCIATE-BODY-Ω</p>',choices:[{id:'A',text:'AUTHORED-ASSOCIATE-A-漢字',matchMax:1},{id:'B',text:'Associate B',matchMax:1},{id:'C',text:'Associate C',matchMax:1}],correctPairs:[],maxAssociations:1},'associate')); const views=driverViewsFor('associate'); if(!views) throw new Error('associate registration missing'); return h(I18nProvider,{payload:config.payload},h('section',{'data-kind':'associate'},views.ui({draft,update:setDraft,editor:common}),h('output',{hidden:true,'data-state':'associate'},JSON.stringify(draft)))); }
        function InlineView({draft,update,editor}) { const views=driverViewsFor('inline_choice'); if(!views) throw new Error('inline registration missing'); return views.ui({draft,update,editor}); }
        function RegisteredInline({config}) { const slotOne={id:'RESPONSE_1',label:'Blank One Ω',required:true,shuffle:false,options:[{id:'A',text:'AUTHORED-INLINE-A-漢字',score:0,fixed:false},{id:'B',text:'Inline B',score:1,fixed:true},{id:'C',text:'Inline C',score:0,fixed:false}],correctId:'B'}; const slotTwo={id:'RESPONSE_2',label:'Second Blank',required:false,shuffle:true,options:[{id:'D',text:'Inline D',score:0,fixed:false},{id:'E',text:'Inline E',score:1,fixed:false}],correctId:'E'}; const bodyHtml='<p>AUTHORED-INLINE-BODY-Ω '+createInlineChoiceMarkerHtml({id:'RESPONSE_1',label:slotOne.label})+' '+createInlineChoiceMarkerHtml({id:'RESPONSE_2',label:slotTwo.label})+'</p>'; const [draft,setDraft]=useState(()=>parsePersistedDraft({type:'inline_choice',itemLanguage:'en-US',title:'AUTHORED-INLINE-TITLE-漢字',bodyHtml,inlineChoices:[slotOne,slotTwo],responseMode:'partial'},'inline_choice')); const editor={...common,setDraftField:(key,value)=>setDraft(previous=>({...previous,[key]:typeof value==='function'?value(previous[key]):value})),setDraftListField:(key,value)=>setDraft(previous=>({...previous,[key]:typeof value==='function'?value(previous[key]):value}))}; return h(I18nProvider,{payload:config.payload},h('section',{'data-kind':'inline'},h(InlineView,{draft,update:setDraft,editor}),h('output',{hidden:true,'data-state':'inline'},JSON.stringify(draft)))); }
        function GapView({draft,update,editor}) { const views=driverViewsFor('gap_match'); if(!views) throw new Error('gap registration missing'); return views.ui({draft,update,editor}); }
        function RegisteredGap({config}) { const gap={id:'GAP_1',label:'Gap One Ω'}; const secondGap={id:'GAP_2',label:'Gap Two'}; const bodyHtml='<p>AUTHORED-GAP-BODY-Ω '+createGapMarkerHtml({id:gap.id,label:gap.label})+'</p>'; const initial={type:'gap_match',itemLanguage:'en-US',title:'AUTHORED-GAP-TITLE-漢字',bodyHtml,responseIdentifier:'RESPONSE',shuffle:true,gapChoices:[{id:'A',kind:'text',text:'AUTHORED-GAP-CHOICE-Ω',matchMax:1,fixed:false},{id:'B',kind:'text',text:'Gap Choice B',matchMax:1,fixed:true},{id:'C',kind:'text',text:'Gap Choice C',matchMax:1,fixed:false}],gaps:[gap,secondGap],correctGapPairs:[{gapId:'GAP_1',choiceId:'A'},{gapId:'GAP_2',choiceId:'C'}]}; const [draft,setDraft]=useState(()=>parsePersistedDraft(initial,'gap_match')); const editor={...common,settings:{allowPins:true},setDraftField:(key,value)=>setDraft(previous=>({...previous,[key]:typeof value==='function'?value(previous[key]):value})),setDraftListField:(key,value)=>setDraft(previous=>({...previous,[key]:typeof value==='function'?value(previous[key]):value}))}; return h(I18nProvider,{payload:config.payload},h('section',{'data-kind':'gap'},h(GapView,{draft,update:setDraft,editor}),h('output',{hidden:true,'data-state':'gap'},JSON.stringify(draft)))); }
        function App({config}) { return h('main',null,h(RegisteredMatch,{config}),h(RegisteredAssociate,{config}),h(RegisteredInline,{config}),h(RegisteredGap,{config})); }
        globalThis.mount=(config)=>render(h(App,{config}),document.getElementById('root'));
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
    const configs = new Map(
      locales.map((
        locale,
      ) => [locale, {
        payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      }]),
    );
    const safe = (v: unknown) => JSON.stringify(v).replaceAll('<', '\\\\u003c');
    server = await startFetchServer((req) => {
      const path = new URL(req.url).pathname;
      if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) {
        return new Response(_fsSync.readFileSync(`static${path}`), {
          headers: { 'content-type': 'font/woff2' },
        });
      }
      if (path === '/favicon.ico') return new Response(null, { status: 204 });
      if (path === '/test-styles.css') {
        return new Response(
          _fsSync.readFileSync('static/tw.css', 'utf8') +
            _fsSync.readFileSync('static/styles.css', 'utf8'),
          { headers: { 'content-type': 'text/css' } },
        );
      }
      if (new URL(req.url).pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      const locale = new URL(req.url).searchParams.get('locale') as InterfaceLocale;
      const config = configs.get(locale);
      if (!config) return new Response('unsupported', { status: 400 });
      return new Response(
        `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/test-styles.css"></head><body><div id="root"></div><script>globalThis.__ERRORS__=[];addEventListener('error',e=>__ERRORS__.push(String(e.message||e.type)));addEventListener('unhandledrejection',e=>__ERRORS__.push(String(e.reason||'unhandled')));globalThis.__CONFIG__=${
          safe(config)
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    browser = await chromium.launch();
    const address = new URL(server.origin);
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`, {
        waitUntil: 'networkidle',
      });
      await page.evaluate(() => {
        globalThis.mount(globalThis.__CONFIG__);
      });
      const body = page.locator('body');
      await page.getByText(i18n.t('driver.sources')).first().waitFor();
      const text = await body.innerText();
      for (const id of ['driver.sources', 'driver.targets', 'driver.matchMatrixHelp']) {
        expect(text).toContain(i18n.t(id));
      }
      for (
        const id of [
          'driver.inlineChoices',
          'driver.slotLabel',
          'driver.required',
          'driver.shuffleOptions',
          'driver.partialCredit',
          'driver.options',
          'driver.addOption',
        ]
      ) expect(text).toContain(i18n.t(id));
      expect(text).toContain(i18n.t('driver.insertInlineChoice'));
      if (!((await page.locator(`[title="${i18n.t('driver.markCorrect')}"]`).count()) > 0)) {
        expect.unreachable(
          'Expected (await page.locator(`[title="${i18n.t(\'driver.markCorrect\')}"]`).count()) > 0',
        );
      }
      expect(text).toContain('AUTHORED-SOURCE-Ω');
      expect(text).toContain('AUTHORED-TARGET-漢字');
      if (locale.startsWith('es-')) {
        expect(text).toContain(i18n.t('driver.notPlaced'));
        if (text.includes('Not placed')) expect.unreachable(`${locale} leaked Not placed`);
      }
      const match = page.locator('[data-kind="match"]');
      const sourceInput = match.locator('section').nth(0).locator('input').first();
      const targetInput = match.locator('section').nth(1).locator('input').first();
      await sourceInput.fill('AUTHORED-SOURCE-EDIT-Ω');
      await targetInput.fill('AUTHORED-TARGET-EDIT-漢字');
      const maxInputs = match.locator('input[type="number"]');
      await maxInputs.nth(0).fill('0');
      await maxInputs.nth(0).fill('1');
      const pair = match.locator('input[type="checkbox"]').first();
      await pair.check();
      const readState = async (): Promise<{
        sources: Array<{ id: string; text?: string; matchMax?: number }>;
        targets: Array<{ id: string; text?: string; matchMax?: number }>;
        correctPairs: Array<{ sourceId: string; targetId: string }>;
      }> => JSON.parse(await page.locator('[data-state="match"]').innerText());
      let state = await readState();
      expect(state.correctPairs).toStrictEqual([{ sourceId: 'S1', targetId: 'T1' }]);
      expect(state.sources[0].text).toStrictEqual('AUTHORED-SOURCE-EDIT-Ω');
      expect(state.targets[0].text).toStrictEqual('AUTHORED-TARGET-EDIT-漢字');
      expect(state.sources[0].matchMax).toStrictEqual(1);
      if (!(await match.locator('input[type="checkbox"]').nth(1).isDisabled())) {
        expect.unreachable(
          'Expected await match.locator(\'input[type="checkbox"]\').nth(1).isDisabled()',
        );
      }
      if (await pair.isDisabled()) expect.unreachable('Expected !(await pair.isDisabled())');
      await pair.uncheck();
      if (await match.locator('input[type="checkbox"]').nth(1).isDisabled()) {
        expect.unreachable(
          'Expected !(await match.locator(\'input[type="checkbox"]\').nth(1).isDisabled())',
        );
      }
      await match.getByRole('button', { name: `+ ${i18n.t('driver.addSource')}` }).click();
      await match.getByRole('button', { name: `+ ${i18n.t('driver.addTarget')}` }).click();
      await match.getByRole('button', {
        name: i18n.t('driver.removeChoiceLabel', {
          label: i18n.t('driver.sourceIndexed', { number: 3 }),
        }),
        exact: true,
      }).click();
      await match.getByRole('button', {
        name: i18n.t('driver.removeChoiceLabel', {
          label: i18n.t('driver.targetIndexed', { number: 3 }),
        }),
        exact: true,
      }).click();
      await sourceInput.fill('AUTHORED-SOURCE-FINAL-Ω');
      state = await readState();
      expect(state.sources.map((s) => s.id)).toStrictEqual(['S1', 'S2']);
      expect(state.targets.map((t) => t.id)).toStrictEqual(['T1', 'T2']);
      expect(state.correctPairs).toStrictEqual([]);
      const associate = page.locator('[data-kind="associate"]');
      const associateInputs = associate.locator('input.ds-input');
      await associateInputs.nth(0).fill('AUTHORED-ASSOCIATE-A-EDIT-漢字');
      await associateInputs.nth(2).fill('AUTHORED-ASSOCIATE-B-EDIT-Ω');
      const associateMax = associate.locator('input[type="number"]');
      await associateMax.nth(0).fill('0');
      const associateState = async (): Promise<{
        title: string;
        bodyHtml: string;
        choices: Array<{ id: string; text?: string; matchMax?: number }>;
        correctPairs: Array<{ sourceId: string; targetId: string }>;
      }> => JSON.parse(await associate.locator('[data-state="associate"]').innerText());
      let assoc = await associateState();
      expect(assoc.title).toStrictEqual('AUTHORED-ASSOCIATE-TITLE');
      expect(assoc.bodyHtml).toStrictEqual('<p>AUTHORED-ASSOCIATE-BODY-Ω</p>');
      expect(assoc.choices[0].matchMax).toStrictEqual(0);
      await associateMax.nth(0).fill('1');
      const pairBox = associate.locator('input[type="checkbox"]').first();
      await pairBox.check();
      assoc = await associateState();
      expect(assoc.correctPairs).toStrictEqual([{ sourceId: 'A', targetId: 'B' }]);
      if (!(await associate.locator('input[type="checkbox"]').nth(1).isDisabled())) {
        expect.unreachable(
          'Expected await associate.locator(\'input[type="checkbox"]\').nth(1).isDisabled()',
        );
      }
      if (await pairBox.isDisabled()) {
        expect.unreachable('Expected !(await pairBox.isDisabled())');
      }
      await pairBox.uncheck();
      if (await associate.locator('input[type="checkbox"]').nth(1).isDisabled()) {
        expect.unreachable(
          'Expected !(await associate.locator(\'input[type="checkbox"]\').nth(1).isDisabled())',
        );
      }
      await associate.getByRole('button', { name: `+ ${i18n.t('driver.addChoice')}` }).click();
      await associate.getByRole('button', {
        name: i18n.t('driver.removeChoiceLabel', { label: 'D' }),
        exact: true,
      }).click();
      await associateInputs.nth(0).fill('AUTHORED-ASSOCIATE-A-FINAL-漢字');
      assoc = await associateState();
      expect(assoc.choices.map((c) => c.id)).toStrictEqual(['A', 'B', 'C']);
      expect(assoc.choices[0].text).toStrictEqual('AUTHORED-ASSOCIATE-A-FINAL-漢字');
      expect(assoc.choices[1].text).toStrictEqual('AUTHORED-ASSOCIATE-B-EDIT-Ω');
      expect(assoc.correctPairs).toStrictEqual([]);
      expect(assoc.title).toStrictEqual('AUTHORED-ASSOCIATE-TITLE');
      expect(assoc.bodyHtml).toStrictEqual('<p>AUTHORED-ASSOCIATE-BODY-Ω</p>');
      // The production matrix renders only the three upper-triangle pairs,
      // so self-association/diagonal controls remain unavailable.
      expect(await associate.locator('input[type="checkbox"]').count()).toStrictEqual(3);
      const inline = page.locator('[data-kind="inline"]');
      const inlineState = async (): Promise<{
        title: string;
        bodyHtml: string;
        inlineChoices: Array<{
          id: string;
          label: string;
          required?: boolean;
          shuffle?: boolean;
          correctId?: string;
          options: Array<{ id: string; text?: string; score?: number; fixed?: boolean }>;
        }>;
      }> => JSON.parse(await inline.locator('[data-state="inline"]').innerText());
      const initialInline = await inlineState();
      expect(initialInline.title).toStrictEqual('AUTHORED-INLINE-TITLE-漢字');
      expect(initialInline.bodyHtml.includes('AUTHORED-INLINE-BODY-Ω')).toStrictEqual(true);
      expect(initialInline.inlineChoices.map((slot) => slot.id)).toStrictEqual([
        'RESPONSE_1',
        'RESPONSE_2',
      ]);
      expect((initialInline.bodyHtml.match(/data-qti-inline-choice/g) ?? []).length).toStrictEqual(
        2,
      );
      const inlineInputs = inline.locator('input.ds-input');
      const slotLabelInput = inline.locator('label').filter({
        hasText: i18n.t('driver.slotLabel'),
      }).first().locator('input');
      await slotLabelInput.fill('INLINE-SLOT-EDIT-Ω');
      await inlineInputs.nth(1).fill('A_EDIT');
      await inlineInputs.nth(2).fill('AUTHORED-INLINE-A-EDIT-漢字');
      const inlineChecks = inline.locator('input[type="checkbox"]');
      await inline.locator('label').filter({ hasText: i18n.t('driver.required') }).first()
        .locator('input').uncheck();
      await inline.locator('label').filter({ hasText: i18n.t('driver.shuffleOptions') }).first()
        .locator('input').check();
      await inline.locator('input[type="radio"]').nth(0).check();
      await inlineInputs.nth(3).fill('2.5');
      await inlineChecks.nth(2).check();
      await inline.getByRole('button', { name: `+ ${i18n.t('driver.addOption')}` }).first()
        .click();
      const optionRemoves = inline.getByRole('button', { name: i18n.t('driver.remove') });
      expect(await optionRemoves.count()).toStrictEqual(8);
      // DOM order is slot remove, then the four first-slot option removes;
      // remove the newly-added fourth option without invoking callbacks directly.
      await optionRemoves.nth(4).click();
      await inline.getByRole('button', { name: `+ ${i18n.t('driver.insertInlineChoice')}` })
        .click();
      const removeAfterSlotAdd = inline.getByRole('button', { name: i18n.t('driver.remove') });
      expect(await removeAfterSlotAdd.count()).toStrictEqual(10);
      const withTemporarySlot = await inlineState();
      expect(withTemporarySlot.inlineChoices.map((slot) => slot.id)).toStrictEqual([
        'RESPONSE_1',
        'RESPONSE_2',
        'RESPONSE_3',
      ]);
      if (!(withTemporarySlot.bodyHtml.includes('RESPONSE_3'))) {
        expect.unreachable("Expected withTemporarySlot.bodyHtml.includes('RESPONSE_3')");
      }
      await removeAfterSlotAdd.nth(7).click();
      const finalInline = await inlineState();
      expect(finalInline.title).toStrictEqual('AUTHORED-INLINE-TITLE-漢字');
      expect(finalInline.bodyHtml.includes('AUTHORED-INLINE-BODY-Ω')).toStrictEqual(true);
      expect(finalInline.inlineChoices.map((slot) => slot.id)).toStrictEqual([
        'RESPONSE_1',
        'RESPONSE_2',
      ]);
      expect((finalInline.bodyHtml.match(/data-qti-inline-choice/g) ?? []).length).toStrictEqual(2);
      if (finalInline.bodyHtml.includes('RESPONSE_3')) {
        expect.unreachable("Expected !finalInline.bodyHtml.includes('RESPONSE_3')");
      }
      expect(finalInline.inlineChoices[0].label).toStrictEqual('INLINE-SLOT-EDIT-Ω');
      if (!(finalInline.bodyHtml.includes('INLINE-SLOT-EDIT-Ω'))) {
        expect.unreachable("Expected finalInline.bodyHtml.includes('INLINE-SLOT-EDIT-Ω')");
      }
      expect(finalInline.inlineChoices[0].required).toStrictEqual(false);
      expect(finalInline.inlineChoices[0].shuffle).toStrictEqual(true);
      expect(finalInline.inlineChoices[0].correctId).toStrictEqual('A_EDIT');
      expect(finalInline.inlineChoices[0].options.map((option) => option.id)).toStrictEqual([
        'A_EDIT',
        'B',
        'C',
      ]);
      expect(finalInline.inlineChoices[0].options[0].text).toStrictEqual(
        'AUTHORED-INLINE-A-EDIT-漢字',
      );
      expect(finalInline.inlineChoices[0].options[0].score).toStrictEqual(2.5);
      expect(finalInline.inlineChoices[0].options[0].fixed).toStrictEqual(true);
      const gap = page.locator('[data-kind="gap"]');
      const gapState = async (): Promise<{
        title: string;
        bodyHtml: string;
        responseIdentifier: string;
        gapChoices: Array<{ id: string; text?: string; matchMax?: number; fixed?: boolean }>;
        gaps: Array<{ id: string; label: string }>;
        correctGapPairs: Array<{ gapId: string; choiceId: string }>;
      }> => JSON.parse(await gap.locator('[data-state="gap"]').innerText());
      for (
        const id of [
          'driver.gaps',
          'driver.choiceBank',
          'driver.blankLabel',
          'driver.correctAnswer',
          'driver.addChoice',
        ]
      ) {
        expect(text).toContain(i18n.t(id));
      }
      expect(text).toContain(i18n.t('driver.notPlaced'));
      expect(text).toContain(i18n.t('driver.insertIntoBody'));
      const unplacedCard = gap.getByText(i18n.t('driver.gap', { number: 2 })).locator(
        'xpath=ancestor::div[contains(@class,"rounded-lg")][1]',
      );
      await unplacedCard.getByRole('button', { name: i18n.t('driver.insertIntoBody') }).click();
      let gapAfterInsert = await gapState();
      expect((gapAfterInsert.bodyHtml.match(/data-qti-gap/g) ?? []).length).toStrictEqual(2);
      if (!(gapAfterInsert.bodyHtml.includes('GAP_2'))) {
        expect.unreachable("Expected gapAfterInsert.bodyHtml.includes('GAP_2')");
      }
      await unplacedCard.getByRole('button', { name: i18n.t('driver.remove') }).click();
      gapAfterInsert = await gapState();
      expect(gapAfterInsert.gaps.map((target) => target.id)).toStrictEqual(['GAP_1']);
      expect(gapAfterInsert.correctGapPairs).toStrictEqual([{ gapId: 'GAP_1', choiceId: 'A' }]);
      expect((gapAfterInsert.bodyHtml.match(/data-qti-gap/g) ?? []).length).toStrictEqual(1);
      if (gapAfterInsert.bodyHtml.includes('GAP_2')) {
        expect.unreachable("Expected !gapAfterInsert.bodyHtml.includes('GAP_2')");
      }
      const gapLabelInput = gap.locator('label').filter({ hasText: i18n.t('driver.blankLabel') })
        .first()
        .locator('input');
      await gapLabelInput.fill('GAP-LABEL-EDIT-Ω');
      const gapInputs = gap.locator('input.ds-input');
      await gapInputs.nth(1).fill('A_EDIT');
      await gapInputs.nth(2).fill('AUTHORED-GAP-CHOICE-EDIT-漢字');
      const gapAfterLabel = await gapState();
      expect((gapAfterLabel.bodyHtml.match(/data-qti-gap/g) ?? []).length).toStrictEqual(1);
      if (!(gapAfterLabel.bodyHtml.includes('GAP_1'))) {
        expect.unreachable("Expected gapAfterLabel.bodyHtml.includes('GAP_1')");
      }
      expect(gapAfterLabel.correctGapPairs).toStrictEqual([{ gapId: 'GAP_1', choiceId: 'A_EDIT' }]);
      await gap.locator('select').first().selectOption('B');
      const gapMax = gap.locator('input[type="number"]');
      await gapMax.first().fill('0');
      await gap.locator('input[type="checkbox"]').first().check();
      await gap.getByRole('button', { name: `+ ${i18n.t('driver.addChoice')}` }).click();
      const gapRemoves = gap.getByRole('button', { name: i18n.t('driver.remove') });
      const afterChoiceAdd = await gapState();
      expect(afterChoiceAdd.gapChoices.map((choice) => choice.id)).toStrictEqual([
        'A_EDIT',
        'B',
        'C',
        'A',
      ]);
      await gap.locator('select').first().selectOption('A');
      expect((await gapState()).correctGapPairs).toStrictEqual([{ gapId: 'GAP_1', choiceId: 'A' }]);
      await gapRemoves.last().click();
      expect((await gapState()).correctGapPairs).toStrictEqual([]);
      await gap.locator('select').first().selectOption('B');
      await gap.getByRole('button', { name: `+ ${i18n.t('driver.insertGap')}` }).click();
      const afterGapAdd = await gapState();
      expect(afterGapAdd.gaps.map((target) => target.id)).toStrictEqual(['GAP_1', 'GAP_2']);
      if (!(afterGapAdd.bodyHtml.includes('GAP_2'))) {
        expect.unreachable("Expected afterGapAdd.bodyHtml.includes('GAP_2')");
      }
      if (!(afterGapAdd.bodyHtml.includes(i18n.t('driver.gap', { number: 2 })))) {
        expect.unreachable(
          "Expected afterGapAdd.bodyHtml.includes(i18n.t('driver.gap', { number: 2 }))",
        );
      }
      expect((afterGapAdd.bodyHtml.match(/data-qti-gap/g) ?? []).length).toStrictEqual(2);
      await gap.getByRole('button', { name: i18n.t('driver.remove') }).nth(1).click();
      const finalGap = await gapState();
      expect(finalGap.title).toStrictEqual('AUTHORED-GAP-TITLE-漢字');
      expect(finalGap.responseIdentifier).toStrictEqual('RESPONSE');
      if (!(finalGap.bodyHtml.includes('AUTHORED-GAP-BODY-Ω'))) {
        expect.unreachable("Expected finalGap.bodyHtml.includes('AUTHORED-GAP-BODY-Ω')");
      }
      if (!(finalGap.bodyHtml.includes('GAP-LABEL-EDIT-Ω'))) {
        expect.unreachable("Expected finalGap.bodyHtml.includes('GAP-LABEL-EDIT-Ω')");
      }
      if (finalGap.bodyHtml.includes('GAP_2')) {
        expect.unreachable("Expected !finalGap.bodyHtml.includes('GAP_2')");
      }
      expect((finalGap.bodyHtml.match(/data-qti-gap/g) ?? []).length).toStrictEqual(1);
      expect(finalGap.gaps.map((target) => target.id)).toStrictEqual(['GAP_1']);
      expect(finalGap.gapChoices.map((choice) => choice.id)).toStrictEqual(['A_EDIT', 'B', 'C']);
      expect(finalGap.gapChoices[0].text).toStrictEqual('AUTHORED-GAP-CHOICE-EDIT-漢字');
      expect(finalGap.gapChoices[0].matchMax).toStrictEqual(0);
      expect(finalGap.gapChoices[0].fixed).toStrictEqual(true);
      expect(finalGap.correctGapPairs).toStrictEqual([{ gapId: 'GAP_1', choiceId: 'B' }]);
      // Measure the styled production rows, including long authored text.
      const longSource = 'A long authored source with spaces and Unicode 漢字 Ω '.repeat(5);
      await sourceInput.fill(longSource);
      expect((await readState()).sources[0].text).toStrictEqual(longSource);
      await sourceInput.focus();
      await page.keyboard.press('Tab');
      if (!(await maxInputs.nth(0).evaluate((element) => element === document.activeElement))) {
        expect.unreachable(
          'Expected await maxInputs.nth(0).evaluate((element) => element === document.activeElement)',
        );
      }
      await page.keyboard.press('Tab');
      if (
        !(await match.getByRole('button', {
          name: i18n.t('driver.removeChoiceLabel', { label: longSource.trim() }),
          exact: true,
        }).evaluate((element) => element === document.activeElement))
      ) {
        expect.unreachable(
          "Expected await match.getByRole('button', { name: i18n.t('driver.removeChoiceLabel', { label: longSo",
        );
      }
      await pair.check();
      await pair.focus();
      await page.keyboard.press('Space');
      expect((await readState()).correctPairs).toStrictEqual([]);
      for (const theme of ['wireframe', 'dark']) {
        await page.locator('html').evaluate(
          (element, value) => element.setAttribute('data-theme', value),
          theme,
        );
        for (const width of [320, 390, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          for (const kind of ['match', 'associate']) {
            const section = page.locator(`[data-kind="${kind}"]`);
            const rows = section.locator('[data-authoring-input-row]');
            const metrics = await rows.evaluateAll((elements) =>
              elements.map((row) => {
                const text = row.querySelector('input[type="text"], input:not([type])');
                const limit = row.querySelector('input[type="number"]');
                const remove = row.querySelector('button');
                if (!text || !limit || !remove) throw new Error('Missing authored row control');
                const rect = row.getBoundingClientRect();
                const textRect = text.getBoundingClientRect();
                const limitRect = limit.getBoundingClientRect();
                const removeRect = remove.getBoundingClientRect();
                return {
                  left: rect.left,
                  right: rect.right,
                  height: rect.height,
                  scrollWidth: row.scrollWidth,
                  width: row.clientWidth,
                  textWidth: textRect.width,
                  textRight: textRect.right,
                  textTop: textRect.top,
                  limitTop: limitRect.top,
                  limitRight: limitRect.right,
                  removeLeft: removeRect.left,
                  removeTop: removeRect.top,
                  removeWidth: removeRect.width,
                  removeHeight: removeRect.height,
                  label: remove.getAttribute('aria-label'),
                  title: remove.getAttribute('title'),
                };
              })
            );
            for (const metric of metrics) {
              const context = `${locale}/${theme}/${width}/${kind}: ${JSON.stringify(metric)}`;
              if (!(metric.left >= -1 && metric.right <= width + 1)) expect.unreachable(context);
              if (!(metric.scrollWidth <= metric.width + 1)) expect.unreachable(context);
              if (!(metric.textWidth >= 100)) expect.unreachable(context);
              if (!(metric.textRight <= metric.removeLeft)) expect.unreachable(context);
              if (!(metric.removeWidth >= 44 && metric.removeHeight >= 44)) {
                expect.unreachable(context);
              }
              if (!(metric.label && metric.title === metric.label)) expect.unreachable(context);
              if (!(metric.height <= (width < 640 ? 110 : 65))) expect.unreachable(context);
              if (width >= 640) {
                if (!(Math.abs(metric.textTop - metric.limitTop) < 2)) expect.unreachable(context);
                if (!(metric.limitRight <= metric.removeLeft)) expect.unreachable(context);
              } else {
                if (!(metric.limitTop > metric.textTop)) expect.unreachable(context);
              }
            }
            if (locale === 'en-US' && (width === 390 || width === 1280)) {
              await section.screenshot({ path: `/tmp/qflow-${kind}-rows-${theme}-${width}.png` });
            }
          }
          const checkboxBox = await pair.boundingBox();
          if (!(checkboxBox && checkboxBox.width === 20 && checkboxBox.height === 20)) {
            expect.unreachable(
              'The shared small-checkbox primitive must keep its generated 20-pixel size',
            );
          }
        }
      }
      await sourceInput.fill('AUTHORED-SOURCE-FINAL-Ω');
      const finalText = await body.innerText();
      if (locale.startsWith('es-')) {
        for (
          const phrase of [
            'Sources',
            'Targets',
            'Correct pairs',
            'Inline choice slots',
            'Choice bank',
            'Correct answer',
            'Blank label',
            'Insert gap',
            'Add choice',
            'Placed in body',
          ]
        ) if (finalText.includes(phrase)) expect.unreachable(`${locale} leaked ${phrase}`);
      }
      expect(await page.evaluate(() => globalThis.__ERRORS__)).toStrictEqual([]);
      expect(errors).toStrictEqual([]);
      await page.close();
    }
  } finally {
    await browser?.close();
    await server?.close();
    await _fs.rm(temp, { recursive: true }).catch(() => {});
  }
});
