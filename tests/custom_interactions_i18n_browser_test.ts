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
const customInitial = {
  responseIdentifier: 'RESPONSE-CUSTOM-Ω',
  customBaseType: 'string',
  customCardinality: 'multiple',
  customClassName: 'AUTHORED-CLASS-Ω',
  customDefinition: 'https://example.test/def?q=π',
  customAttributes: [{ name: 'data-one', value: 'ONE-Ω' }, { name: 'data-two', value: 'TWO-Ω' }],
  customInteractionMarkup: '<custom-node attr="&amp;">XML-漢字</custom-node>',
};
const portableInitial = {
  responseIdentifier: 'RESPONSE-PCI-Ω',
  portableCustomTypeIdentifier: 'urn:example:pci:type/π',
  portableDataAttributes: [{ name: 'data-one', value: 'ONE-Ω' }, {
    name: 'data-two',
    value: 'TWO-Ω',
  }],
  portableInteractionMarkup: '<pci-root data-x="&amp;">HTML-漢字</pci-root>',
};
const keys = [
  'customInteractionBaseType',
  'customInteractionCardinality',
  'customInteractionClass',
  'customInteractionDefinition',
  'customInteractionAttributes',
  'attributeAdd',
  'customInteractionMarkup',
  'customInteractionMarkupHelp',
  'portableCustomType',
  'portableCustomAttributes',
  'portableCustomMarkup',
  'portableCustomMarkupHelp',
  'attributeName',
  'attributeValue',
  'remove',
  'customInteractionSingle',
  'customInteractionMultiple',
  'customInteractionOrdered',
  'customInteractionRecord',
] as const;

