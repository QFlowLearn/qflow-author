import { expect, test as testCase } from 'vitest';

import type { FetchFixtureServer } from './helpers/fetch_server.ts';
import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const itemOne = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Éxito ✨',
  excerpt: '',
  tags: ['tag-ñ'],
  latestRev: 4,
  updatedAt: '2026-01-02T03:04:05.000Z',
  type: 'single_select',
};
const itemTwo = {
  id: '22222222-2222-4222-8222-222222222222',
  title: '',
  excerpt: '',
  tags: ['page-2'],
  latestRev: 2,
  updatedAt: '2026-02-03T04:05:06.000Z',
  type: 'text_entry',
};

type Mode =
  | 'normal'
  | 'search-error'
  | 'search-malformed'
  | 'import-http'
  | 'import-malformed'
  | 'stale';
type BrowserState = {
  mode: Mode;
  searchRequests: Array<
    { q: string; tags: string; page: string; pageSize: string; receivedAt: number }
  >;
  importRequests: number;
  importRequestsTotal: number;
  documentRequests: number;
  releaseOld: (() => void) | null;
  oldReturned: boolean;
  firstSearchFailure: boolean;
};

function browserEntrySource(): string {
  const root = process.cwd();
  return `
    import { h, render } from 'preact';
    import { useState } from 'preact/hooks';
    import { I18nProvider } from ${JSON.stringify(`${root}/lib/i18n/context.tsx`)};
    import QuestionTypePicker from ${
      JSON.stringify(`${root}/islands/assessment_builder/QuestionTypePicker.tsx`)
    };
    import ImportPicker from ${
      JSON.stringify(`${root}/islands/assessment_builder/ImportPicker.tsx`)
    };
    const rootNode = document.getElementById('root');
    const config = globalThis.__PICKER_CONFIG__;
    function PickerApp() {
      const [search, setSearch] = useState('');
          const selected = (value) => {
            const values = globalThis.__SELECTED_TYPES__ ??= [];
            values.push(value);
          };
      return h(I18nProvider, { payload: config.payload },
        h('main', null,
          h(QuestionTypePicker, { search, onSearchChange: setSearch, onStartAuthoring: selected, lastType: 'single_select' }),
          h(ImportPicker, { assessmentId: 'assessment-1', partId: '44444444-4444-4444-8444-444444444444', partTitle: 'Part 1', existingItemIds: new Set(), onAdded: () => {}, previewContext: { payload: config.payload, playerCatalog: config.playerCatalog } }),
        ));
    }
    render(h(PickerApp, null), rootNode);
  `;
}

