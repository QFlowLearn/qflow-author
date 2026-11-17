import { expect, test as testCase } from 'vitest';

import type { FetchFixtureServer } from './helpers/fetch_server.ts';
import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import type { LibrarySearch } from '../lib/question_bank_picker.ts';

const collectionId = '11111111-1111-4111-8111-111111111111';
const scheme = {
  id: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  version: 1,
  name: 'Science',
  audience: 'Middle school',
};

testCase('bank picker debounces typing but immediately applies explicit actions', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.picker-timing-browser-'));
  let server: FetchFixtureServer | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const requests: URLSearchParams[] = [];
  let failNext = false;
  try {
    const entry = `${temp}/entry.tsx`, bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { useBankPicker } from '../islands/assessment_builder/useBankPicker.ts';

function PickerProbe() {
  const picker = useBankPicker();
  return <section>
    <label>Search<input value={picker.selection.q}
      onInput={e => picker.change('q', e.currentTarget.value)} /></label>
    <label>Tags<input value={picker.selection.tags}
      onInput={e => picker.change('tags', e.currentTarget.value)} /></label>
    <label>Collection<select value={picker.selection.collection}
      onChange={e => picker.change('collection', e.currentTarget.value)}>
      <option value="">All</option><option value="${collectionId}">ARC</option>
    </select></label>
    <label>Category set<select onChange={e => picker.changeCategory('scheme', e.currentTarget.value)}>
      <option value="">None</option><option value="${scheme.id}">Science</option>
    </select></label>
    {['subject', 'topic', 'difficulty'].map(dimension =>
      <label>{dimension}<select aria-label={dimension}
        onChange={e => picker.changeCategory(dimension, e.currentTarget.value)}>
        <option value="">All</option><option value="${scheme.versionId}:example">Example</option>
      </select></label>)}
    <button onClick={() => picker.goToPage(picker.page - 1)}>Previous</button>
    <button onClick={() => picker.goToPage(picker.page + 1)}>Next</button>
    <button onClick={picker.retry}>Retry</button>
    <button onClick={picker.clear}>Clear</button>
    <output>{picker.loading ? 'Loading' : picker.error ? 'Error' : 'Ready'}</output>
  </section>;
}
function App() {
  const [mounted, setMounted] = useState(true);
  return <main><button onClick={() => setMounted(false)}>Unmount</button>
    {mounted && <PickerProbe />}</main>;
}
render(<App />, document.getElementById('root'));
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
    ], {});
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const javascript = await _fs.readFile(bundle, 'utf8');
    server = await startFetchServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === '/bundle.js') {
        return new Response(javascript, { headers: { 'content-type': 'text/javascript' } });
      }
      if (url.pathname === '/api/items/search') {
        requests.push(url.searchParams);
        if (failNext) {
          failNext = false;
          return Response.json({ error: 'search_failed' }, { status: 503 });
        }
        const facet = {
          categories: [],
          truncated: false,
          unassigned: 0,
          pending: 0,
          outside: 0,
          outdated: 0,
        };
        const response: LibrarySearch = {
          items: [],
          total: 0,
          hasMore: false,
          collections: [],
          enrichment: {
            schemes: [scheme],
            schemesTruncated: false,
            selection: url.searchParams.has('scheme')
              ? { scheme, facets: { subject: facet, topic: facet, difficulty: facet }, rows: {} }
              : null,
          },
        };
        return Response.json(response);
      }
      return new Response(
        '<!doctype html><html><body><div id="root"></div>' +
          '<script type="module" src="/bundle.js"></script></body></html>',
        { headers: { 'content-type': 'text/html' } },
      );
    });
    browser = await chromium.launch();
    const page: import('playwright').Page = await browser.newPage();
    page.setDefaultTimeout(3000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto(`http://${'127.0.0.1'}:${server.port}`);
    await page.getByText('Ready', { exact: true }).waitFor();
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));

    // Allow effects to flush, but advance less than the 250 ms typing delay.
    const immediate = async (action: () => Promise<unknown>, status = 'Ready') => {
      const before = requests.length;
      const [response] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === '/api/items/search', {
          timeout: 2000,
        }),
        (async () => {
          await action();
          await page.clock.runFor(100);
        })(),
      ]);
      expect(response.status()).toStrictEqual(status === 'Error' ? 503 : 200);
      await page.getByText(status, { exact: true }).waitFor();
      expect(requests.length).toStrictEqual(before + 1);
      const received = requests.at(-1);
      if (!received) expect.unreachable('Expected received');
      return received;
    };

    const search = page.getByLabel('Search'), tags = page.getByLabel('Tags');
    const beforeTyping = requests.length;
    await search.fill('s');
    await page.clock.runFor(150);
    expect(requests.length).toStrictEqual(beforeTyping);
    await search.fill('solar');
    await tags.fill('grade-6');
    await page.clock.runFor(200);
    expect(requests.length).toStrictEqual(beforeTyping);
    await page.clock.runFor(200);
    await page.getByText('Ready', { exact: true }).waitFor();
    expect(requests.length).toStrictEqual(beforeTyping + 1);
    expect(requests.at(-1)?.get('q')).toStrictEqual('solar');
    expect(requests.at(-1)?.get('tags')).toStrictEqual('grade-6');

    // A click commits the latest text immediately and cancels its pending timer.
    await search.fill('latest');
    await page.clock.runFor(100);
    let received = await immediate(() => page.getByLabel('Collection').selectOption(collectionId));
    expect(received.get('collection')).toStrictEqual(collectionId);
    expect(received.get('q')).toStrictEqual('latest');
    const afterClick = requests.length;
    await page.clock.runFor(500);
    expect(requests.length).toStrictEqual(afterClick);

    received = await immediate(() => page.getByLabel('Category set').selectOption(scheme.id));
    expect(received.get('scheme')).toStrictEqual(scheme.id);
    for (const dimension of ['subject', 'topic', 'difficulty']) {
      received = await immediate(() =>
        page.getByLabel(dimension, { exact: true }).selectOption(`${scheme.versionId}:example`)
      );
      expect(received.get(dimension)).toStrictEqual(`${scheme.versionId}:example`);
      expect(received.get('page')).toStrictEqual('1');
    }
    received = await immediate(() =>
      page.getByRole('button', { name: 'Next', exact: true }).click()
    );
    expect(received.get('page')).toStrictEqual('2');
    received = await immediate(() =>
      page.getByRole('button', { name: 'Previous', exact: true }).click()
    );
    expect(received.get('page')).toStrictEqual('1');
    failNext = true;
    await immediate(
      () => page.getByRole('button', { name: 'Retry', exact: true }).click(),
      'Error',
    );
    await immediate(() => page.getByRole('button', { name: 'Retry', exact: true }).click());

    await tags.fill('pending');
    await page.clock.runFor(100);
    received = await immediate(() =>
      page.getByRole('button', { name: 'Clear', exact: true }).click()
    );
    expect(received.get('q')).toStrictEqual('');
    expect(received.get('tags')).toStrictEqual('');
    expect(received.get('collection')).toStrictEqual('');
    expect(received.has('scheme')).toStrictEqual(false);
    const afterClear = requests.length;
    await page.clock.runFor(500);
    expect(requests.length).toStrictEqual(afterClear);

    await search.fill('unmounted');
    await page.clock.runFor(100);
    await page.getByRole('button', { name: 'Unmount', exact: true }).click();
    await page.clock.runFor(500);
    expect(requests.length).toStrictEqual(afterClear);
    expect(errors).toStrictEqual([]);
  } finally {
    await browser?.close();
    await server?.close();
    await _fs.rm(temp, { recursive: true });
  }
});
