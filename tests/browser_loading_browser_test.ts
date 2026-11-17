import { expect, test as testCase } from 'vitest';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as _fs from 'node:fs/promises';

import { chromium } from 'playwright';
import { captureBrowserLoading, observeBrowserLoading } from './helpers/browser_loading.ts';

testCase(
  'loading evidence retains first real failures, bounds recent events and omits secret values',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const browser = await chromium.launch({ headless: true });
    try {
      const page: import('playwright').Page = await browser.newPage();
      const origin = 'http://qflow-loading.example';
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/reset.js') return await route.abort('connectionreset');
        if (url.pathname === '/aborted.js') return await route.abort('aborted');
        if (url.pathname === '/unavailable.js') {
          return await route.fulfill({ status: 503, contentType: 'text/javascript', body: '' });
        }
        if (url.pathname === '/') {
          return await route.fulfill({
            contentType: 'text/html',
            body: '<main>Loading fixture</main>',
          });
        }
        await route.fulfill({ contentType: 'text/javascript', body: 'void 0;' });
      });
      const loading = observeBrowserLoading(page, origin, () => 'fixture');
      try {
        await page.goto(origin);
        const inject = async (url: string) => {
          await page.evaluate((source) =>
            new Promise<void>((resolve) => {
              const script = document.createElement('script');
              script.src = source;
              script.onload = script.onerror = () => resolve();
              document.body.append(script);
            }), url);
        };
        await inject(`${origin}/reset.js?token=secret-query`);
        await inject(`${origin}/aborted.js`);
        const pageError = page.waitForEvent('pageerror');
        await page.evaluate(() => {
          setTimeout(() => {
            throw new Error('secret-error-message');
          }, 0);
        });
        await pageError;
        await inject('http://external-loading.example/private-script-path?token=secret-external');
        const external = loading.snapshot().recentEvents.find((event) =>
          event.event === 'script_response' && event.path === '[external script]'
        );
        if (!external) expect.unreachable('Expected external');
        // Real successful downloads push initial errors out of the recent-event window.
        for (let index = 0; index < 80; index++) await inject(`${origin}/success-${index}.js`);
        const snapshot = loading.snapshot();
        if (!(snapshot.totalEvents > 160)) {
          expect.unreachable('Expected snapshot.totalEvents > 160');
        }
        expect(snapshot.recentEvents.length).toStrictEqual(64);
        expect(snapshot.firstFailures.map((event) => ({
          event: event.event,
          path: event.path,
          networkCode: event.networkCode,
          cause: event.cause,
        }))).toStrictEqual([
          {
            event: 'script_failed',
            path: '/reset.js',
            networkCode: 'net::ERR_CONNECTION_RESET',
            cause: undefined,
          },
          { event: 'pageerror', path: undefined, networkCode: undefined, cause: 'Error' },
        ]);
        const serialized = JSON.stringify(snapshot);
        for (const secret of ['secret-query', 'secret-error-message', 'secret-external']) {
          if (serialized.includes(secret)) {
            expect.unreachable('Expected !serialized.includes(secret)');
          }
        }
        if (
          !(snapshot.recentEvents.every((event) =>
            event.phase === 'fixture' && Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0
          ))
        ) {
          expect.unreachable(
            "Expected snapshot.recentEvents.every((event) => event.phase === 'fixture' && Number.isInteger(event",
          );
        }
        const namedError = page.waitForEvent('pageerror');
        await page.evaluate(() => {
          setTimeout(() => {
            const cause = new Error('secret-second-message');
            cause.name = 'secret-error-name';
            throw cause;
          }, 0);
        });
        await namedError;
        await inject(`${origin}/unavailable.js`);
        if (
          !(loading.snapshot().firstFailures.some((event) =>
            event.event === 'script_response' && event.status === 503
          ))
        ) {
          expect.unreachable(
            "Expected loading.snapshot().firstFailures.some((event) => event.event === 'script_response' && even",
          );
        }
        for (let index = 0; index < 30; index++) await inject(`${origin}/reset.js?case=${index}`);
        const bounded = loading.snapshot();
        expect(bounded.firstFailures.length).toStrictEqual(16);
        expect(bounded.firstFailures.slice(0, 2)).toStrictEqual(snapshot.firstFailures);
        for (const secret of ['secret-error-name', 'secret-second-message']) {
          if (JSON.stringify(bounded).includes(secret)) {
            expect.unreachable('Expected !JSON.stringify(bounded).includes(secret)');
          }
        }
        loading.stop();
        await inject(`${origin}/after-stop.js`);
        expect(loading.snapshot()).toStrictEqual(bounded);
        // A failed diagnostic write must not throw in place of the original test failure.
        const file = join(tmpdir(), `qflow-loading-${crypto.randomUUID()}`);
        await _fs.writeFile(file, '');
        try {
          expect(await captureBrowserLoading(loading, { path: () => `${file}/invalid` }, 'test'))
            .toStrictEqual(undefined);
        } finally {
          await _fs.rm(file);
        }
      } finally {
        loading.stop();
      }
    } finally {
      await browser.close();
    }
  },
);
