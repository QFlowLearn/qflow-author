import { expect, test as testCase } from 'vitest';

import { type FetchFixtureServer, startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { assertNativeFormAccessibility } from './helpers/browser_form_accessibility.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';

testCase(
  'part time validation preserves native disclosure activation and raw edits during pointer and keyboard input',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.part-validation-browser-'));
    const evidence = await createBrowserEvidenceDirectory();
    let server: FetchFixtureServer | undefined;
    let browser: import('playwright').Browser | undefined;
    let page: import('playwright').Page | undefined;
    try {
      const entry = `${temp}/entry.tsx`, bundle = `${temp}/bundle.js`;
      await _fs.writeFile(
        entry,
        `
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { I18nProvider } from '../lib/i18n/context.tsx';
import PartSettingsFields from '../components/ui/PartSettingsFields.tsx';
import QuestionProtectionFields from '../components/ui/QuestionProtectionFields.tsx';
function Form() {
  const [draft, setDraft] = useState({ timeLimits: { minTime: '30', maxTime: '300' } });
  const [fixed, setFixed] = useState(true);
  return <main><h1>Part settings</h1><form>
    <PartSettingsFields draft={draft} onChange={setDraft}/>
    <QuestionProtectionFields questions={[{ id: 'Q', number: '1.1', title: 'First question', fixed }]} onChange={(_, value) => setFixed(value)}/>
  </form></main>;
}
render(<I18nProvider payload={globalThis.__PAYLOAD__}><Form/></I18nProvider>, document.getElementById('root'));
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
      const script = await _fs.readFile(bundle, 'utf8');
      const css = await _fs.readFile('static/tw.css', 'utf8');
      server = await startFetchServer((request) => {
        const url = new URL(request.url);
        if (url.pathname === '/bundle.js') {
          return new Response(script, { headers: { 'content-type': 'text/javascript' } });
        }
        if (url.pathname === '/styles.css') {
          return new Response(css, { headers: { 'content-type': 'text/css' } });
        }
        const locale =
          INTERFACE_LOCALES.find((value) => value === url.searchParams.get('locale')) ?? 'en-US';
        return new Response(
          `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><body><div id="root"></div><script>globalThis.__PAYLOAD__=${
            JSON.stringify(createI18nPayload(locale, catalogForLocale(locale), ['assessments']))
          }</script><script type="module" src="/bundle.js"></script></body></html>`,
          { headers: { 'content-type': 'text/html' } },
        );
      });
      const origin = `http://${'127.0.0.1'}:${server.port}`;
      browser = await chromium.launch();
      page = await browser.newPage({ viewport: { width: 390, height: 1200 } });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
      for (const locale of INTERFACE_LOCALES) {
        const i18n = createI18n(locale, catalogForLocale(locale));
        for (const theme of ['light', 'dark']) {
          for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 1200 });
            await page.goto(`${origin}/?locale=${locale}`);
            await page.evaluate(
              (value) => document.documentElement.setAttribute('data-theme', value),
              theme,
            );
            const minimum = page.getByRole('textbox', {
              name: i18n.t('assessments.arrange.modal.minTime'),
              exact: true,
            });
            const summary = page.locator('summary').filter({
              hasText: i18n.t('assessments.partSettings.fixedQuestions'),
            });
            const checkbox = page.getByRole('checkbox', { name: /First question$/ });
            await minimum.fill('-');
            expect(await minimum.getAttribute('aria-invalid')).toStrictEqual(null);
            expect(await page.getByRole('alert').count()).toStrictEqual(0);
            const target = await summary.boundingBox();
            if (!target) expect.unreachable('Expected target');
            await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
            // Native pointer activation spans blur and the resulting validation render.
            await page.mouse.down();
            await page.waitForFunction(() =>
              document.querySelector('input[aria-invalid="true"]') !== null
            );
            expect((await summary.boundingBox())?.y).toStrictEqual(target.y);
            await page.mouse.up();
            await checkbox.waitFor({ state: 'visible' });
            await checkbox.uncheck();
            expect(await minimum.inputValue()).toStrictEqual('-');
            expect(await checkbox.isChecked()).toStrictEqual(false);
            const issue = page.getByRole('alert').filter({
              hasText: i18n.t('assessments.partSettings.timeNumber'),
            });
            await issue.waitFor();
            expect(await minimum.getAttribute('aria-describedby')).toStrictEqual(
              await issue.getAttribute('id'),
            );
            await assertNativeFormAccessibility(page, page.locator('form'));
            if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
              expect.unreachable(
                'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
              );
            }
            if (locale === 'en-US') {
              const path = evidence.path(`part-validation-${theme}-${width}.png`);
              await page.screenshot({ path });
              console.info(`Part validation screenshot: ${path}`);
            }

            await page.goto(`${origin}/?locale=${locale}`);
            await page.evaluate(
              (value) => document.documentElement.setAttribute('data-theme', value),
              theme,
            );
            await minimum.fill('-');
            await summary.focus();
            await summary.press('Enter');
            await checkbox.waitFor({ state: 'visible' });
            await checkbox.focus();
            await checkbox.press('Space');
            expect(await minimum.inputValue()).toStrictEqual('-');
            expect(await checkbox.isChecked()).toStrictEqual(false);
            await minimum.fill('0');
            expect(await minimum.getAttribute('aria-invalid')).toStrictEqual(null);
            expect(await page.getByRole('alert').count()).toStrictEqual(0);
          }
        }
      }
      expect(errors).toStrictEqual([]);
    } catch (cause: unknown) {
      if (page) await captureBrowserFailure(page, evidence, 'part-validation');
      throw cause;
    } finally {
      await browser?.close();
      await server?.close();
      await _fs.rm(temp, { recursive: true });
    }
  },
);
