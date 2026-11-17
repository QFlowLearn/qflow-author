import { expect, test as testCase } from 'vitest';

import { type FetchFixtureServer, startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { renderPage as render } from './helpers/render_page.tsx';
import { INTERFACE_LOCALES, parseInterfaceLocale } from '../lib/i18n/locale.ts';
import { formatCalendarDate, formatTimestamp } from '../lib/i18n/dates.ts';
import { TimestampFixture } from './helpers/timestamp_browser_fixture.tsx';

testCase(
  'timestamps hydrate in the browser zone, preserve locale and update after travel without reload',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.timestamp-browser-'));
    let server: FetchFixtureServer | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await _fs.writeFile(
        `${temp}/entry.tsx`,
        `
import { h, hydrate } from 'preact';
import { TimestampFixture } from '${process.cwd()}/tests/helpers/timestamp_browser_fixture.tsx';
import { parseInterfaceLocale } from '${process.cwd()}/lib/i18n/locale.ts';
const locale = parseInterfaceLocale(document.documentElement.lang);
if (!locale) throw new Error('Invalid locale');
hydrate(h(TimestampFixture, {locale}), document.getElementById('root'));
`,
        'utf8',
      );
      const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
        `${temp}/entry.tsx`,
        '--bundle',
        '--format=esm',
        '--jsx=automatic',
        '--jsx-import-source=preact',
        `--outfile=${temp}/bundle.js`,
      ], {});
      if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
      const bundle = await _fs.readFile(`${temp}/bundle.js`, 'utf8');
      server = await startFetchServer((req) => {
        const url = new URL(req.url);
        if (url.pathname === '/bundle.js') {
          return new Response(bundle, { headers: { 'content-type': 'text/javascript' } });
        }
        const locale = parseInterfaceLocale(url.pathname.slice(1));
        if (!locale) return new Response('Invalid locale', { status: 400 });
        return new Response(
          `<!doctype html><html lang="${locale}"><body><div id="root">${
            render(<TimestampFixture locale={locale} />)
          }</div><script type="module" src="/bundle.js"></script></body></html>`,
          { headers: { 'content-type': 'text/html' } },
        );
      });
      const base = `http://127.0.0.1:${server.port}`;
      browser = await chromium.launch({ headless: true });
      const errors: string[] = [];
      for (const zone of ['Europe/Madrid', 'Europe/Stockholm', 'America/New_York']) {
        // Browser language deliberately differs from the selected interface language.
        const context: import('playwright').BrowserContext = await browser.newContext({
          timezoneId: zone,
          locale: 'en-US',
        });
        const page: import('playwright').Page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        for (const locale of INTERFACE_LOCALES) {
          await page.goto(`${base}/${locale}`);
          const expected = formatTimestamp(new Date('2026-09-14T23:30:00Z'), locale, zone);
          await page.waitForFunction(
            (value) => document.querySelector('#midnight time')?.textContent === value,
            expected,
          );
          expect(await page.locator('#midnight time').textContent()).toStrictEqual(expected);
          expect((await page.locator('#midnight time').textContent())?.includes(zone))
            .toStrictEqual(false);
          expect(await page.locator('#midnight time').getAttribute('datetime')).toStrictEqual(
            '2026-09-14T23:30:00.000Z',
          );
          expect(await page.locator('#calendar').textContent()).toStrictEqual(
            formatCalendarDate('2026-09-14', locale, 'long'),
          );
          expect(await page.locator('#rich time').count()).toStrictEqual(1);
          expect(await page.locator('#rich').innerText()).toContain('<Review>:');
          if (locale === 'sv-SE' && zone.startsWith('Europe/')) {
            expect(await page.locator('#spring-before').innerText()).toContain('01:30');
            expect(await page.locator('#spring-after').innerText()).toContain('03:30');
          }
        }
        await context.close();
      }
      const travel: import('playwright').BrowserContext = await browser.newContext();
      const page = await travel.newPage();
      const cdp = await travel.newCDPSession(page);
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Stockholm' });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/sv-SE`);
      await page.waitForFunction(() =>
        document.querySelector('#midnight time')?.textContent?.includes('15 sep. 2026')
      );
      await page.getByRole('textbox', { name: 'Unsaved note' }).fill('Keep my work');
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
      await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() =>
        document.querySelector('#midnight time')?.textContent?.includes('14 sep. 2026')
      );
      expect(await page.getByRole('textbox', { name: 'Unsaved note' }).inputValue()).toStrictEqual(
        'Keep my work',
      );
      expect(await page.locator('#midnight').innerText()).toContain('14 sep. 2026');
      await travel.close();
      const noJs: import('playwright').BrowserContext = await browser.newContext({
        javaScriptEnabled: false,
        timezoneId: 'Europe/Stockholm',
      });
      const staticPage = await noJs.newPage();
      await staticPage.goto(`${base}/sv-SE`);
      expect(await staticPage.locator('#midnight time').innerText()).toStrictEqual(
        formatTimestamp(new Date('2026-09-14T23:30:00Z'), 'sv-SE', 'UTC'),
      );
      await noJs.close();
      expect(errors).toStrictEqual([]);
    } finally {
      await browser?.close();
      await server?.close();
      await _fs.rm(temp, { recursive: true });
    }
  },
);
