import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
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

testCase('image editor browser supports pointer, keyboard, history, transforms, and PNG apply', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tempDirectory = await _fs.mkdtemp(_path.join(process.cwd(), '.image-editor-browser-'));
  const entryPath = `${tempDirectory}/entry.ts`;
  const bundlePath = `${tempDirectory}/bundle.js`;
  const source = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
        <mask id="transparent-center">
          <rect width="800" height="600" fill="white"/>
          <circle cx="400" cy="300" r="40" fill="black"/>
        </mask>
        <g mask="url(#transparent-center)">
          <rect width="400" height="300" fill="#ef4444"/>
          <rect x="400" width="400" height="300" fill="#3b82f6"/>
          <rect y="300" width="400" height="300" fill="#22c55e"/>
          <rect x="400" y="300" width="400" height="300" fill="#eab308"/>
        </g>
      </svg>
    `;
  const embeddedSource = `data:image/svg+xml;base64,${btoa(source)}`;

  await _fs.writeFile(
    entryPath,
    `
import { h, render } from "preact";
import ImageEditor from "../components/ui/ImageEditor.tsx";
import { I18nProvider } from "../lib/i18n/context.tsx";
import "../islands/drivers/media.tsx";
import { driverViewsFor } from "../islands/drivers/view_registry.ts";

const root = document.getElementById("root");
window.__APPLY_PENDING__ = new Promise((resolve) => {
  window.__RELEASE_APPLY__ = resolve;
});
window.__FAIL_NEXT_APPLY__ = true;
window.__RENDER_MEDIA_AUTHORING__ = () => {
  const mediaViews = driverViewsFor("media");
  if (!mediaViews) throw new Error("Media authoring view is unavailable.");
  render(
    h(I18nProvider, { payload: globalThis.__IMAGE_EDITOR_PAYLOAD__ }, h(mediaViews.ui, {
      typeId: "media",
      draft: {
        type: "media",
        title: "Timeline question",
        bodyHtml: "<p>Integrated question context</p>",
        promptHtml: "Integrated instruction",
        responseIdentifier: "RESPONSE",
        mediaKind: "object",
        mediaSources: [{ src: window.__IMAGE_SOURCE__, type: "image/svg+xml" }],
        mediaCaptionSrc: "",
        mediaCaptionLang: "en",
        mediaTranscript: "",
        mediaObjectLabel: "Integrated accessible description",
      },
      update: () => {},
      editor: {
        renderPromptField: () => h("span"),
        fieldHasIssue: () => false,
        fieldIssueText: () => undefined,
      },
    })),
    root,
  );
};
render(
  h(I18nProvider, { payload: globalThis.__IMAGE_EDITOR_PAYLOAD__ }, h(ImageEditor, {
    src: window.__IMAGE_SOURCE__,
    composition: {
      bodyHtml: "<p>Which region changed?</p>",
      promptHtml: "Review the timeline.",
      accessibleDescription: "Four colored regions surrounding a transparent center.",
    },
    onApply: async (file) => {
      window.__APPLIED_FILE__ = { size: file.size, type: file.type };
      if (window.__FAIL_NEXT_APPLY__) {
        window.__FAIL_NEXT_APPLY__ = false;
        return {
          _tag: "error",
          error: { code: "processing-failed", diagnostic: "HOSTILE-UPSTREAM-DETAIL" },
        };
      }
      await window.__APPLY_PENDING__;
      return { _tag: "ok" };
    },
  })),
  root,
);
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
  if (bundleText.includes('catalogForLocale')) {
    expect.unreachable("Expected !bundleText.includes('catalogForLocale')");
  }
  if (bundleText.includes('CATALOGS')) {
    expect.unreachable("Expected !bundleText.includes('CATALOGS')");
  }
  if (bundleText.includes('PLAYER_MESSAGE_CATALOGS')) {
    expect.unreachable("Expected !bundleText.includes('PLAYER_MESSAGE_CATALOGS')");
  }
  if (bundleText.includes('messages/es-ES')) {
    expect.unreachable("Expected !bundleText.includes('messages/es-ES')");
  }
  if (bundleText.includes('lib/i18n/messages/')) {
    expect.unreachable("Expected !bundleText.includes('lib/i18n/messages/')");
  }
  for (
    const marker of ['messages/en-US', 'messages/en-GB', 'messages/es-ES', 'messages/es-419']
  ) {
    if (bundleText.includes(marker)) {
      expect.unreachable('Expected !bundleText.includes(marker)');
    }
  }

  let sourceRequestCount = 0;
  const pageErrors: string[] = [];
  const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
  const payloads = new Map(locales.map((locale) => [
    locale,
    createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
  ]));
  const server = await startFetchServer((request) => {
    const requestUrl = new URL(request.url);
    const locale = (requestUrl.searchParams.get('locale') ?? 'en-US') as InterfaceLocale;
    const pathname = new URL(request.url).pathname;
    if (pathname === '/source.svg') {
      sourceRequestCount += 1;
      return new Response(source, {
        headers: { 'content-type': 'image/svg+xml' },
      });
    }
    if (pathname === '/bundle.js') {
      return new Response(_fsSync.readFileSync(bundlePath, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (pathname === '/tw.css') {
      return new Response(_fsSync.readFileSync('static/tw.css', 'utf8'), {
        headers: { 'content-type': 'text/css' },
      });
    }
    const payload = payloads.get(locale);
    if (!payload) return new Response('Unsupported locale', { status: 400 });
    return new Response(
      `<!doctype html>
          <html lang="${locale}">
            <head>
              <meta name="viewport" content="width=device-width">
              <link rel="stylesheet" href="/tw.css">
              <style>
                body { font-family: sans-serif; margin: 24px; max-width: 1100px; }
              </style>
            </head>
            <body>
              <div id="root"></div>
              <script>window.__IMAGE_EDITOR_PAYLOAD__ = ${
                JSON.stringify(payload).replaceAll('<', '\\u003c')
              };</script>
              <script>window.__IMAGE_SOURCE__ = "/source.svg";</script>
              <script type="module" src="/bundle.js"></script>
            </body>
          </html>`,
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
        },
      },
    );
  });

  const browser = await chromium.launch();
  try {
    for (const locale of locales) {
      const page: import('playwright').Page = await browser.newPage({
        viewport: { width: 1200, height: 1000 },
      });
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      const i18n = createI18n(locale, catalogForLocale(locale));
      try {
        await page.goto(`http://${'127.0.0.1'}:${server.port}/?locale=${locale}`);
        await page.getByRole('button', { name: i18n.t('editor.imageEdit') }).click();
        await page.locator(`section[aria-label="${i18n.t('editor.imageEditRegion')}"]`).waitFor(
          { timeout: 5000 },
        );
        const composition = page.getByRole('region', {
          name: i18n.t('editor.questionCompositionPreview'),
        });
        await composition.getByText('Which region changed?').waitFor();
        await composition.getByText('Review the timeline.').waitFor();
        await composition.getByText(
          'Four colored regions surrounding a transparent center.',
        ).waitFor();
        await page.getByLabel(i18n.t('editor.cropRatio')).waitFor();
        await page.getByText(i18n.t('editor.resultPreview')).waitFor();
        await page.locator('input[type="range"]').first().evaluate((element) => {
          const input = element as HTMLInputElement;
          input.value = '1.5';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const zoomAnnouncement = i18n.t('editor.imageZoomSet', { zoom: 1.5 });
        await page.waitForFunction(
          (expected) =>
            [...document.querySelectorAll('[aria-live="polite"]')].some((node) =>
              (node.textContent ?? '').replaceAll('\u00a0', ' ') ===
              expected.replaceAll('\u00a0', ' ')
            ),
          zoomAnnouncement,
        );
        await page.getByRole('button', { name: i18n.t('editor.rotateRight') }).click();
        await page.getByText(i18n.t('editor.rotatedRight')).waitFor();
        await page.getByRole('button', { name: i18n.t('editor.applyEdits') }).click();
        await page.getByText(i18n.t('editor.uploadFailed')).waitFor();
        if ((await page.locator('body').innerText()).includes('HOSTILE-UPSTREAM-DETAIL')) {
          expect.unreachable(
            "Expected !(await page.locator('body').innerText()).includes('HOSTILE-UPSTREAM-DETAIL')",
          );
        }
        if (locale.startsWith('es-')) {
          const text = await page.locator('body').innerText();
          for (
            const english of [
              'Edit image',
              'Image editor',
              'Crop ratio',
              'Result preview',
              'Apply image edits',
            ]
          ) {
            if (text.includes(english)) expect.unreachable('Expected !text.includes(english)');
          }
          if (!(text.includes('Which region changed?'))) {
            expect.unreachable("Expected text.includes('Which region changed?')");
          }
        }
      } finally {
        await page.close();
      }
    }
    const page: import('playwright').Page = await browser.newPage({
      viewport: { width: 1200, height: 1000 },
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(`http://${'127.0.0.1'}:${server.port}/?locale=en-US`);
    await page.getByRole('button', { name: 'Edit image' }).click();
    await page.getByRole('region', { name: 'Image editor' }).waitFor();

    const inQuestion = page.getByRole('button', { name: 'In question' });
    expect(await inQuestion.getAttribute('aria-pressed')).toStrictEqual('true');
    const composition = page.getByRole('region', { name: 'Question composition preview' });
    await composition.getByText('Which region changed?').waitFor();
    await composition.getByText('Review the timeline.').waitFor();
    await composition.getByText(
      'Four colored regions surrounding a transparent center.',
    ).waitFor();
    await composition.getByRole('img', {
      name: 'Four colored regions surrounding a transparent center.',
    }).waitFor();
    expect(
      await composition.getByRole('img', {
        name: 'Four colored regions surrounding a transparent center.',
      }).evaluate(visibleColoredPixel),
    ).toStrictEqual(true);

    await page.getByRole('button', { name: 'Apply image edits' }).click();
    await page.getByText('QFlowLearn could not process this file. Try again.').waitFor();
    await page.getByRole('button', { name: 'Image only' }).click();
    expect(await inQuestion.getAttribute('aria-pressed')).toStrictEqual('false');
    await page.getByText('QFlowLearn could not process this file. Try again.').waitFor();

    const cropRatio = page.getByLabel('Crop ratio');
    await cropRatio.selectOption('square');
    expect(await page.getByLabel('Width (px)').inputValue()).toStrictEqual('600');
    expect(await page.getByLabel('Height (px)').inputValue()).toStrictEqual('600');
    await page.getByText('Crop: 600 × 600 px · 100% zoom').waitFor();
    expect(
      await page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        const context = canvas.getContext('2d');
        if (!context) return false;
        const pixel = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
        const color = `${pixel[0]},${pixel[1]},${pixel[2]}`;
        return pixel[3] === 255 && (color === '248,250,252' || color === '203,213,225');
      }),
    ).toStrictEqual(true);
    expect(
      await page.getByLabel('Preview of the edited image').evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return -1;
        const context = canvas.getContext('2d');
        if (!context) return -1;
        return context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3];
      }),
    ).toStrictEqual(0);
    const centeredCropStyle = await page.getByRole('button', {
      name: 'Move crop area',
    }).getAttribute('style');
    const guides = page.getByRole('button', { name: 'Rule of thirds' });
    expect(await guides.getAttribute('aria-pressed')).toStrictEqual('false');
    await guides.click();
    expect(await guides.getAttribute('aria-pressed')).toStrictEqual('true');
    const previewBackground = page.getByLabel('Preview background');
    expect(await previewBackground.inputValue()).toStrictEqual('checkerboard');
    await previewBackground.selectOption('dark');
    const previewSurface = page.locator('[data-image-preview-background]');
    expect(await previewSurface.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toStrictEqual('rgb(17, 24, 39)');
    await previewBackground.selectOption('checkerboard');
    await page.getByLabel('Width (px)').fill('900');
    await page.getByLabel('Width (px)').press('Enter');
    await page.getByLabel('Lock ratio').uncheck();

    const handles = [
      'Resize crop from top',
      'Resize crop from top right',
      'Resize crop from right',
      'Resize crop from bottom right',
      'Resize crop from bottom',
      'Resize crop from bottom left',
      'Resize crop from left',
      'Resize crop from top left',
    ];
    for (const label of handles) {
      expect(await page.getByRole('button', { name: label, exact: true }).count()).toStrictEqual(1);
    }

    const move = page.getByRole('button', { name: 'Move crop area' });
    await move.press('ArrowRight');
    if (!(await page.getByRole('button', { name: 'Undo' }).isEnabled())) {
      expect.unreachable("Expected await page.getByRole('button', { name: 'Undo' }).isEnabled()");
    }
    await move.press('Shift+ArrowRight');
    expect(await page.getByLabel('Width (px)').inputValue()).toStrictEqual('900');
    expect(await page.getByLabel('Lock ratio').isChecked()).toStrictEqual(false);
    await page.getByRole('button', { name: 'Center crop' }).click();
    expect(await move.getAttribute('style')).toStrictEqual(centeredCropStyle);

    const cropStyleBeforeDrag = await move.getAttribute('style');
    const moveBox = await move.boundingBox();
    if (!moveBox) expect.unreachable('Expected moveBox');
    await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(moveBox.x + moveBox.width / 2 + 24, moveBox.y + moveBox.height / 2);
    await page.mouse.up();
    if (!(await move.getAttribute('style') !== cropStyleBeforeDrag)) {
      expect.unreachable('Pointer drag did not update the crop position.');
    }

    const cropStyleBeforeCancel = await move.getAttribute('style');
    const cancelBox = await move.boundingBox();
    if (!cancelBox) expect.unreachable('Expected cancelBox');
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      cancelBox.x + cancelBox.width / 2 + 24,
      cancelBox.y + cancelBox.height / 2,
    );
    if (!(await move.getAttribute('style') !== cropStyleBeforeCancel)) {
      expect.unreachable('Pointer preview did not update before cancellation.');
    }
    await move.dispatchEvent('pointercancel', { pointerId: 1 });
    expect(await move.getAttribute('style')).toStrictEqual(cropStyleBeforeCancel);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await move.getAttribute('style')).toStrictEqual(cropStyleBeforeDrag);
    await page.getByRole('button', { name: 'Redo' }).click();
    expect(await move.getAttribute('style')).toStrictEqual(cropStyleBeforeCancel);

    await page.getByRole('button', { name: 'Rotate right' }).click();
    expect(await page.getByLabel('Width (px)').inputValue()).toStrictEqual('900');
    expect(await page.getByLabel('Lock ratio').isChecked()).toStrictEqual(false);
    await page.getByRole('button', { name: 'Flip horizontal' }).click();
    expect(await page.getByRole('button', { name: 'Flip horizontal' }).getAttribute('aria-pressed'))
      .toStrictEqual('true');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.getByLabel('Straighten').press('End');

    const preview = page.getByLabel('Preview of the edited image');
    if (
      !(await preview.evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) {
          return false;
        }
        const context = canvas.getContext('2d');
        if (!context) return false;
        const corners = [
          [0, 0],
          [canvas.width - 1, 0],
          [0, canvas.height - 1],
          [canvas.width - 1, canvas.height - 1],
        ];
        return corners.every(([x, y]) => context.getImageData(x, y, 1, 1).data[3] === 255);
      }))
    ) expect.unreachable('Straightening left transparent corners in the result preview.');

    const requestsBeforeApply = sourceRequestCount;
    await page.getByRole('button', { name: 'Apply image edits' }).click();
    await page.getByRole('button', { name: 'Applying edits…' }).waitFor();
    expect(sourceRequestCount).toStrictEqual(requestsBeforeApply);
    await page.evaluate(() => document.defaultView?.__RELEASE_APPLY__?.());
    await page.getByRole('button', { name: 'Edit image' }).waitFor();
    const applied = await page.evaluate(() => document.defaultView?.__APPLIED_FILE__);
    if (!applied) expect.unreachable('Expected applied');
    expect(applied.type).toStrictEqual('image/png');
    if (!(applied.size > 0)) expect.unreachable('Expected applied.size > 0');

    await page.evaluate(() => document.defaultView?.__RENDER_MEDIA_AUTHORING__?.());
    await page.getByRole('button', { name: 'Edit image' }).click();
    const integratedComposition = page.getByRole('region', {
      name: 'Question composition preview',
    });
    await integratedComposition.getByText('Integrated question context').waitFor();
    await integratedComposition.getByText('Integrated instruction').waitFor();
    await integratedComposition.getByText('Integrated accessible description').waitFor();
    expect(
      await integratedComposition.getByRole('img', {
        name: 'Integrated accessible description',
      }).evaluate(visibleColoredPixel),
    ).toStrictEqual(true);

    await page.getByRole('button', { name: 'Close image editor' }).click();
    await page.getByRole('button', { name: 'Edit image' }).waitFor();
    await page.evaluate((src) => {
      const view = document.defaultView;
      if (!view) throw new Error('Browser window is unavailable.');
      view.__IMAGE_SOURCE__ = src;
      view.__RENDER_MEDIA_AUTHORING__?.();
    }, embeddedSource);
    await page.getByRole('button', { name: 'Edit image' }).click();
    await page.getByRole('region', { name: 'Image editor' }).waitFor();
    await page.getByRole('button', { name: 'Image only' }).click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[aria-label="Preview of the edited image"]');
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      return context.getImageData(20, 20, 1, 1).data[3] > 0;
    });
    expect(pageErrors).toStrictEqual([]);
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tempDirectory, { recursive: true });
  }
});

declare global {
  interface Window {
    __IMAGE_SOURCE__: string;
    __APPLIED_FILE__?: { size: number; type: string };
    __APPLY_PENDING__: Promise<void>;
    __FAIL_NEXT_APPLY__: boolean;
    __RELEASE_APPLY__?: () => void;
    __RENDER_MEDIA_AUTHORING__?: () => void;
  }
}

function visibleColoredPixel(element: Element): boolean {
  if (!(element instanceof HTMLCanvasElement) || !element.width || !element.height) return false;
  const context = element.getContext('2d');
  if (!context) return false;
  const pixel = context.getImageData(
    Math.floor(element.width / 4),
    Math.floor(element.height / 4),
    1,
    1,
  ).data;
  return pixel[3] === 255 && pixel[0] > 200 && pixel[1] < 120 && pixel[2] < 120;
}
