import { expect, test as testCase } from 'vitest';

import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import { startFetchServer } from './helpers/fetch_server.ts';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { type QuestionTypeId, TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { type InterfaceLocale, parseInterfaceLocale } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';

const browserTypes: QuestionTypeId[] = [
  'single_select',
  'text_entry',
  'hotspot',
  'slider',
  'portable_custom',
];

testCase('qti preview browser renders qti3 player and records interaction state', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tmpDir = await _fs.mkdtemp(_path.join(process.cwd(), '.qti-preview-browser-'));
  const entryPath = `${tmpDir}/entry.ts`;
  const bundlePath = `${tmpDir}/bundle.js`;

  await _fs.writeFile(
    entryPath,
    `
import { h, render } from "preact";
import QtiItemPreview from "../islands/QtiItemPreview.tsx";

const root = document.getElementById("root");
if (window.__PREVIEW_CONFIG__.forceError) {
  const define = customElements.define.bind(customElements);
  customElements.define = (name, constructor, options) => {
    if (name === "qti-assessment-item-player") {
      Object.defineProperty(constructor.prototype, "loadXml", {
        value: () => Promise.reject(new Error("injected-secret-error")),
      });
    }
    define(name, constructor, options);
  };
}
window.renderPreview = (config) => render(h(QtiItemPreview, config), root);
window.renderPreview(window.__PREVIEW_CONFIG__);
`,
    'utf8',
  );

  const bundled = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
    entryPath,
    '--bundle',
    '--format=esm',
    '--jsx=automatic',
    '--jsx-import-source=preact',
    `--outfile=${bundlePath}`,
  ], { cwd: process.cwd() });
  if (!(bundled.success)) expect.unreachable(new TextDecoder().decode(bundled.stderr));
  const bundleText = await _fs.readFile(bundlePath, 'utf8');
  if (bundleText.includes('Finalizar intento')) {
    expect.unreachable("Expected !bundleText.includes('Finalizar intento')");
  }
  if (bundleText.includes('playerMessageCatalogForLocale')) {
    expect.unreachable("Expected !bundleText.includes('playerMessageCatalogForLocale')");
  }

  const xmlByType = Object.fromEntries(
    browserTypes.map((typeId) => {
      const result = buildQtiPreviewXml(
        prepareDriverDraftForBuild(typeId, {
          ...TYPE_DRIVERS[typeId].defaults(),
          itemLanguage: newAuthoringItemLanguage(),
        }),
        { identifier: `preview-browser-${typeId}` },
      );
      if (!(result.ok)) expect.unreachable(`${typeId} preview XML did not build`);
      return [typeId, result.xml];
    }),
  );

  const configs = new Map<InterfaceLocale, {
    xml: string;
    title: string;
    mode: 'author';
    showDiagnostics: boolean;
    payload: ReturnType<typeof createI18nPayload>;
    playerCatalog: ReturnType<typeof playerMessageCatalogForLocale>;
  }>();
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    configs.set(locale, {
      xml: xmlByType.single_select,
      title: 'Preview title',
      mode: 'author',
      showDiagnostics: true,
      payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
      playerCatalog: playerMessageCatalogForLocale(locale),
    });
  }
  const safeJson = (value: unknown) =>
    JSON.stringify(value)
      .replaceAll('<', '\\u003c')
      .replaceAll('\u2028', '\\u2028')
      .replaceAll('\u2029', '\\u2029');
  const server = await startFetchServer((req) => {
    const url = new URL(req.url);
    const requestedLocale = parseInterfaceLocale(url.searchParams.get('locale') ?? 'en-US');
    if (!requestedLocale) return new Response('Unsupported locale', { status: 400 });
    const config = configs.get(requestedLocale)!;
    if (url.pathname === '/config') {
      return new Response(JSON.stringify(config), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/bundle.js') {
      return new Response(_fsSync.readFileSync(bundlePath, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    return new Response(
      `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <script>
      window.__PREVIEW_CONFIG__ = ${
        safeJson({
          ...config,
          forceError: url.searchParams.has('broken'),
          xml: xmlByType[url.searchParams.get('type') ?? 'single_select'] ?? config.xml,
        })
      };
    </script>
    <script type="module" src="/bundle.js"></script>
  </body>
</html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });

  const browser = await chromium.launch();
  try {
    const page: import('playwright').Page = await browser.newPage();
    const baseUrl = `http://${'127.0.0.1'}:${server.port}`;

    for (const typeId of browserTypes) {
      await page.goto(`${baseUrl}/?locale=en-US&type=${typeId}`);
      const preview = page.locator('[data-qti-preview-host="true"]');
      await preview.waitFor();
      await preview.locator('qti-assessment-item-player').waitFor();
      await preview.getByText('Preview ready.').waitFor();
      const renderedText = await preview.locator('qti-assessment-item-player').innerText();
      if (!(renderedText.trim().length > 0)) {
        expect.unreachable(`${typeId} rendered no visible text`);
      }
    }

    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
      await page.goto(`${baseUrl}/?locale=${locale}&type=single_select`);
      const authoring = catalogForLocale(locale).authoring;
      const i18n = createI18n(locale, { authoring });
      const preview = page.locator('[data-qti-preview-host="true"]');
      await preview.getByText(authoring['preview.ready']).waitFor();
      const player = preview.locator('qti-assessment-item-player');
      await player.waitFor();
      const properties = await player.evaluate((element) => ({
        language: (element as PlayerProbe).languageOfInterface,
        catalogLocale: (element as PlayerProbe).messageCatalog?.locale,
        endAttempt: (element as PlayerProbe).messageCatalog?.strings?.endAttempt,
      }));
      if (!(properties.language === locale)) {
        expect.unreachable('Expected properties.language === locale');
      }
      if (!(properties.catalogLocale === locale)) {
        expect.unreachable('Expected properties.catalogLocale === locale');
      }
      if (!(properties.endAttempt === playerMessageCatalogForLocale(locale).strings.endAttempt)) {
        expect.unreachable(
          'Expected properties.endAttempt === playerMessageCatalogForLocale(locale).strings.endAttempt',
        );
      }
      await preview.getByRole('button', { name: authoring['preview.check'] }).waitFor();
      await preview.getByRole('button', { name: authoring['preview.resetButton'] }).waitFor();
      const zeroChanges = i18n.t('preview.responseChanges', { count: 0 });
      await preview.getByText(zeroChanges).waitFor();
      if (!((await preview.innerText()).includes('preview.') === false)) {
        expect.unreachable("Expected (await preview.innerText()).includes('preview.') === false");
      }
      const diagnosticsDispatch = await player.evaluate((element) => ({
        connected: element.isConnected,
        dispatched: element.dispatchEvent(
          new CustomEvent('qti-diagnostics', {
            detail: {
              diagnostics: [{
                severity: 'warning',
                code: 'HOSTILE-CODE',
                message: '<hostile diagnostic>',
              }],
            },
          }),
        ),
      }));
      const diagnostics = preview.locator('.bg-warning\\/10');
      if (!(diagnosticsDispatch.connected && diagnosticsDispatch.dispatched)) {
        expect.unreachable(
          'Expected diagnosticsDispatch.connected && diagnosticsDispatch.dispatched',
        );
      }
      await diagnostics.getByText(authoring['preview.diagnostics']).waitFor();
      await diagnostics.getByText(authoring['preview.severity.warning']).waitFor();
      await diagnostics.getByText('HOSTILE-CODE').waitFor();
      await diagnostics.getByText('<hostile diagnostic>').waitFor();
      await preview.getByRole('radio').first().click();
      await preview.getByText(i18n.t('preview.responseChanges', { count: 1 })).waitFor();
      await player.evaluate((element) => {
        globalThis.__QTI_EVENTS__ = [];
        element.addEventListener('qti-score', () => globalThis.__QTI_EVENTS__?.push('score'));
        element.addEventListener(
          'qti-validation',
          () => globalThis.__QTI_EVENTS__?.push('validation'),
        );
      });
      await preview.getByRole('button', { name: authoring['preview.check'] }).click();
      await page.waitForFunction(() =>
        (globalThis as typeof globalThis & {
          __QTI_EVENTS__?: string[];
        }).__QTI_EVENTS__?.length
      );
      const checkObservation = await player.evaluate((element) => ({
        events: globalThis.__QTI_EVENTS__,
        connected: element.isConnected,
        status: element.parentElement?.parentElement?.innerText ?? '',
        checkedRadios: element.querySelectorAll('input[type="radio"]:checked').length,
        serialized: typeof (element as PlayerProbe).serialize === 'function'
          ? (element as PlayerProbe).serialize?.()
          : undefined,
      }));
      if (
        !(checkObservation.events?.includes('score') ||
          checkObservation.events?.includes('validation'))
      ) expect.unreachable(JSON.stringify(checkObservation));
      await player.evaluate((element, events) => {
        element.dispatchEvent(
          new CustomEvent(events?.includes('score') ? 'qti-score' : 'qti-validation'),
        );
      }, checkObservation.events);
      await page.waitForTimeout(200);
      const expectedStatus = checkObservation.events?.includes('score')
        ? authoring['preview.score']
        : authoring['preview.validation'];
      if (!((await preview.innerText()).includes(expectedStatus))) {
        expect.unreachable(JSON.stringify({
          ...checkObservation,
          expectedStatus,
          hostText: await preview.innerText(),
        }));
      }
      await preview.getByRole('button', { name: authoring['preview.resetButton'] }).click();
      await preview.getByText(authoring['preview.reset']).waitFor();
      await preview.getByText(zeroChanges).waitFor();
      await player.evaluate((element) => {
        element.dispatchEvent(
          new CustomEvent('qti-statechange', {
            detail: { state: { responses: { A: 'x', B: 'y' } } },
          }),
        );
      });
      await preview.getByText(i18n.t('preview.responseChanges', { count: 2 })).waitFor();
    }

    await page.goto(`${baseUrl}/?locale=en-US&type=single_select`);
    const preview = page.locator('[data-qti-preview-host="true"]');
    await preview.getByText('Preview ready.').waitFor();
    const firstPlayer = await preview.locator('qti-assessment-item-player').elementHandle();
    await preview.locator('qti-assessment-item-player').evaluate((element) => {
      element.setAttribute('data-test-player-id', 'en-us-original');
    });
    await preview.getByRole('radio').first().click();
    await preview.getByText('1 response change').waitFor();
    await preview.getByRole('button', { name: 'Check' }).click();
    await preview.getByText('Score calculated.').waitFor();
    await preview.getByRole('button', { name: 'Reset' }).click();
    await preview.getByText('Preview reset.').waitFor();
    await preview.locator('qti-assessment-item-player').evaluate((element) => {
      element.dispatchEvent(
        new CustomEvent('qti-diagnostics', {
          detail: {
            diagnostics: [{
              severity: 'warning',
              code: 'HOSTILE-CODE',
              message: '<hostile diagnostic>',
            }],
          },
        }),
      );
    });
    await preview.getByText('Renderer diagnostics').waitFor();
    await preview.getByText('HOSTILE-CODE').waitFor();
    await preview.getByText('<hostile diagnostic>').waitFor();

    await page.evaluate(async () => {
      const response = await fetch('/config?locale=es-ES');
      const config = await response.json();
      globalThis.renderPreview(config);
    });
    const replacement = page.locator('[data-qti-preview-host="true"]');
    await replacement.getByText('Vista previa lista.').waitFor();
    if (!(await replacement.getByRole('button', { name: 'Comprobar' }).count() === 1)) {
      expect.unreachable(
        "Expected await replacement.getByRole('button', { name: 'Comprobar' }).count() === 1",
      );
    }
    const secondPlayer = await replacement.locator('qti-assessment-item-player').elementHandle();
    if (!(firstPlayer !== null && secondPlayer !== null)) {
      expect.unreachable('Expected firstPlayer !== null && secondPlayer !== null');
    }
    if (!(await firstPlayer!.evaluate((element) => element.isConnected) === false)) {
      expect.unreachable(
        'Expected await firstPlayer!.evaluate((element) => element.isConnected) === false',
      );
    }
    if (!(await page.locator('[data-test-player-id="en-us-original"]').count() === 0)) {
      expect.unreachable(
        'Expected await page.locator(\'[data-test-player-id="en-us-original"]\').count() === 0',
      );
    }
    await replacement.locator('qti-assessment-item-player').evaluate((element) => {
      element.setAttribute('data-test-player-id', 'es-es-replacement');
    });
    if (!(await page.locator('[data-test-player-id="es-es-replacement"]').count() === 1)) {
      expect.unreachable(
        'Expected await page.locator(\'[data-test-player-id="es-es-replacement"]\').count() === 1',
      );
    }
    const replacementProperties = await replacement.locator('qti-assessment-item-player')
      .evaluate(
        (element) => ({
          language: (element as PlayerProbe).languageOfInterface,
          catalogLocale: (element as PlayerProbe).messageCatalog?.locale,
          endAttempt: (element as PlayerProbe).messageCatalog?.strings?.endAttempt,
        }),
      );
    if (!(replacementProperties.language === 'es-ES')) {
      expect.unreachable("Expected replacementProperties.language === 'es-ES'");
    }
    if (!(replacementProperties.catalogLocale === 'es-ES')) {
      expect.unreachable("Expected replacementProperties.catalogLocale === 'es-ES'");
    }
    if (
      !(replacementProperties.endAttempt ===
        playerMessageCatalogForLocale('es-ES').strings.endAttempt)
    ) {
      expect.unreachable(
        "Expected replacementProperties.endAttempt === playerMessageCatalogForLocale('es-ES').strings.endAtt",
      );
    }

    await page.goto(`${baseUrl}/?locale=en-US&type=single_select&broken=1`);
    const failedPreview = page.locator('[data-qti-preview-host="true"]');
    await failedPreview.getByText('Unable to load preview.').waitFor();
    if (!((await failedPreview.innerText()).includes('injected-secret-error') === false)) {
      expect.unreachable(
        "Expected (await failedPreview.innerText()).includes('injected-secret-error') === false",
      );
    }
    await page.goto(`${baseUrl}/?locale=es-ES&type=single_select&broken=1`);
    const failedSpanishPreview = page.locator('[data-qti-preview-host="true"]');
    await failedSpanishPreview.getByText('No se puede cargar la vista previa.').waitFor();
    if (!((await failedSpanishPreview.innerText()).includes('injected-secret-error') === false)) {
      expect.unreachable(
        "Expected (await failedSpanishPreview.innerText()).includes('injected-secret-error') === false",
      );
    }
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tmpDir, { recursive: true });
  }
});

declare global {
  var renderPreview: (config: Record<string, unknown>) => void;
  var __QTI_EVENTS__: string[] | undefined;
  type PlayerProbe = HTMLElement & {
    languageOfInterface: string;
    messageCatalog?: { locale?: string; strings?: { endAttempt?: string } };
    serialize?: () => unknown;
  };
  interface Window {
    __PREVIEW_CONFIG__: Record<string, unknown>;
    renderPreview: (config: Record<string, unknown>) => void;
  }
}
