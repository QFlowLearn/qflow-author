import { startFetchServer } from '../helpers/fetch_server.ts';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createElement } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { HydrationRoot } from '../../lib/server/HydrationRoot.tsx';

it('keeps every island implementation outside the bootstrap static import graph', async () => {
  const client = resolve('.cloudflare/output/v1/workers/default/assets');
  const manifest: unknown = JSON.parse(
    await readFile(resolve(client, '.vite/manifest.json'), 'utf8'),
  );
  if (!manifest || typeof manifest !== 'object') throw new Error('Missing client manifest.');
  const chunks = manifest;
  const seen = new Set<string>();
  let rawBytes = 0, gzipBytes = 0;
  async function visit(key: string): Promise<void> {
    if (seen.has(key)) return;
    seen.add(key);
    expect(key).not.toMatch(
      /islands\/|assessment_blueprint|bank_enrichment|assessment_export_targets/,
    );
    const chunk: unknown = Reflect.get(chunks, key);
    if (!chunk || typeof chunk !== 'object') throw new Error('Missing static import.');
    const file: unknown = Reflect.get(chunk, 'file'),
      imports: unknown = Reflect.get(chunk, 'imports');
    if (typeof file !== 'string') throw new Error('Missing chunk file.');
    const bytes = await readFile(resolve(client, file));
    rawBytes += bytes.length;
    gzipBytes += gzipSync(bytes).length;
    if (imports !== undefined) {
      if (!Array.isArray(imports)) throw new Error('Invalid static imports.');
      for (const dependency of imports) {
        if (typeof dependency !== 'string') throw new Error('Invalid static import.');
        await visit(dependency);
      }
    }
  }
  await visit('client/entries/bootstrap.ts');
  expect(rawBytes).toBeLessThan(64_000);
  expect(gzipBytes).toBeLessThan(24_000);
  console.log('Bootstrap static JS:', { chunks: seen.size, rawBytes, gzipBytes });
});

it(
  'hydrates UTC timestamps once, preserves SSR during loading and leaves failed roots readable',
  async () => {
    const client = resolve('.cloudflare/output/v1/workers/default/assets');
    const manifest: unknown = JSON.parse(
      await readFile(resolve(client, '.vite/manifest.json'), 'utf8'),
    );
    if (!manifest || typeof manifest !== 'object') throw new Error('Missing client manifest.');
    const entry: unknown = Reflect.get(manifest, 'client/entries/bootstrap.ts');
    if (
      !entry || typeof entry !== 'object' || typeof Reflect.get(entry, 'file') !== 'string'
    ) throw new Error('Missing bootstrap asset.');
    const bootstrap = '/' + Reflect.get(entry, 'file');
    const rootHtml = (id: string) =>
      renderToString(createElement(HydrationRoot, {
        payload: {
          id,
          component: 'LocalizedTimestamp',
          props: { value: '2026-10-20T00:00:00.000Z', locale: 'en-US', showTime: false },
        },
      }));
    const browser = await chromium.launch({ headless: true });
    let release: () => void = () => {};
    let closeServer: (() => Promise<void>) | undefined;
    try {
      const context: import('playwright').BrowserContext = await browser.newContext({
        timezoneId: 'America/Los_Angeles',
      });
      const page: import('playwright').Page = await context.newPage();
      const delayed = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requested: () => void = () => {};
      const requestedModule = new Promise<void>((resolve) => {
        requested = resolve;
      });
      let failModule = false;
      const server = await startFetchServer(async (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/') {
          return new Response(
            '<!DOCTYPE html><html><body>' + rootHtml('qf-time-1') + rootHtml('qf-time-2') +
              `<script type="module" src="${bootstrap}"></script></body></html>`,
            { headers: { 'content-type': 'text/html' } },
          );
        }
        const path = resolve(client, '.' + url.pathname);
        if (!path.startsWith(client + sep)) {
          throw Error('Fixture asset escaped the built client directory.');
        }
        return new Response(await readFile(path), {
          headers: { 'content-type': 'text/javascript' },
        });
      });
      closeServer = () => server.close();
      await page.route('**/LocalizedTimestamp-*', async (route) => {
        requested();
        await delayed;
        if (failModule) await route.abort('failed');
        else await route.continue();
      });
      await page.goto(server.origin, { waitUntil: 'commit' });
      await requestedModule;
      expect(await page.locator('#qf-time-1').getAttribute('data-qflow-state')).toBe('pending');
      expect(await page.locator('#qf-time-1').textContent()).toBe('Oct 20, 2026');
      release();
      await page.waitForFunction(() =>
        document.querySelectorAll('[data-qflow-state="ready"]').length === 2
      );
      await page.waitForFunction(() =>
        document.querySelector('#qf-time-1')?.textContent === 'Oct 19, 2026'
      );
      expect(await page.locator('#qf-time-2').textContent()).toBe('Oct 19, 2026');
      await page.evaluate(async (src) => {
        const root = document.querySelector('#qf-time-1');
        const first = root?.firstElementChild;
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.type = 'module';
          script.src = src + '?duplicate-bootstrap=1';
          script.addEventListener('load', () => resolve(), { once: true });
          script.addEventListener('error', () => reject(new Error('Duplicate bootstrap failed.')), {
            once: true,
          });
          document.head.append(script);
        });
        if (root?.firstElementChild !== first) {
          throw new Error('Duplicate bootstrap replaced the existing tree.');
        }
      }, bootstrap);
      failModule = true;
      await page.reload({ waitUntil: 'commit' });
      await page.waitForFunction(() =>
        document.querySelectorAll('[data-qflow-state="error"]').length === 2
      );
      expect(await page.locator('#qf-time-1').textContent()).toBe('Oct 20, 2026');
      expect(await page.locator('#qf-time-2').textContent()).toBe('Oct 20, 2026');
      await context.close();
    } finally {
      release();
      await browser.close();
      await closeServer?.();
    }
  },
  30_000,
);

