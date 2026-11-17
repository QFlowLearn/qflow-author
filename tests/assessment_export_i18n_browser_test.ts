import { expect, test as testCase } from 'vitest';

import { type FetchFixtureServer, startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { createAssessmentExportBrowserCases } from './helpers/assessment_export_browser_cases.ts';
import { createBrowserEvidenceDirectory } from './helpers/browser_evidence.ts';
import { verifyAssessmentExportNotices } from './helpers/assessment_export_notice_browser.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'];

testCase('assessment export preflight browser workflow is localized and safe', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const evidence = await createBrowserEvidenceDirectory();
  let tmp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const validateRequests: Array<{ locale: InterfaceLocale; mode: string; search: string }> = [];
  const packageRequests: Array<{ locale: InterfaceLocale; mode: string; search: string }> = [];
  let releaseLoading: (() => void) | null = null;
  let loadingGate: Promise<void> | null = null;
  try {
    tmp = await _fs.mkdtemp(_path.join(process.cwd(), '.assessment-export-browser-'));
    const entry = `${tmp}/entry.tsx`;
    const bundle = `${tmp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
import { h, render } from "preact";
import { I18nProvider } from "${process.cwd()}/lib/i18n/context.tsx";
import AssessmentExportPreflight from "${process.cwd()}/islands/assessment_builder/AssessmentExportPreflight.tsx";
globalThis.mount = (config) => render(h(I18nProvider, {payload: config.payload}, h(AssessmentExportPreflight, {assessmentId: 'assessment-1', revisionFingerprint: 'revision-1'})), document.getElementById('root'));
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.__PACKAGE_ATTEMPTS__ = 0;
globalThis.fetch = (input, init) => {
  let url;
  try {
    url = new URL(
      typeof input === 'string' ? input : input instanceof Request ? input.url : String(input),
      location.href,
    );
  } catch {
    return nativeFetch(input, init);
  }
  if (document.cookie.includes('mode=package:request-failure') && url.pathname.endsWith('/package')) {
    globalThis.__PACKAGE_ATTEMPTS__++;
    return Promise.reject(new TypeError('TEST_PACKAGE_NETWORK_FAILURE'));
  }
  return nativeFetch(input, init);
};
globalThis.mount(globalThis.__CONFIG__);
`,
      'utf8',
    );
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=esm',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      '--loader:.min.mjs=file',
      '--loader:.css=empty',
      `--outfile=${bundle}`,
    ], { cwd: process.cwd() });
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const bundleText = await _fs.readFile(bundle, 'utf8');
    for (
      const marker of [
        'catalogForLocale',
        'lib/i18n/catalogs',
        'lib/i18n/messages/',
        'playerMessageCatalogForLocale',
      ]
    ) {
      if (bundleText.includes(marker)) expect.unreachable(`bundle leaked ${marker}`);
    }
    const { items, warning, preflightModes, packageModes } = createAssessmentExportBrowserCases();
    const json = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
    server = await startFetchServer(async (request) => {
      const url = new URL(request.url);
      const referer = request.headers.get('referer');
      const refererMode = referer ? new URL(referer).searchParams.get('mode') : null;
      const mode = url.searchParams.get('mode') ??
        refererMode ??
        request.headers.get('cookie')?.match(/(?:^|; )mode=([^;]+)/)?.[1] ??
        'main';
      const packageMode = mode.startsWith('package:') ? mode.slice('package:'.length) : null;
      if (url.pathname === '/bundle.js') {
        return new Response(await _fs.readFile(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      if (url.pathname === '/static/tw.css') {
        return new Response(await _fs.readFile('static/tw.css', 'utf8'), {
          headers: { 'content-type': 'text/css' },
        });
      }
      if (url.pathname === '/api/assessments/assessment-1/validate') {
        const referer = request.headers.get('referer');
        const requestLocale =
          (referer ? new URL(referer).searchParams.get('locale') : null) as InterfaceLocale;
        validateRequests.push({ locale: requestLocale, mode, search: url.search });
        if (mode === 'loading') await loadingGate;
        if (mode === 'invalid-success') {
          return new Response('{}', { headers: { 'content-type': 'application/json' } });
        }
        if (preflightModes.includes(mode as typeof preflightModes[number])) {
          const error = mode === 'invalid-code' ? 'A'.repeat(81) : mode;
          return new Response(JSON.stringify({ error, message: `UPSTREAM_SECRET_${mode}` }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          });
        }
        const preflight = mode === 'informational'
          ? {
            ...warning.preflight,
            overallOutcome: 'preserved',
            items: [items[0]],
            repairs: [],
            packageDiagnosticCodes: [
              'product_import_evidence.not_recorded',
              'profile_release_evidence.not_recorded',
            ],
            warningCodes: [],
            acknowledgementToken: null,
          }
          : mode === 'adaptive'
          ? {
            ...warning.preflight,
            items: [items[0]],
            repairs: [],
            packageDiagnosticCodes: ['qflow.export.adaptive_sequence_omitted'],
            warningCodes: ['qflow.export.adaptive_sequence_omitted'],
          }
          : warning.preflight;
        return new Response(JSON.stringify({ preflight }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/assessments/assessment-1/package') {
        const requestReferer = request.headers.get('referer');
        const requestLocale = (requestReferer
          ? new URL(requestReferer).searchParams.get('locale')
          : null) as InterfaceLocale;
        packageRequests.push({ locale: requestLocale, mode, search: url.search });
        if (mode === 'adaptive') {
          return new Response(new Uint8Array([80, 75, 5, 6, ...Array(18).fill(0)]), {
            headers: {
              'content-type': 'application/zip',
              'content-disposition': 'attachment; filename="assessment.zip"',
              'link': '</api/assessments/assessment-1/receipt>; rel="receipt"',
            },
          });
        }
        if (packageMode && packageModes.includes(packageMode as typeof packageModes[number])) {
          const error = packageMode === 'invalid-package' ? 'A'.repeat(81) : packageMode;
          return new Response(
            JSON.stringify({ error, message: `UPSTREAM_PACKAGE_SECRET_${packageMode}` }),
            {
              status: 409,
              headers: { 'content-type': 'application/json' },
            },
          );
        }
        return new Response('blocked', { status: 409 });
      }
      const locale = url.searchParams.get('locale') as InterfaceLocale;
      const payload = createI18nPayload(locale, catalogForLocale(locale), [
        'delivery',
        'assessments',
      ]);
      return new Response(
        `<!doctype html><html lang="${locale}" data-theme="wireframe"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/tw.css"></head><body class="bg-base-200 p-6"><div id="root"></div><script>globalThis.__CONFIG__=${
          json({ payload })
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    const address = new URL(server.origin);
    browser = await chromium.launch();
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      await page.addInitScript(() => {
        (globalThis as typeof globalThis & { __UNHANDLED__?: string[] }).__UNHANDLED__ = [];
        addEventListener('unhandledrejection', (event) => {
          const target = globalThis as typeof globalThis & { __UNHANDLED__?: string[] };
          target.__UNHANDLED__?.push(String(event.reason ?? 'unhandled rejection'));
        });
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      const assertSafe = async (secrets: readonly string[] = []) => {
        const text = await page.locator('body').innerText();
        if (/\bdelivery\.[A-Za-z]/.test(text)) {
          expect.unreachable('Expected !/\\bdelivery\\.[A-Za-z]/.test(text)');
        }
        if (/\{[^}]*\b(?:plural|select|number|date|time)\b/.test(text)) {
          expect.unreachable(
            'Expected !/\\{[^}]*\\b(?:plural|select|number|date|time)\\b/.test(text)',
          );
        }
        for (const secret of secrets) {
          if (text.includes(secret)) expect.unreachable('Expected !text.includes(secret)');
        }
        expect(
          await page.locator('[data-export-injection-title], [data-export-injection-fallback]')
            .count(),
        ).toStrictEqual(0);
        if (locale.startsWith('es-')) {
          for (
            const phrase of [
              'Export assessment',
              'Check the saved assessment against one exact destination before downloading it.',
              'QFlowLearn does not charge a separate portability fee for basic individual standards export.',
              'Review the portability pledge',
              'Available decisions',
              'Question outcomes',
              'Package evidence',
              'Destination',
              'Choose a destination',
              'Learning platforms',
              'QTI packages',
              'Running destination preflight',
              'QFlowLearn runs the destination profile when you select it.',
              'Select a destination to see item-level compatibility and scoring consequences.',
              'Accept manual scoring',
              'Accept diagnosed fallbacks',
              'Allow affected responses to use manual scoring at this destination.',
              'Allow the diagnosed destination fallbacks for affected questions.',
              'I reviewed the current export warnings',
              'This acknowledgement applies only to this saved assessment, destination, requirement set, and warning list.',
              'Preflight evaluates saved question revisions. Save an edited question before exporting it.',
              'Review destination mappings',
              'Automatic source scoring would become manual.',
              'Download',
              'Preserved',
              'Transformed',
              'Warning',
              'Blocked',
              '· Exact ·',
              '· Normalized ·',
              '· Lossy ·',
              '· automatic',
              '· unscored',
              'Fallback:',
              'Artifact size:',
            ]
          ) {
            if (text.includes(phrase)) {
              expect.unreachable(locale + ': English UI leaked: ' + phrase);
            }
          }
        }
        expect(pageErrors).toStrictEqual([]);
        expect(
          consoleErrors.filter((message) =>
            !message.includes('server responded with a status of 409 (Conflict)')
          ),
        ).toStrictEqual([]);
        expect(
          await page.evaluate(() =>
            (globalThis as typeof globalThis & { __UNHANDLED__?: string[] }).__UNHANDLED__ ?? []
          ),
        ).toStrictEqual([]);
      };
      try {
        const i18n = createI18n(locale, { delivery: catalogForLocale(locale).delivery! });
        const mainRequestStart = validateRequests.length;
        loadingGate = new Promise<void>((resolve) => releaseLoading = resolve);
        let holdFirstValidate = true;
        await page.route('**/api/assessments/assessment-1/validate*', async (route) => {
          if (holdFirstValidate) {
            holdFirstValidate = false;
            await loadingGate;
          }
          await route.continue();
        });
        await page.goto(
          'http://' + address.hostname + ':' + address.port + '/?locale=' + locale,
        );
        await page.getByLabel(i18n.t('delivery.preflight.destination')).selectOption('moodle');
        await page.locator('[aria-label="' + i18n.t('delivery.preflight.loading') + '"]')
          .waitFor({ state: 'attached' });
        const release = releaseLoading as unknown as (() => void);
        release();
        await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
        const baselineRequests = validateRequests.slice(mainRequestStart).filter((r) =>
          r.locale === locale && r.mode === 'main'
        );
        expect(baselineRequests.length).toStrictEqual(1);
        const baselineQuery = new URLSearchParams(baselineRequests[0].search.slice(1));
        expect(Object.fromEntries(baselineQuery)).toStrictEqual({
          target: 'moodle',
          scoring: 'manual-accepted',
          interaction: 'fallback-accepted',
        });
        const exportDetails = page.locator('details').filter({
          has: page.getByText(i18n.t('delivery.preflight.packageEvidence'), { exact: true }),
        });
        expect(await exportDetails.getAttribute('open')).toStrictEqual(null);
        expect(await exportDetails.locator('code').first().isVisible()).toStrictEqual(false);
        await verifyAssessmentExportNotices(page, i18n, locale, evidence);
        for (const summary of await page.locator('details summary').all()) {
          await summary.click();
        }
        const html = await page.locator('body').innerText();
        for (
          const key of [
            'delivery.preflight.title',
            'delivery.preflight.decisions',
            'delivery.preflight.questionOutcomes',
            'delivery.preflight.packageEvidence',
            'delivery.preflight.exportChangesDetail',
            'delivery.package.downloadStandardQuiz',
          ]
        ) {
          expect(html).toContain(i18n.t(key, { target: i18n.t('delivery.target.moodle') }));
        }
        expect(html).toContain(i18n.t('delivery.package.sizeMiB', { value: 1 }));
        expect(html).toContain(i18n.t('delivery.preflight.manualGradingSummary', { count: 1 }));
        expect(html).toContain(
          i18n.t('delivery.preflight.interactionChangesSummary', { count: 2 }),
        );
        expect(html).toContain('ITEM-<>&Ω');
        expect(html).toContain('<span data-export-injection-title="1">AUTHORED-WARNING</span>');
        expect(html).toContain('AUTHORED-WARNING');
        expect(html).toContain('AUTHORED-FALLBACK');
        expect(
          await page.locator('[data-export-injection-title], [data-export-injection-fallback]')
            .count(),
        ).toStrictEqual(0);
        expect(html).toContain('unknown.future_code');
        for (
          const key of [
            'delivery.outcome.preserved',
            'delivery.outcome.transformed',
            'delivery.outcome.warning',
            'delivery.outcome.blocked',
            'delivery.fidelity.exact',
            'delivery.fidelity.normalized',
            'delivery.fidelity.lossy',
            'delivery.scoring.automatic',
            'delivery.scoring.manual',
            'delivery.scoring.unscored',
            'delivery.mapping.review',
            'delivery.mapping.automaticLoss',
          ]
        ) expect(html).toContain(i18n.t(key, { scoring: i18n.t('delivery.scoring.manual') }));
        expect(html).toContain(i18n.t('delivery.preflight.exportChangesDetail'));
        expect(html).toContain(i18n.t('delivery.preflight.savedRevisionNote'));
        expect(html).toContain(i18n.t('delivery.repair.manualConsequence'));
        expect(html).toContain(i18n.t('delivery.repair.fallbackConsequence'));
        expect(html).toContain(i18n.t('delivery.package.artifactDetails', {
          bytes: i18n.t('delivery.package.sizeMiB', { value: 1 }),
        }));
        expect(html).toContain(i18n.t('delivery.mapping.fallback', {
          fallback: 'fallback <span data-export-injection-fallback="1">AUTHORED-FALLBACK</span>',
        }));
        expect(html).toContain(i18n.t('delivery.diagnostic.assetResolutionFailed'));
        expect(html).toContain(i18n.t('delivery.preflight.staticQuizTitle'));
        expect(html).toContain(i18n.t('delivery.diagnostic.adaptiveSequenceOmitted'));
        for (const theme of ['wireframe', 'dark']) {
          await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
          const colors = await page.locator('#assessment-export-changes p').evaluateAll((
            paragraphs,
          ) =>
            paragraphs.map((paragraph) => {
              const alert = paragraph.closest('.ds-alert');
              if (!alert) throw new Error('Export paragraph is outside its notice.');
              const context = document.createElement('canvas').getContext('2d');
              if (!context) throw new Error('Color verification requires a canvas context.');
              const luminance = (color: string) => {
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
                  .map((channel) => {
                    const value = channel / 255;
                    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                  });
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
              };
              const foreground = luminance(getComputedStyle(paragraph).color);
              const background = luminance(getComputedStyle(alert).backgroundColor);
              return {
                text: getComputedStyle(paragraph).color,
                alert: getComputedStyle(alert).color,
                contrast: (Math.max(foreground, background) + 0.05) /
                  (Math.min(foreground, background) + 0.05),
              };
            })
          );
          if (!(colors.length >= 2)) expect.unreachable('Expected colors.length >= 2');
          for (const color of colors) {
            expect(color.text).toStrictEqual(color.alert);
            if (!(color.contrast >= 4.5)) {
              expect.unreachable(`${theme}: notice contrast ${color.contrast}`);
            }
          }
        }
        await page.evaluate(() => document.documentElement.dataset.theme = 'wireframe');
        if (
          !(html.indexOf(i18n.t('delivery.preflight.staticQuizTitle')) <
            html.indexOf(i18n.t('delivery.preflight.questionOutcomes')))
        ) {
          expect.unreachable(
            "Expected html.indexOf(i18n.t('delivery.preflight.staticQuizTitle')) < html.indexOf(i18n.t('delivery",
          );
        }
        if (
          !(html.indexOf(i18n.t('delivery.package.downloadStandardQuiz')) <
            html.indexOf(i18n.t('delivery.preflight.questionOutcomes')))
        ) {
          expect.unreachable(
            "Expected html.indexOf(i18n.t('delivery.package.downloadStandardQuiz')) < html.indexOf(i18n.t('deliv",
          );
        }
        if (locale === 'en-US') {
          await page.screenshot({
            path: evidence.path('qflow-static-export-preflight.png'),
            fullPage: true,
          });
        }
        expect(
          await page.getByRole('list', { name: i18n.t('delivery.diagnostic.listLabel') }).count(),
        ).toStrictEqual(2);
        expect(html).toContain('moodle-xml@1');
        expect(html).toContain('choice → essay');
        expect(html).toContain(i18n.t('delivery.preflight.affectedQuestions', { count: 1 }));
        expect(html).toContain(i18n.t('delivery.preflight.affectedQuestions', { count: 2 }));
        await assertSafe();
        for (
          const key of [
            'delivery.summary.preserved',
            'delivery.summary.transformed',
            'delivery.summary.warning',
            'delivery.summary.blocked',
          ]
        ) {
          expect(html).toContain(i18n.t(key, { count: 1 }));
        }
        expect(
          await page.getByRole('button', {
            name: i18n.t('delivery.package.downloadStandardQuiz'),
          }).isDisabled(),
        ).toStrictEqual(false);
        expect(
          await page.getByRole('button', {
            name: i18n.t('delivery.package.downloadStandardQuiz'),
          }).isDisabled(),
        ).toStrictEqual(false);
        await page.getByRole('button', { name: i18n.t('delivery.repair.acceptManualScoring') })
          .click();
        await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
        const manualRequest = validateRequests.filter((r) =>
          r.locale === locale && r.mode === 'main' && r.search.includes('scoring=manual-accepted')
        );
        expect(
          validateRequests.filter((r) =>
            r.locale === locale && r.mode === 'main' &&
            r.search.includes('scoring=manual-accepted')
          ).length,
        ).toStrictEqual(2);
        const manualQuery = new URLSearchParams(manualRequest[0].search.slice(1));
        expect(manualQuery.get('scoring')).toStrictEqual('manual-accepted');
        await assertSafe();
        await page.reload();
        await page.getByLabel(i18n.t('delivery.preflight.destination')).selectOption('moodle');
        await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
        await page.getByRole('button', {
          name: i18n.t('delivery.repair.acceptDiagnosedFallbacks'),
        }).click();
        await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
        const fallbackRequest = validateRequests.filter((r) =>
          r.locale === locale && r.mode === 'main' &&
          r.search.includes('interaction=fallback-accepted')
        );
        expect(
          validateRequests.filter((r) =>
            r.locale === locale && r.mode === 'main' &&
            r.search.includes('interaction=fallback-accepted')
          ).length,
        ).toStrictEqual(4);
        const fallbackQuery = new URLSearchParams(fallbackRequest[0].search.slice(1));
        expect(fallbackQuery.get('interaction')).toStrictEqual('fallback-accepted');
        const mainSequence = validateRequests.slice(mainRequestStart).filter((r) =>
          r.locale === locale && r.mode === 'main'
        );
        expect(mainSequence.length).toStrictEqual(4);
        expect(mainSequence.map((r) => Object.fromEntries(new URLSearchParams(r.search.slice(1)))))
          .toStrictEqual([
            { target: 'moodle', scoring: 'manual-accepted', interaction: 'fallback-accepted' },
            { target: 'moodle', scoring: 'manual-accepted', interaction: 'fallback-accepted' },
            { target: 'moodle', scoring: 'manual-accepted', interaction: 'fallback-accepted' },
            { target: 'moodle', scoring: 'manual-accepted', interaction: 'fallback-accepted' },
          ]);
        await assertSafe();
        expect(await page.locator('#assessment-export-warning-acknowledgement').count())
          .toStrictEqual(0);
        await page.context().addCookies([{
          name: 'mode',
          value: 'adaptive',
          domain: address.hostname,
          path: '/',
        }]);
        await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`);
        await page.getByLabel(i18n.t('delivery.preflight.destination')).selectOption('moodle');
        await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
        expect(await page.locator('#assessment-export-changes li').count()).toStrictEqual(0);
        expect(await page.locator('#assessment-export-changes').innerText()).toContain(
          i18n.t('delivery.preflight.exportChangesDetail'),
        );
        expect(await page.locator('.ds-alert-warning, .ds-badge-warning').count()).toStrictEqual(0);
        expect(
          await page.getByText(i18n.t('delivery.diagnostic.adaptiveSequenceOmitted'), {
            exact: true,
          }).count(),
        ).toStrictEqual(1);
        const adaptiveDetails = page.getByText(i18n.t('delivery.preflight.packageEvidence'), {
          exact: true,
        });
        await adaptiveDetails.focus();
        await page.keyboard.press('Enter');
        if (
          !(await page.getByText('qflow.export.adaptive_sequence_omitted', {
            exact: true,
          }).isVisible())
        ) {
          expect.unreachable(
            "Expected await page.getByText('qflow.export.adaptive_sequence_omitted', { exact: true, }).isVisible",
          );
        }
        const adaptiveDownload = page.getByRole('button', {
          name: i18n.t('delivery.package.downloadStandardQuiz'),
        });
        expect(await adaptiveDownload.isDisabled()).toStrictEqual(false);
        await adaptiveDownload.click();
        await page.getByRole('link', { name: i18n.t('delivery.package.downloadReceipt') })
          .waitFor();
        const adaptiveRequest = packageRequests.filter((request) =>
          request.locale === locale && request.mode === 'adaptive'
        );
        expect(adaptiveRequest.length).toStrictEqual(1);
        expect(new URLSearchParams(adaptiveRequest[0].search).get('acknowledgement')).toStrictEqual(
          'b'.repeat(64),
        );
        if (locale === 'en-US') {
          await adaptiveDetails.click();
          for (const theme of ['wireframe', 'dark']) {
            await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
            await page.screenshot({
              path: evidence.path(`qflow-standard-quiz-${theme}.png`),
              fullPage: true,
              animations: 'disabled',
            });
          }
          await page.setViewportSize({ width: 375, height: 812 });
          if (!(await adaptiveDownload.isVisible())) {
            expect.unreachable('Expected await adaptiveDownload.isVisible()');
          }
          if (
            !(await page.evaluate(() =>
              document.documentElement.scrollWidth <= globalThis.innerWidth
            ))
          ) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth )',
            );
          }
          await page.screenshot({
            path: evidence.path('qflow-standard-quiz-mobile.png'),
            fullPage: true,
            animations: 'disabled',
          });
          await page.setViewportSize({ width: 1280, height: 720 });
        }
        await page.context().addCookies([{
          name: 'mode',
          value: 'informational',
          domain: address.hostname,
          path: '/',
        }]);
        await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`);
        await page.getByLabel(i18n.t('delivery.preflight.destination')).selectOption('moodle');
        await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
        await page.getByText(i18n.t('delivery.preflight.packageEvidence'), { exact: true })
          .click();
        if (
          !(await page.getByRole('button', {
            name: i18n.t('delivery.package.downloadTarget', {
              target: i18n.t('delivery.target.moodle'),
            }),
          }).isEnabled())
        ) {
          expect.unreachable(
            "Expected await page.getByRole('button', { name: i18n.t('delivery.package.downloadTarget', { target:",
          );
        }
        expect(await page.locator('#assessment-export-changes').count()).toStrictEqual(0);
        expect(await page.locator('input[type=checkbox]').count()).toStrictEqual(0);
        expect(await page.locator('body').innerText()).toContain(
          i18n.t('delivery.diagnostic.productEvidenceMissing'),
        );
        await page.context().clearCookies({ name: 'mode' });
        const preflightExpected = new Map<string, string>([
          ['PreflightStale', i18n.t('delivery.preflight.diagnosticStale')],
          ['not_found', i18n.t('delivery.preflight.diagnosticNotFound')],
          [
            'FutureFailure',
            i18n.t('delivery.preflight.rejectedWithCode', { code: 'FutureFailure' }),
          ],
          [
            'invalid-code',
            i18n.t('delivery.preflight.rejectedWithCode', { code: 'A'.repeat(81) }),
          ],
          ['invalid-success', i18n.t('delivery.preflight.invalidResponse')],
        ]);
        for (const mode of preflightModes) {
          await page.context().addCookies([{
            name: 'mode',
            value: mode,
            domain: address.hostname,
            path: '/',
          }]);
          await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`);
          await page.getByLabel(i18n.t('delivery.preflight.destination')).selectOption('moodle');
          await page.getByRole('alert').getByText(preflightExpected.get(mode)!).waitFor();
          expect(validateRequests.filter((r) => r.locale === locale && r.mode === mode).length)
            .toStrictEqual(1);
          const preflightRequest = validateRequests.filter((r) =>
            r.locale === locale && r.mode === mode
          )[0];
          expect(Object.fromEntries(new URLSearchParams(preflightRequest.search.slice(1))))
            .toStrictEqual({
              target: 'moodle',
              scoring: 'manual-accepted',
              interaction: 'fallback-accepted',
            });
          await assertSafe(['UPSTREAM_SECRET_' + mode]);
          await page.context().clearCookies({ name: 'mode' });
        }
        const packageExpected = new Map<string, string>([
          ['PreflightStale', i18n.t('delivery.package.stale')],
          ['PreflightBlocked', i18n.t('delivery.package.blocked')],
          ['WarningsNotAcknowledged', i18n.t('delivery.package.warningsNotAcknowledged')],
          ['not_found', i18n.t('delivery.package.notFound')],
          [
            'FuturePackageFailure',
            i18n.t('delivery.package.rejectedWithCode', { code: 'FuturePackageFailure' }),
          ],
          [
            'invalid-package',
            i18n.t('delivery.package.rejectedWithCode', { code: 'A'.repeat(81) }),
          ],
        ]);
        for (const mode of packageModes) {
          await page.context().addCookies([{
            name: 'mode',
            value: `package:${mode}`,
            domain: address.hostname,
            path: '/',
          }]);
          await page.goto(`http://${address.hostname}:${address.port}/?locale=${locale}`);
          await page.getByLabel(i18n.t('delivery.preflight.destination')).selectOption('moodle');
          await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
          const download = page.getByRole('button', {
            name: i18n.t('delivery.package.downloadStandardQuiz'),
          });
          await download.click();
          await page.getByRole('alert').getByText(packageExpected.get(mode)!).waitFor();
          expect(
            packageRequests.filter((r) => r.locale === locale && r.mode === 'package:' + mode)
              .length,
          ).toStrictEqual(1);
          const packageRequest = packageRequests.filter((r) =>
            r.locale === locale && r.mode === 'package:' + mode
          );
          expect(Object.fromEntries(new URLSearchParams(packageRequest[0].search.slice(1))))
            .toStrictEqual({
              target: 'moodle',
              preflightId: 'a'.repeat(64),
              scoring: 'manual-accepted',
              interaction: 'fallback-accepted',
              acknowledgement: 'b'.repeat(64),
            });
          await assertSafe(['UPSTREAM_PACKAGE_SECRET_' + mode]);
          if (await download.isDisabled()) {
            expect.unreachable('Expected !await download.isDisabled()');
          }
          await page.context().clearCookies({ name: 'mode' });
        }
        await page.context().addCookies([{
          name: 'mode',
          value: 'package:request-failure',
          domain: address.hostname,
          path: '/',
        }]);
        await page.goto('http://' + address.hostname + ':' + address.port + '/?locale=' + locale);
        await page.getByLabel(i18n.t('delivery.preflight.destination')).selectOption('moodle');
        await page.getByText(i18n.t('delivery.preflight.questionOutcomes')).waitFor();
        const networkDownload = page.getByRole('button', {
          name: i18n.t('delivery.package.downloadStandardQuiz'),
        });
        await networkDownload.click();
        await page.getByRole('alert').getByText(i18n.t('delivery.package.requestFailed'))
          .waitFor();
        expect(
          await page.evaluate(() =>
            (globalThis as typeof globalThis & { __PACKAGE_ATTEMPTS__?: number })
              .__PACKAGE_ATTEMPTS__ ?? 0
          ),
        ).toStrictEqual(1);
        expect(
          packageRequests.filter((r) => r.locale === locale && r.mode === 'package:request-failure')
            .length,
        ).toStrictEqual(0);
        if (await networkDownload.isDisabled()) {
          expect.unreachable('Expected !await networkDownload.isDisabled()');
        }
        await assertSafe();
        await page.context().clearCookies({ name: 'mode' });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await server?.close();
    if (tmp) await _fs.rm(tmp, { recursive: true });
  }
});