async function waitUntil(predicate: () => boolean, timeout = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('browser harness condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

testCase('assessment builder picker browser interactions stay localized and preserve contracts', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.assessment-picker-browser-'));
  let server: FetchFixtureServer | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let state: BrowserState = {
    mode: 'normal',
    searchRequests: [],
    importRequests: 0,
    importRequestsTotal: 0,
    documentRequests: 0,
    releaseOld: null,
    oldReturned: false,
    firstSearchFailure: true,
  };
  try {
    const entry = `${temp}/entry.tsx`;
    const bundle = `${temp}/bundle.js`;
    await _fs.writeFile(entry, browserEntrySource(), 'utf8');
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=iife',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      '--loader:.css=empty',
      `--outfile=${bundle}`,
    ], { cwd: process.cwd() });
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const bundleText = await _fs.readFile(bundle, 'utf8');
    if (bundleText.includes('catalogForLocale')) {
      expect.unreachable("Expected !bundleText.includes('catalogForLocale')");
    }
    if (bundleText.includes('CATALOGS')) {
      expect.unreachable("Expected !bundleText.includes('CATALOGS')");
    }
    if (bundleText.includes('lib/i18n/messages/')) {
      expect.unreachable("Expected !bundleText.includes('lib/i18n/messages/')");
    }
    if (bundleText.includes('lib/i18n/catalogs.ts')) {
      expect.unreachable("Expected !bundleText.includes('lib/i18n/catalogs.ts')");
    }
    if (bundleText.includes('lib/i18n/player_messages/')) {
      expect.unreachable("Expected !bundleText.includes('lib/i18n/player_messages/')");
    }

    state = {
      mode: 'normal',
      searchRequests: [],
      importRequests: 0,
      importRequestsTotal: 0,
      documentRequests: 0,
      releaseOld: null,
      oldReturned: false,
      firstSearchFailure: true,
    };
    server = await startFetchServer(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/bundle.js') {
        return new Response(await _fs.readFile(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      if (url.pathname === '/api/items/search') {
        const respond = (body: Record<string, unknown>) =>
          Response.json({
            collections: [],
            enrichment: { schemes: [], schemesTruncated: false, selection: null },
            ...body,
          });
        const q = url.searchParams.get('q') ?? '';
        const tags = url.searchParams.get('tags') ?? '';
        const page = url.searchParams.get('page') ?? '';
        const pageSize = url.searchParams.get('pageSize') ?? '';
        expect(url.searchParams.has('limit')).toStrictEqual(false);
        expect(url.searchParams.has('offset')).toStrictEqual(false);
        state.searchRequests.push({ q, tags, page, pageSize, receivedAt: Date.now() });
        // Fail the requested search, independent of the immediate initial load.
        if (state.mode === 'search-error' && q === 'new' && state.firstSearchFailure) {
          state.firstSearchFailure = false;
          return Response.json({ error: 'HOSTILE_SEARCH_PROSE' }, { status: 503 });
        }
        if (state.mode === 'search-malformed' && q === 'new' && state.firstSearchFailure) {
          state.firstSearchFailure = false;
          return respond({
            items: [{ title: 'HOSTILE_SEARCH_ITEM' }],
            hasMore: false,
            total: 1,
          });
        }
        if (state.mode === 'stale' && q === 'old') {
          await new Promise<void>((resolve) => state.releaseOld = resolve);
          state.oldReturned = true;
          return respond({
            items: [{ ...itemOne, title: 'OLD-STALE-HOSTILE' }],
            hasMore: false,
            total: 1,
          });
        }
        if (q === 'page' && page === '1') {
          return respond({ items: [itemOne], hasMore: true, total: 11 });
        }
        if (q === 'page' && page === '2') {
          return respond({ items: [itemTwo], hasMore: false, total: 11 });
        }
        if (q === 'new' || q === 'ok' || q === 'clip' || q === 'old') {
          return respond({ items: [itemOne], hasMore: false, total: 1 });
        }
        return respond({ items: [], hasMore: false, total: 0 });
      }
      if (
        url.pathname === '/api/assessments/assessment-1/placements' && request.method === 'POST'
      ) {
        state.importRequests += 1;
        state.importRequestsTotal += 1;
        if (state.mode === 'import-http' && state.importRequests === 1) {
          return Response.json({ error: 'HOSTILE_IMPORT_PROSE' }, { status: 500 });
        }
        if (state.mode === 'import-malformed' && state.importRequests === 1) {
          return Response.json({ id: 'not-a-canonical-id' });
        }
        const command = await request.json();
        return Response.json({
          partId: command.partId,
          items: command.items.map((
            item: { placementId: string; itemId: string; revision: number },
          ) => ({
            placementId: item.placementId,
            itemId: item.itemId,
            revision: item.revision,
            draft: {
              ...TYPE_DRIVERS.single_select.defaults(),
              type: 'single_select',
              title: 'Éxito ✨',
              itemLanguage: 'en-US',
            },
          })),
        });
      }
      if (url.pathname === '/') {
        state.documentRequests += 1;
        const locale = url.searchParams.get('locale') ?? 'en-US';
        state.mode = (url.searchParams.get('mode') as Mode | null) ?? 'normal';
        state.firstSearchFailure = true;
        state.importRequests = 0;
        state.searchRequests = [];
        state.oldReturned = false;
        return new Response(
          `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"></head><body><div id="root"></div><script>globalThis.__PICKER_CONFIG__=${
            JSON.stringify({
              playerCatalog: playerMessageCatalogForLocale(locale as typeof locales[number]),
              payload: createI18nPayload(
                locale as typeof locales[number],
                catalogForLocale(locale as typeof locales[number]),
                ['assessments', 'items', 'authoring'],
              ),
            })
          };</script><script src="/bundle.js"></script></body></html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      return new Response('not found', { status: 404 });
    });
    browser = await chromium.launch();
    const base = `http://${'127.0.0.1'}:${server.port}`;
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage({
        timezoneId: 'Europe/Stockholm',
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          !message.text().startsWith(
            'Failed to load resource: the server responded with a status of',
          )
        ) errors.push(message.text());
      });
      await page.addInitScript(() => {
        const events: string[] = [];
        (globalThis as typeof globalThis & { __BROWSER_ERRORS__?: string[] }).__BROWSER_ERRORS__ =
          events;
        addEventListener('error', (event) => events.push(String(event.message)));
        addEventListener('unhandledrejection', (event) => events.push(String(event.reason)));
      });
      try {
        const catalog = catalogForLocale(locale).assessments!;
        const i18n = createI18n(locale, { assessments: catalog });
        await page.goto(`${base}/?locale=${locale}&mode=normal`);
        const searchLabel = catalog['assessments.builder.questionTypeSearchLabel'];
        const search = page.getByLabel(searchLabel);
        await search.waitFor();
        expect(await page.locator('label[for="assessment-question-type-search"]').innerText())
          .toContain(searchLabel);
        await page.getByText(catalog['assessments.builder.library.empty'], { exact: true })
          .waitFor();
        expect(await page.locator('body').innerText()).toContain(
          i18n.t('assessments.builder.library.results', { count: 0 }),
        );
        const singleLabel = i18n.t('assessments.builder.questionTypeLabel', {
          type: 'single_select',
        });
        const singleDescription = i18n.t(
          'assessments.builder.questionTypeDescription.single_select',
        );
        const textDescription = i18n.t(
          'assessments.builder.questionTypeDescription.text_entry',
        );
        await search.fill(singleLabel);
        await page.locator('[data-type-option]').count().then((count) =>
          expect(count).toStrictEqual(1)
        );
        expect(await page.locator('[data-type-option]').first().innerText()).toContain(singleLabel);
        expect(await page.locator('[data-type-option]').first().innerText()).toContain(
          singleDescription,
        );
        await page.locator('[data-type-option]').first().click();
        await page.waitForFunction(() =>
          (globalThis as typeof globalThis & { __SELECTED_TYPES__?: string[] }).__SELECTED_TYPES__
            ?.at(-1) === 'single_select'
        );
        await search.fill(textDescription);
        await page.locator('[data-type-option]').count().then((count) =>
          expect(count).toStrictEqual(1)
        );
        expect(await page.locator('[data-type-option]').first().innerText()).toContain(
          textDescription,
        );
        await page.locator('[data-type-option]').first().click();
        await page.waitForFunction(() =>
          (globalThis as typeof globalThis & { __SELECTED_TYPES__?: string[] }).__SELECTED_TYPES__
            ?.at(-1) === 'text_entry'
        );
        await page.getByRole('button', { name: catalog['assessments.builder.clearSearch'] })
          .click();
        await page.locator('[data-type-option]').first().waitFor();
        await search.press('ArrowDown');
        await page.locator('[data-type-option]').first().press('Enter');
        await page.waitForFunction(() =>
          (globalThis as typeof globalThis & { __SELECTED_TYPES__?: string[] }).__SELECTED_TYPES__
            ?.includes('single_select') === true
        );
        await page.locator('[data-type-option]').nth(1).waitFor();
        await page.locator('[data-type-option]').nth(1).click();
        await page.waitForFunction(() =>
          (globalThis as typeof globalThis & { __SELECTED_TYPES__?: string[] }).__SELECTED_TYPES__
            ?.includes('multi_select') === true
        );
        await search.focus();
        await search.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        expect(await page.evaluate(() => document.activeElement?.getAttribute('data-type-option')))
          .toStrictEqual('true');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() =>
          (globalThis as typeof globalThis & { __SELECTED_TYPES__?: string[] }).__SELECTED_TYPES__
            ?.at(-1) === 'single_select'
        );
        await search.fill('no-match');
        await page.getByText(catalog['assessments.builder.questionTypeNoMatches']).waitFor();
        await page.getByRole('button', { name: catalog['assessments.builder.clearSearch'] })
          .click();
        const librarySearch = page.getByLabel(catalog['assessments.builder.library.search']);
        const beforeNew = state.searchRequests.length;
        await librarySearch.fill('new');
        await page.locator('summary').filter({
          hasText: catalog['assessments.builder.library.tags'],
        }).click();
        const tagInput = page.getByLabel(catalog['assessments.builder.library.tags']);
        await tagInput.fill('tag ñ');
        const finalChanged = Date.now();
        expect(state.searchRequests.length).toStrictEqual(beforeNew);
        await waitUntil(() => state.searchRequests.some((request) => request.q === 'new'));
        const encodedRequest = state.searchRequests.find((request) => request.q === 'new');
        expect(encodedRequest?.tags).toStrictEqual('tag ñ');
        expect(encodedRequest?.page).toStrictEqual('1');
        expect(encodedRequest?.pageSize).toStrictEqual('10');
        if (!((encodedRequest?.receivedAt ?? 0) - finalChanged >= 250)) {
          expect.unreachable('Expected (encodedRequest?.receivedAt ?? 0) - finalChanged >= 250');
        }
        await page.waitForFunction(() =>
          document.body.innerText.includes('Éxito ✨') ||
          document.body.innerText.includes('Library search failed')
        );
        expect(await page.locator('body').innerText()).toContain('Éxito ✨');
        expect(await page.locator('body').innerText()).toContain(
          i18n.t('assessments.builder.library.results', { count: 1 }),
        );
        if ((await page.locator('body').innerText()).includes('assessments.builder.')) {
          expect.unreachable(
            "Expected !(await page.locator('body').innerText()).includes('assessments.builder.')",
          );
        }
        expect((await page.locator('body').innerText()).includes('HOSTILE')).toStrictEqual(false);

        state.mode = 'stale';
        await librarySearch.fill('old');
        await waitUntil(() => state.searchRequests.some((request) => request.q === 'old'));
        await librarySearch.fill('new');
        await waitUntil(() =>
          state.searchRequests.filter((request) => request.q === 'new').length >= 2
        );
        await page.waitForFunction(() => document.body.innerText.includes('Éxito ✨'));
        state.releaseOld?.();
        await waitUntil(() => state.oldReturned);
        expect(state.oldReturned).toStrictEqual(true);
        await page.evaluate(() =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
        );
        await page.waitForFunction(() => !document.body.innerText.includes('OLD-STALE-HOSTILE'));
        expect(await page.locator('body').innerText()).toContain('Éxito ✨');
        await librarySearch.fill('page');
        await waitUntil(() => state.searchRequests.some((request) => request.q === 'page'));
        await page.getByText('Éxito ✨').waitFor();
        await page.getByRole('button', {
          name: catalogForLocale(locale).items!['items.results.next'],
          exact: true,
        }).click();
        await page.getByText(i18n.t('assessments.builder.untitledItem')).waitFor();
        expect(await page.getByText('Éxito ✨').count()).toStrictEqual(0);
        const resultList = page.locator('[data-library-results]');
        expect(
          await resultList.getByText(
            i18n.t('assessments.builder.questionTypeLabel', { type: 'text_entry' }),
          ).count(),
        ).toStrictEqual(1);
        expect(
          state.searchRequests.filter((request) => request.q === 'page').map((request) =>
            request.page
          ),
        ).toStrictEqual(['1', '2']);
        expect(await resultList.innerText()).toContain(
          i18n.formatDate(new Date(itemTwo.updatedAt), {
            dateStyle: 'medium',
            timeZone: 'Europe/Stockholm',
          }),
        );
        expect(await page.locator('body').innerText()).toContain('page-2');
        await page.getByRole('button', {
          name: catalogForLocale(locale).items!['items.results.previous'],
          exact: true,
        }).click();
        await page.getByText('Éxito ✨').waitFor();
        expect(await page.getByText(i18n.t('assessments.builder.untitledItem')).count())
          .toStrictEqual(0);

        for (
          const mode of [
            'search-error',
            'search-malformed',
            'import-http',
            'import-malformed',
          ] as const
        ) {
          await page.goto(`${base}/?locale=${locale}&mode=${mode}`);
          const modeSearch = page.getByLabel(catalog['assessments.builder.library.search']);
          await modeSearch.fill(
            mode === 'search-error' || mode === 'search-malformed' ? 'new' : 'ok',
          );
          if (mode === 'search-error' || mode === 'search-malformed') {
            await page.getByRole('button', { name: catalog['assessments.builder.library.retry'] })
              .waitFor();
            expect(await page.locator('body').innerText()).toContain(
              catalog['assessments.builder.library.searchFailed'],
            );
            await page.getByRole('button', { name: catalog['assessments.builder.library.retry'] })
              .click();
            await page.getByText('Éxito ✨').waitFor();
          } else {
            await page.getByText('Éxito ✨').waitFor();
            const documentsBeforeImport = state.documentRequests;
            const importsBefore = state.importRequestsTotal;
            await page.getByRole('checkbox').check();
            await page.getByRole('button', {
              name: i18n.t('assessments.builder.library.addSelected', { count: 1 }),
              exact: true,
            }).click();
            await page.getByText(catalog['assessments.builder.library.addError.failed'])
              .waitFor();
            expect(state.documentRequests).toStrictEqual(documentsBeforeImport);
            expect(state.importRequestsTotal).toStrictEqual(importsBefore + 1);
            if (!(await page.getByRole('checkbox').isChecked())) {
              expect.unreachable("Expected await page.getByRole('checkbox').isChecked()");
            }
            await page.getByRole('button', {
              name: i18n.t('assessments.builder.library.addSelected', { count: 1 }),
              exact: true,
            }).click();
            await page.getByText(
              i18n.t('assessments.builder.library.added', { count: 1, part: 'Part 1' }),
              { exact: true },
            ).waitFor();
            expect(state.documentRequests).toStrictEqual(documentsBeforeImport);
            expect(state.importRequestsTotal).toStrictEqual(importsBefore + 2);
          }
          const modeBody = await page.locator('body').innerText();
          expect(modeBody.includes('HOSTILE_')).toStrictEqual(false);
          expect(modeBody.includes('assessments.builder.')).toStrictEqual(false);
          expect(modeBody.includes('{count')).toStrictEqual(false);
        }
        expect(errors).toStrictEqual([]);
        if (locale.startsWith('es-')) {
          const body = await page.locator('body').innerText();
          if (body.includes('Search library')) {
            expect.unreachable("Expected !body.includes('Search library')");
          }
          if (body.includes('Clear search')) {
            expect.unreachable("Expected !body.includes('Clear search')");
          }
          if (body.includes('Import assessment')) {
            expect.unreachable("Expected !body.includes('Import assessment')");
          }
          if (body.includes('Copy ID')) {
            expect.unreachable("Expected !body.includes('Copy ID')");
          }
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    state.releaseOld?.();
    await browser?.close();
    await server?.close();
    await _fs.rm(temp, { recursive: true });
  }
});