it('preserves distinct control and label identities when two independent roots hydrate', async () => {
  const client = resolve('.cloudflare/output/v1/workers/default/assets');
  const manifest: unknown = JSON.parse(
    await readFile(resolve(client, '.vite/manifest.json'), 'utf8'),
  );
  if (!manifest || typeof manifest !== 'object') throw Error('Missing manifest.');
  const entry: unknown = Reflect.get(manifest, 'client/entries/bootstrap.ts');
  if (!entry || typeof entry !== 'object' || typeof Reflect.get(entry, 'file') !== 'string') {
    throw Error('Missing bootstrap.');
  }
  const bootstrap = '/' + Reflect.get(entry, 'file');
  const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['core', 'items']);
  const root = (id: string, label: string) =>
    renderToString(
      createElement(HydrationRoot, {
        payload: { id, component: 'MemberPicker', props: { name: id, label, payload } },
      }),
    );
  const browser = await chromium.launch({ headless: true });
  let release: () => void = () => {};
  let closeServer: (() => Promise<void>) | undefined;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = await startFetchServer(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/') {
        return new Response(
          '<!doctype html><html><body>' + root('qf-first-member', 'First reviewer') +
            root('qf-second-member', 'Second reviewer') +
            `<script type="module" src="${bootstrap}"></script></body></html>`,
          { headers: { 'content-type': 'text/html' } },
        );
      }
      const path = resolve(client, '.' + url.pathname);
      if (!path.startsWith(client + sep)) throw Error('Escaped fixture asset.');
      return new Response(await readFile(path), { headers: { 'content-type': 'text/javascript' } });
    });
    closeServer = () => server.close();
    await page.route('**' + bootstrap, async (route) => {
      await delayed;
      await route.continue();
    });
    await page.goto(server.origin, { waitUntil: 'commit' });
    const first = page.getByLabel('First reviewer', { exact: true }),
      second = page.getByLabel('Second reviewer', { exact: true });
    const before = await Promise.all([first.getAttribute('id'), second.getAttribute('id')]);
    expect(before.every(Boolean)).toBe(true);
    expect(new Set(before).size).toBe(2);
    release();
    await page.waitForFunction(() =>
      document.querySelectorAll('[data-qflow-state="ready"]').length === 2
    );
    expect(await Promise.all([first.getAttribute('id'), second.getAttribute('id')])).toEqual(
      before,
    );
    await page.getByText('Second reviewer', { exact: true }).click();
    await expect.poll(() => second.evaluate((node) => node === document.activeElement)).toBe(true);
  } finally {
    release();
    await browser.close();
    await closeServer?.();
  }
});
