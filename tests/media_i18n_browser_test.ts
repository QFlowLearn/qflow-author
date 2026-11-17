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
testCase('media authoring state is localized in every locale', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let temp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    temp = await _fs.mkdtemp(_path.join(process.cwd(), '.media-browser-'));
    const entry = `${temp}/entry.tsx`, bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `import {h,render} from "preact";import {useState} from "preact/hooks";import {I18nProvider} from "${process.cwd()}/lib/i18n/context.tsx";import {MediaContent} from "${process.cwd()}/islands/drivers/media.tsx";function App({config}){const [s,setS]=useState(config.state);const patch=p=>setS(x=>({...x,...p}));const map=(i,p)=>patch({mediaSources:s.mediaSources.map((m,j)=>j===i?({...m,...p}):m)});return h(I18nProvider,{payload:config.payload},h('main',null,h(MediaContent,{renderPromptField:p=>h('input',{placeholder:p}),fieldHasIssue:()=>false,fieldIssueText:()=>undefined,imageComposition:{bodyHtml:'<p>AUTHORED-BODY-Ω</p>',promptHtml:'AUTHORED-PROMPT-漢字',accessibleDescription:s.mediaObjectLabel},responseIdentifier:s.responseIdentifier,mediaKind:s.mediaKind,mediaSources:s.mediaSources,mediaCaptionSrc:s.mediaCaptionSrc,mediaCaptionLang:s.mediaCaptionLang,mediaTranscript:s.mediaTranscript,mediaObjectLabel:s.mediaObjectLabel,setResponseIdentifier:v=>patch({responseIdentifier:v}),setMediaKind:v=>patch({mediaKind:v}),setMediaCaptionSrc:v=>patch({mediaCaptionSrc:v}),setMediaCaptionLang:v=>patch({mediaCaptionLang:v}),setMediaTranscript:v=>patch({mediaTranscript:v}),setMediaObjectLabel:v=>patch({mediaObjectLabel:v}),setPrimaryMediaSource:v=>patch({mediaSources:s.mediaSources.length?[v,...s.mediaSources.slice(1)]:[v]}),clearPrimaryMediaSource:()=>patch({mediaSources:s.mediaSources.slice(1)}),addMediaSource:()=>patch({mediaSources:[...s.mediaSources,{src:'',type:''}]}),updateMediaSourceSrc:(i,v)=>map(i,{src:v}),updateMediaSourceType:(i,v)=>map(i,{type:v}),removeMediaSource:i=>patch({mediaSources:s.mediaSources.filter((_,j)=>j!==i)})}),h('output',{'data-state':'media'},JSON.stringify(s))));}globalThis.mount=c=>render(h(App,{config:c}),document.getElementById('root'));globalThis.mount(globalThis.__CONFIG__);`,
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
      const forbidden of [
        'catalogForLocale',
        'CATALOGS',
        'lib/i18n/messages/',
        'lib/i18n/catalogs.ts',
        'lib/i18n/player_messages/',
        'playerMessageCatalogForLocale',
      ]
    ) {
      if (bundleText.includes(forbidden)) {
        expect.unreachable('Expected !bundleText.includes(forbidden)');
      }
    }
    const configs = new Map(locales.map((locale) => [locale, {
      payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      state: {
        responseIdentifier: 'RESPONSE_Ω',
        mediaKind: 'object',
        mediaSources: [
          { src: '/media/video.mp4', type: 'video/mp4' },
          { src: '/media/audio.ogg', type: 'audio/ogg' },
        ],
        mediaCaptionSrc: '',
        mediaCaptionLang: 'en',
        mediaTranscript: '',
        mediaObjectLabel: '<b>AUTHORED-LABEL</b>',
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
      if (u.pathname === '/media/video.mp4' || u.pathname === '/media/audio.ogg') {
        return new Response(new Uint8Array([0]), {
          headers: { 'content-type': u.pathname.endsWith('.ogg') ? 'audio/ogg' : 'video/mp4' },
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
      const pe: string[] = [], ce: string[] = [];
      page.on('pageerror', (e) => pe.push(e.message));
      page.on('console', (m) => m.type() === 'error' && ce.push(m.text()));
      try {
        const i18n = createI18n(locale, configs.get(locale)!.payload.namespaces);
        await page.goto(`http://${a.hostname}:${a.port}/?locale=${locale}`, {
          waitUntil: 'domcontentloaded',
        });
        const out = page.locator('[data-state=media]');
        const state = async () => JSON.parse(await out.innerText());
        const text = async () =>
          (await page.locator('body').innerText()).replace(await out.innerText(), '');
        const safe = async () => {
          const t = await text();
          if (!(!t.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(t))) {
            expect.unreachable(
              "Expected !t.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(t)",
            );
          }
          if (locale === 'es-ES' || locale === 'es-419') {
            for (
              const p of [
                'What are learners opening?',
                'Media file',
                'Accessible description',
                'Advanced source settings',
                'Add alternate source',
                'Primary source',
                'Alternate source',
                'Captions (VTT URL)',
                'Caption language',
                'Plain text transcript',
              ]
            ) if (t.includes(p)) expect.unreachable('Expected !t.includes(p)');
          }
          expect(pe).toStrictEqual([]);
          expect(ce).toStrictEqual([]);
          expect(
            await page.evaluate(() =>
              (globalThis as unknown as { __UNHANDLED__: unknown[] }).__UNHANDLED__
            ),
          ).toStrictEqual([]);
        };
        await page.getByText(i18n.t('driver.mediaFile'), { exact: true }).waitFor();
        expect(await state()).toStrictEqual({
          responseIdentifier: 'RESPONSE_Ω',
          mediaKind: 'object',
          mediaSources: [
            { src: '/media/video.mp4', type: 'video/mp4' },
            { src: '/media/audio.ogg', type: 'audio/ogg' },
          ],
          mediaCaptionSrc: '',
          mediaCaptionLang: 'en',
          mediaTranscript: '',
          mediaObjectLabel: '<b>AUTHORED-LABEL</b>',
        });
        expect(await page.getByPlaceholder(i18n.t('driver.mediaPrompt')).count()).toStrictEqual(1);
        for (
          const key of [
            'mediaOpeningLabel',
            'mediaFile',
            'mediaAccessibleDescription',
            'mediaAdvancedSettings',
            'mediaAddAlternate',
          ] as const
        ) {
          expect(await page.getByText(i18n.t(`driver.${key}`), { exact: true }).count())
            .toStrictEqual(1);
        }
        expect(
          await page.locator('select option').evaluateAll((options) =>
            options.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent }))
          ),
        ).toStrictEqual([
          { value: 'video', text: i18n.t('driver.mediaVideo') },
          { value: 'audio', text: i18n.t('driver.mediaAudio') },
          { value: 'object', text: i18n.t('driver.mediaImageDocument') },
        ]);
        expect(
          await page.locator(
            `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 1 })}"]`,
          ).count(),
        ).toStrictEqual(1);
        expect(
          await page.locator(
            `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 2 })}"]`,
          ).count(),
        ).toStrictEqual(1);
        expect(await page.locator('input[placeholder="assets/media.mp4"]').count()).toStrictEqual(
          2,
        );
        expect(await page.locator('input[placeholder="video/mp4"]').count()).toStrictEqual(2);
        expect(
          await page.locator('button').filter({
            hasText: i18n.t('editor.mediaReplace', { kind: i18n.t('editor.mediaKindImagePdf') }),
          }).count(),
        ).toStrictEqual(1);
        expect(
          await page.getByText(
            `${i18n.t('editor.mediaUploadHelper', { kind: i18n.t('editor.mediaKindImagePdf') })} ${
              i18n.t('editor.mediaLimit')
            }`,
            { exact: true },
          ).count(),
        ).toStrictEqual(1);
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        await safe();
        const field = (label: string) =>
          page.locator('label').filter({ hasText: label }).locator('input,textarea,select')
            .last();
        const details = page.locator('details');
        const ensureDetails = async (open: boolean) => {
          const isOpen = await details.getAttribute('open') !== null;
          if (isOpen !== open) await details.locator('summary').click();
        };
        const assertUpload = async (kind: 'object' | 'video' | 'audio', populated: boolean) => {
          const labelKey = kind === 'object'
            ? 'editor.mediaKindImagePdf'
            : kind === 'video'
            ? 'editor.mediaKindVideo'
            : 'editor.mediaKindAudio';
          const kindLabel = i18n.t(labelKey);
          const control = i18n.t(populated ? 'editor.mediaReplace' : 'editor.mediaUpload', {
            kind: kindLabel,
          });
          expect(await page.locator('button').filter({ hasText: control }).count()).toStrictEqual(
            1,
          );
          const helper = kind === 'object'
            ? i18n.t('editor.mediaLimit')
            : i18n.t('editor.mediaLimitSingle', { max: 24 });
          expect(
            await page.getByText(
              `${i18n.t('editor.mediaUploadHelper', { kind: kindLabel })} ${helper}`,
              {
                exact: true,
              },
            ).count(),
          ).toStrictEqual(1);
          expect(await page.getByText(i18n.t('driver.mediaCaptions'), { exact: true }).count())
            .toStrictEqual(kind === 'object' ? 0 : 1);
          expect(await page.getByText(i18n.t('driver.mediaTranscript'), { exact: true }).count())
            .toStrictEqual(kind === 'object' ? 0 : 1);
        };
        const clearAndSeed = async (kind: 'object' | 'video' | 'audio') => {
          await assertUpload(kind, true);
          const before = (await state()).mediaSources;
          await page.getByRole('button', { name: i18n.t('editor.mediaRemoveFile') }).click();
          if (before.length === 2) {
            expect((await state()).mediaSources).toStrictEqual([before[1]]);
            await ensureDetails(true);
            await page.locator(
              `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 1 })}"]`,
            ).click();
            expect((await state()).mediaSources).toStrictEqual([]);
          } else {
            expect((await state()).mediaSources).toStrictEqual([]);
          }
          await assertUpload(kind, false);
          await safe();
          await ensureDetails(true);
          await page.getByRole('button', { name: i18n.t('driver.mediaAddAlternate') }).click();
          await page.locator('input[placeholder="assets/media.mp4"]').first().fill(
            '/media/video.mp4',
          );
          await page.locator('input[placeholder="video/mp4"]').first().fill(
            kind === 'audio' ? 'audio/ogg' : 'video/mp4',
          );
          expect((await state()).mediaSources).toStrictEqual([{
            src: '/media/video.mp4',
            type: kind === 'audio' ? 'audio/ogg' : 'video/mp4',
          }]);
          await ensureDetails(false);
          await assertUpload(kind, true);
          await safe();
        };
        await field(i18n.t('driver.mediaAccessibleDescription')).fill('LABEL-EDITED-Ω');
        expect((await state()).mediaObjectLabel).toStrictEqual('LABEL-EDITED-Ω');
        await field(i18n.t('driver.mediaAccessibleDescription')).fill('');
        expect((await state()).mediaObjectLabel).toStrictEqual('');
        await clearAndSeed('object');
        await field(i18n.t('driver.mediaOpeningLabel')).selectOption('video');
        expect((await state()).mediaKind).toStrictEqual('video');
        expect(
          await page.locator('button').filter({
            hasText: i18n.t('editor.mediaReplace', { kind: i18n.t('editor.mediaKindVideo') }),
          }).count(),
        ).toStrictEqual(1);
        expect(await page.getByText(i18n.t('driver.mediaCaptions'), { exact: true }).count())
          .toStrictEqual(1);
        expect(await page.getByText(i18n.t('driver.mediaTranscript'), { exact: true }).count())
          .toStrictEqual(1);
        expect(
          await page.getByText(
            `${i18n.t('editor.mediaUploadHelper', { kind: i18n.t('editor.mediaKindVideo') })} ${
              i18n.t('editor.mediaLimitSingle', { max: 24 })
            }`,
            { exact: true },
          ).count(),
        ).toStrictEqual(1);
        await field(i18n.t('driver.mediaCaptionLanguage')).fill('fr-CA');
        await field(i18n.t('driver.mediaCaptions')).fill('assets/captions.vtt');
        await field(i18n.t('driver.mediaTranscript')).fill('TRANSCRIPT-Ω');
        expect((await state()).mediaCaptionSrc).toStrictEqual('assets/captions.vtt');
        expect((await state()).mediaCaptionLang).toStrictEqual('fr-CA');
        expect((await state()).mediaTranscript).toStrictEqual('TRANSCRIPT-Ω');
        await clearAndSeed('video');
        await field(i18n.t('driver.mediaOpeningLabel')).selectOption('audio');
        expect((await state()).mediaKind).toStrictEqual('audio');
        expect((await state()).mediaCaptionSrc).toStrictEqual('assets/captions.vtt');
        expect((await state()).mediaCaptionLang).toStrictEqual('fr-CA');
        expect(
          await page.getByText(
            `${i18n.t('editor.mediaUploadHelper', { kind: i18n.t('editor.mediaKindAudio') })} ${
              i18n.t('editor.mediaLimitSingle', { max: 24 })
            }`,
            { exact: true },
          ).count(),
        ).toStrictEqual(1);
        await field(i18n.t('driver.mediaCaptionLanguage')).fill('es-419');
        await field(i18n.t('driver.mediaTranscript')).fill('AUDIO-Ω');
        expect((await state()).mediaCaptionSrc).toStrictEqual('assets/captions.vtt');
        expect((await state()).mediaCaptionLang).toStrictEqual('es-419');
        expect((await state()).mediaTranscript).toStrictEqual('AUDIO-Ω');
        await clearAndSeed('audio');
        await field(i18n.t('driver.mediaOpeningLabel')).selectOption('object');
        expect((await state()).mediaCaptionSrc).toStrictEqual('assets/captions.vtt');
        expect((await state()).mediaCaptionLang).toStrictEqual('es-419');
        expect((await state()).mediaTranscript).toStrictEqual('AUDIO-Ω');
        expect((await state()).mediaObjectLabel).toStrictEqual('');
        expect(
          await page.getByText(i18n.t('driver.mediaAccessibleDescription'), { exact: true })
            .count(),
        ).toStrictEqual(1);
        expect(await page.getByText(i18n.t('driver.mediaCaptions'), { exact: true }).count())
          .toStrictEqual(0);
        expect(await page.getByText(i18n.t('driver.mediaTranscript'), { exact: true }).count())
          .toStrictEqual(0);
        await page.getByText(i18n.t('driver.mediaAdvancedSettings'), { exact: true }).click();
        const src = field(i18n.t('driver.mediaPrimarySource'));
        await src.fill('assets/edited.mp4');
        const mime = page.locator('input[placeholder="video/mp4"]').first();
        await mime.fill('video/webm');
        await page.getByRole('button', { name: i18n.t('driver.mediaAddAlternate') }).click();
        const alternate = page.locator('input[placeholder="assets/media.mp4"]').nth(1);
        await alternate.fill('assets/alternate.webm');
        const alternateMime = page.locator('input[placeholder="video/mp4"]').nth(1);
        await alternateMime.fill('video/ogg');
        expect((await state()).mediaSources).toStrictEqual([
          { src: 'assets/edited.mp4', type: 'video/webm' },
          { src: 'assets/alternate.webm', type: 'video/ogg' },
        ]);
        await page.locator(
          `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 1 })}"]`,
        ).click();
        expect((await state()).mediaSources).toStrictEqual([{
          src: 'assets/alternate.webm',
          type: 'video/ogg',
        }]);
        expect(
          await page.locator(
            `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 1 })}"]`,
          ).count(),
        ).toStrictEqual(1);
        expect(
          await page.locator(
            `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 2 })}"]`,
          ).count(),
        ).toStrictEqual(0);
        await page.getByRole('button', { name: i18n.t('driver.mediaAddAlternate') }).click();
        expect((await state()).mediaSources).toStrictEqual([
          { src: 'assets/alternate.webm', type: 'video/ogg' },
          { src: '', type: '' },
        ]);
        expect(
          await page.locator(
            `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 1 })}"]`,
          ).count(),
        ).toStrictEqual(1);
        expect(
          await page.locator(
            `button[aria-label="${i18n.t('driver.mediaRemoveSource', { number: 2 })}"]`,
          ).count(),
        ).toStrictEqual(1);
        expect((await state()).responseIdentifier).toStrictEqual('RESPONSE_Ω');
        await safe();
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