testCase('Custom and Portable Custom browser i18n and interaction contract', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.custom-browser-'));
    const entry = `${temp}/entry.tsx`, bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import {h, render} from 'preact'; import {useState} from 'preact/hooks';
import {I18nProvider} from "${process.cwd()}/lib/i18n/context.tsx";
import {CustomInteractionContent} from "${process.cwd()}/islands/drivers/custom_interaction.tsx";
import {PortableCustomContent} from "${process.cwd()}/islands/drivers/portable_custom.tsx";
const json=v=>JSON.stringify(v); const noop=()=>{};
function App({config}) { const [c,setC]=useState(config.custom), [p,setP]=useState(config.portable), [cc,setCC]=useState([]), [pc,setPC]=useState([]);
 const cap=(f,n,v)=>f(x=>[...x,{name:n,value:v}]); const patchC=(k,v)=>setC(x=>({...x,[k]:v})); const patchP=(k,v)=>setP(x=>({...x,[k]:v}));
 const ca=(f,i,v)=>setC(x=>({...x,customAttributes:x.customAttributes.map((a,j)=>j===i?{...a,[f]:v}:a)}));
 const pa=(f,i,v)=>setP(x=>({...x,portableDataAttributes:x.portableDataAttributes.map((a,j)=>j===i?{...a,[f]:v}:a)}));
 return h(I18nProvider,{payload:config.payload},h('main',null,
 h('section',{'data-component':'custom'},h(CustomInteractionContent,{...c,renderPromptField:x=>h('input',{placeholder:x}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,
 setResponseIdentifier:v=>patchC('responseIdentifier',v),setCustomBaseType:v=>{patchC('customBaseType',v);cap(setCC,'base-type',v)},setCustomCardinality:v=>{patchC('customCardinality',v);cap(setCC,'cardinality',v)},setCustomClassName:v=>{patchC('customClassName',v);cap(setCC,'class',v)},setCustomDefinition:v=>{patchC('customDefinition',v);cap(setCC,'definition',v)},setCustomInteractionMarkup:v=>{patchC('customInteractionMarkup',v);cap(setCC,'markup',v)},
 addCustomAttribute:()=>{setC(x=>({...x,customAttributes:[...x.customAttributes,{name:'data-three',value:'THREE'}]}));cap(setCC,'add',2)},updateCustomAttributeName:(i,v)=>{ca('name',i,v);cap(setCC,'attr-name',{index:i,value:v})},updateCustomAttributeValue:(i,v)=>{ca('value',i,v);cap(setCC,'attr-value',{index:i,value:v})},removeCustomAttribute:i=>{setC(x=>({...x,customAttributes:x.customAttributes.filter((_,j)=>j!==i)}));cap(setCC,'remove',i)}}),h('output',{'data-state':true},json(c)),h('output',{'data-captures':true},json(cc))),
 h('section',{'data-component':'portable'},h(PortableCustomContent,{...p,renderPromptField:x=>h('input',{placeholder:x}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,
 setResponseIdentifier:v=>patchP('responseIdentifier',v),setPortableCustomTypeIdentifier:v=>{patchP('portableCustomTypeIdentifier',v);cap(setPC,'type',v)},setPortableInteractionMarkup:v=>{patchP('portableInteractionMarkup',v);cap(setPC,'markup',v)},
 addPortableDataAttribute:()=>{setP(x=>({...x,portableDataAttributes:[...x.portableDataAttributes,{name:'data-three',value:'THREE'}]}));cap(setPC,'add',2)},updatePortableDataAttributeName:(i,v)=>{pa('name',i,v);cap(setPC,'attr-name',{index:i,value:v})},updatePortableDataAttributeValue:(i,v)=>{pa('value',i,v);cap(setPC,'attr-value',{index:i,value:v})},removePortableDataAttribute:i=>{setP(x=>({...x,portableDataAttributes:x.portableDataAttributes.filter((_,j)=>j!==i)}));cap(setPC,'remove',i)}}),h('output',{'data-state':true},json(p)),h('output',{'data-captures':true},json(pc))))) }
 globalThis.mount=c=>render(h(App,{config:c}),document.getElementById('root')); globalThis.mount(globalThis.__CONFIG__);`,
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
    const configs = new Map(
      locales.map((
        locale,
      ) => [locale, {
        payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
        custom: customInitial,
        portable: portableInitial,
      }]),
    );
    for (const locale of locales) {
      const sample = createI18n(
        locale,
        createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
      ).t('driver.customInteractionPrompt');
      if (bundleText.includes(sample)) {
        expect.unreachable('Expected !bundleText.includes(sample)');
      }
    }
    const encode = (v: unknown) => JSON.stringify(v).replaceAll('<', '\\u003c');
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
          encode(c)
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
        const custom = page.locator('[data-component="custom"]'),
          portable = page.locator('[data-component="portable"]');
        const customUi = custom.locator(':scope > div'),
          portableUi = portable.locator(':scope > div');
        await custom.getByPlaceholder(i18n.t('driver.customInteractionPrompt')).waitFor();
        expect(await custom.getByPlaceholder(i18n.t('driver.customInteractionPrompt')).count())
          .toStrictEqual(1);
        expect(await portable.getByPlaceholder(i18n.t('driver.portableCustomPrompt')).count())
          .toStrictEqual(1);
        expect(await custom.locator('textarea').getAttribute('placeholder')).toStrictEqual(
          `<div class="custom-interaction">${
            i18n.t('driver.customInteractionMarkupExample')
          }</div>`,
        );
        expect(await portable.locator('textarea').getAttribute('placeholder')).toStrictEqual(
          `<div class="pci-root">${i18n.t('driver.portableCustomMarkupExample')}</div>`,
        );
        expect(JSON.parse(await custom.locator('[data-state]').innerText())).toStrictEqual(
          customInitial,
        );
        expect(JSON.parse(await portable.locator('[data-state]').innerText())).toStrictEqual(
          portableInitial,
        );
        expect(JSON.parse(await custom.locator('[data-captures]').innerText())).toStrictEqual([]);
        expect(JSON.parse(await portable.locator('[data-captures]').innerText())).toStrictEqual([]);
        const text = `${await customUi.innerText()}${await portableUi.innerText()}`;
        const uiHtml = `${await customUi.innerHTML()}${await portableUi.innerHTML()}`;
        for (const key of keys) {
          expect(text).toContain(i18n.t(`driver.${key}`, { number: 1 }));
        }
        // ResponseIdentifierDisclosure intentionally renders no markup; IDs are asserted in state.
        const cBase = custom.getByText(i18n.t('driver.customInteractionBaseType'), {
          exact: true,
        }).locator('..').locator('input');
        expect(await cBase.inputValue()).toStrictEqual('string');
        expect(
          await custom.getByText(i18n.t('driver.customInteractionCardinality'), { exact: true })
            .locator('..').locator('select').inputValue(),
        ).toStrictEqual('multiple');
        expect(
          await custom.getByText(i18n.t('driver.customInteractionClass'), { exact: true })
            .locator('..').locator('input').inputValue(),
        ).toStrictEqual('AUTHORED-CLASS-Ω');
        expect(
          await custom.getByText(i18n.t('driver.customInteractionDefinition'), { exact: true })
            .locator('..').locator('input').inputValue(),
        ).toStrictEqual('https://example.test/def?q=π');
        expect(
          await custom.locator('label').filter({
            hasText: i18n.t('driver.attributeName', { number: 1 }),
          }).locator('input').inputValue(),
        ).toStrictEqual('data-one');
        expect(
          await custom.locator('label').filter({
            hasText: i18n.t('driver.attributeValue', { number: 1 }),
          }).locator('input').inputValue(),
        ).toStrictEqual('ONE-Ω');
        expect(
          await custom.locator('label').filter({
            hasText: i18n.t('driver.attributeName', { number: 2 }),
          }).locator('input').inputValue(),
        ).toStrictEqual('data-two');
        expect(
          await custom.locator('label').filter({
            hasText: i18n.t('driver.attributeValue', { number: 2 }),
          }).locator('input').inputValue(),
        ).toStrictEqual('TWO-Ω');
        expect(await custom.locator('textarea').inputValue()).toStrictEqual(
          customInitial.customInteractionMarkup,
        );
        expect(
          await portable.getByText(i18n.t('driver.portableCustomType'), { exact: true }).locator(
            '..',
          ).locator('input').inputValue(),
        ).toStrictEqual(portableInitial.portableCustomTypeIdentifier);
        expect(
          await portable.locator('label').filter({
            hasText: i18n.t('driver.attributeName', { number: 2 }),
          }).locator('input').inputValue(),
        ).toStrictEqual('data-two');
        expect(
          await portable.locator('label').filter({
            hasText: i18n.t('driver.attributeValue', { number: 2 }),
          }).locator('input').inputValue(),
        ).toStrictEqual('TWO-Ω');
        expect(await portable.locator('textarea').inputValue()).toStrictEqual(
          portableInitial.portableInteractionMarkup,
        );
        const cardinality = custom.getByText(i18n.t('driver.customInteractionCardinality'), {
          exact: true,
        }).locator('..').locator('select');
        for (
          const [value, key] of [
            ['single', 'customInteractionSingle'],
            ['multiple', 'customInteractionMultiple'],
            ['ordered', 'customInteractionOrdered'],
            ['record', 'customInteractionRecord'],
          ] as const
        ) {
          expect(await cardinality.locator(`option[value="${value}"]`).innerText()).toStrictEqual(
            i18n.t(`driver.${key}`),
          );
        }
        for (const n of [1, 2]) {
          expect(
            await custom.getByRole('button', {
              name: i18n.t('driver.attributeRemove', { number: n }),
              exact: true,
            }).count(),
          ).toStrictEqual(1);
        }
        for (const n of [1, 2]) {
          expect(
            await portable.getByRole('button', {
              name: i18n.t('driver.attributeRemove', { number: n }),
              exact: true,
            }).count(),
          ).toStrictEqual(1);
        }
        if (!(!uiHtml.includes('driver.') && !/\{(?:count|plural|select)[^}]*\}/.test(uiHtml))) {
          expect.unreachable(
            "Expected !uiHtml.includes('driver.') && !/\\{(?:count|plural|select)[^}]*\\}/.test(uiHtml)",
          );
        }
        if (locale === 'es-ES' || locale === 'es-419') {
          const en = createI18n('en-US', configs.get('en-US')!.payload.namespaces);
          for (const key of keys) {
            const enValue = en.t(`driver.${key}`, { number: 1 }),
              localValue = i18n.t(`driver.${key}`, { number: 1 });
            if (enValue !== localValue) {
              if (text.includes(enValue)) {
                expect.unreachable('Expected !text.includes(enValue)');
              }
            }
          }
          if (
            en.t('driver.customInteractionPrompt') !== i18n.t('driver.customInteractionPrompt')
          ) {
            expect(await custom.getByPlaceholder(en.t('driver.customInteractionPrompt')).count())
              .toStrictEqual(0);
          }
          if (en.t('driver.portableCustomPrompt') !== i18n.t('driver.portableCustomPrompt')) {
            expect(await portable.getByPlaceholder(en.t('driver.portableCustomPrompt')).count())
              .toStrictEqual(0);
          }
          if (
            en.t('driver.customInteractionMarkupExample') !==
              i18n.t('driver.customInteractionMarkupExample')
          ) {
            if (
              !((await custom.locator('textarea').getAttribute('placeholder')) !==
                `<div class="custom-interaction">${
                  en.t('driver.customInteractionMarkupExample')
                }</div>`)
            ) {
              expect.unreachable(
                "Expected (await custom.locator('textarea').getAttribute('placeholder')) !== `<div class=\"custom-int",
              );
            }
          }
          if (
            en.t('driver.portableCustomMarkupExample') !==
              i18n.t('driver.portableCustomMarkupExample')
          ) {
            if (
              !((await portable.locator('textarea').getAttribute('placeholder')) !==
                `<div class="pci-root">${en.t('driver.portableCustomMarkupExample')}</div>`)
            ) {
              expect.unreachable(
                "Expected (await portable.locator('textarea').getAttribute('placeholder')) !== `<div class=\"pci-root",
              );
            }
          }
          for (const n of [1, 2]) {
            const value = en.t('driver.attributeRemove', { number: n }),
              localValue = i18n.t('driver.attributeRemove', { number: n });
            if (value !== localValue) {
              if (uiHtml.includes(`aria-label="${value}"`)) {
                expect.unreachable('Expected !uiHtml.includes(`aria-label="${value}"`)');
              }
            }
          }
        }
        const base = custom.getByText(i18n.t('driver.customInteractionBaseType'), { exact: true })
          .locator('..').locator('input');
        await base.fill('float');
        await custom.getByText(i18n.t('driver.customInteractionCardinality'), { exact: true })
          .locator('..').locator('select').selectOption('ordered');
        await custom.getByText(i18n.t('driver.customInteractionClass'), { exact: true }).locator(
          '..',
        ).locator('input').fill('EDITED-CLASS');
        await custom.getByText(i18n.t('driver.customInteractionDefinition'), { exact: true })
          .locator('..').locator('input').fill('https://example.test/new');
        const cLabels = custom.locator('label');
        await cLabels.filter({ hasText: i18n.t('driver.attributeName', { number: 1 }) }).locator(
          'input',
        ).fill('data-edited');
        await cLabels.filter({ hasText: i18n.t('driver.attributeValue', { number: 1 }) }).locator(
          'input',
        ).fill('EDITED-VALUE');
        await custom.getByRole('button', {
          name: `+ ${i18n.t('driver.attributeAdd')}`,
          exact: true,
        }).click();
        await custom.getByRole('button', {
          name: i18n.t('driver.attributeRemove', { number: 2 }),
          exact: true,
        }).click();
        await custom.locator('textarea').fill('<edited-custom>Ω</edited-custom>');
        const pLabels = portable.locator('label');
        await pLabels.filter({ hasText: i18n.t('driver.portableCustomType') }).locator('input')
          .fill('urn:edited');
        await pLabels.filter({ hasText: i18n.t('driver.attributeName', { number: 1 }) }).locator(
          'input',
        ).fill('data-edited');
        await pLabels.filter({ hasText: i18n.t('driver.attributeValue', { number: 1 }) }).locator(
          'input',
        ).fill('EDITED-VALUE');
        await portable.getByRole('button', {
          name: `+ ${i18n.t('driver.attributeAdd')}`,
          exact: true,
        }).click();
        await portable.getByRole('button', {
          name: i18n.t('driver.attributeRemove', { number: 2 }),
          exact: true,
        }).click();
        await portable.locator('textarea').fill('<edited-pci>Ω</edited-pci>');
        const afterHtml = `${await customUi.innerHTML()}${await portableUi.innerHTML()}`;
        const afterText = `${await customUi.innerText()}${await portableUi.innerText()}`;
        if (
          !(!afterHtml.includes('driver.') && !/\{(?:count|plural|select)[^}]*\}/.test(afterHtml))
        ) {
          expect.unreachable(
            "Expected !afterHtml.includes('driver.') && !/\\{(?:count|plural|select)[^}]*\\}/.test(afterHtml)",
          );
        }
        if (locale === 'es-ES' || locale === 'es-419') {
          const en = createI18n('en-US', configs.get('en-US')!.payload.namespaces);
          for (const key of keys) {
            const enValue = en.t(`driver.${key}`, { number: 1 }),
              localValue = i18n.t(`driver.${key}`, { number: 1 });
            if (enValue !== localValue) {
              if (afterText.includes(enValue)) {
                expect.unreachable('Expected !afterText.includes(enValue)');
              }
            }
          }
          if (
            en.t('driver.customInteractionPrompt') !== i18n.t('driver.customInteractionPrompt')
          ) {
            expect(await custom.getByPlaceholder(en.t('driver.customInteractionPrompt')).count())
              .toStrictEqual(0);
          }
          if (en.t('driver.portableCustomPrompt') !== i18n.t('driver.portableCustomPrompt')) {
            expect(await portable.getByPlaceholder(en.t('driver.portableCustomPrompt')).count())
              .toStrictEqual(0);
          }
          if (
            en.t('driver.customInteractionMarkupExample') !==
              i18n.t('driver.customInteractionMarkupExample')
          ) {
            if (
              !((await custom.locator('textarea').getAttribute('placeholder')) !==
                `<div class="custom-interaction">${
                  en.t('driver.customInteractionMarkupExample')
                }</div>`)
            ) {
              expect.unreachable(
                "Expected (await custom.locator('textarea').getAttribute('placeholder')) !== `<div class=\"custom-int",
              );
            }
          }
          if (
            en.t('driver.portableCustomMarkupExample') !==
              i18n.t('driver.portableCustomMarkupExample')
          ) {
            if (
              !((await portable.locator('textarea').getAttribute('placeholder')) !==
                `<div class="pci-root">${en.t('driver.portableCustomMarkupExample')}</div>`)
            ) {
              expect.unreachable(
                "Expected (await portable.locator('textarea').getAttribute('placeholder')) !== `<div class=\"pci-root",
              );
            }
          }
          for (const n of [1, 2]) {
            const value = en.t('driver.attributeRemove', { number: n }),
              localValue = i18n.t('driver.attributeRemove', { number: n });
            if (value !== localValue) {
              if (afterHtml.includes(`aria-label="${value}"`)) {
                expect.unreachable('Expected !afterHtml.includes(`aria-label="${value}"`)');
              }
            }
          }
        }
        for (const n of [1, 2]) {
          expect(
            await custom.getByRole('button', {
              name: i18n.t('driver.attributeRemove', { number: n }),
              exact: true,
            }).count(),
          ).toStrictEqual(1);
          expect(
            await portable.getByRole('button', {
              name: i18n.t('driver.attributeRemove', { number: n }),
              exact: true,
            }).count(),
          ).toStrictEqual(1);
        }
        expect(JSON.parse(await custom.locator('[data-captures]').innerText())).toStrictEqual([
          { name: 'base-type', value: 'float' },
          { name: 'cardinality', value: 'ordered' },
          { name: 'class', value: 'EDITED-CLASS' },
          { name: 'definition', value: 'https://example.test/new' },
          { name: 'attr-name', value: { index: 0, value: 'data-edited' } },
          { name: 'attr-value', value: { index: 0, value: 'EDITED-VALUE' } },
          { name: 'add', value: 2 },
          { name: 'remove', value: 1 },
          { name: 'markup', value: '<edited-custom>Ω</edited-custom>' },
        ]);
        expect(JSON.parse(await portable.locator('[data-captures]').innerText())).toStrictEqual([
          { name: 'type', value: 'urn:edited' },
          { name: 'attr-name', value: { index: 0, value: 'data-edited' } },
          { name: 'attr-value', value: { index: 0, value: 'EDITED-VALUE' } },
          { name: 'add', value: 2 },
          { name: 'remove', value: 1 },
          { name: 'markup', value: '<edited-pci>Ω</edited-pci>' },
        ]);
        expect(JSON.parse(await custom.locator('[data-state]').innerText())).toStrictEqual({
          responseIdentifier: 'RESPONSE-CUSTOM-Ω',
          customBaseType: 'float',
          customCardinality: 'ordered',
          customClassName: 'EDITED-CLASS',
          customDefinition: 'https://example.test/new',
          customAttributes: [{ name: 'data-edited', value: 'EDITED-VALUE' }, {
            name: 'data-three',
            value: 'THREE',
          }],
          customInteractionMarkup: '<edited-custom>Ω</edited-custom>',
        });
        expect(JSON.parse(await portable.locator('[data-state]').innerText())).toStrictEqual({
          responseIdentifier: 'RESPONSE-PCI-Ω',
          portableCustomTypeIdentifier: 'urn:edited',
          portableDataAttributes: [{ name: 'data-edited', value: 'EDITED-VALUE' }, {
            name: 'data-three',
            value: 'THREE',
          }],
          portableInteractionMarkup: '<edited-pci>Ω</edited-pci>',
        });
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
