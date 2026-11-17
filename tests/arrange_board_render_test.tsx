import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { createRef } from 'preact';

import ArrangeBoard from '../islands/arrange_board/ArrangeBoard.tsx';
import PartSettingsModal from '../islands/arrange_board/PartSettingsModal.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

function payload(locale: InterfaceLocale) {
  return createI18nPayload(locale, catalogForLocale(locale), ['assessments', 'items']);
}

testCase('arrange board renders clear drag handles for parts and questions', () => {
  const html = renderToString(
    <ArrangeBoard
      initialVersion={'1'.repeat(64)}
      assessmentId='assessment-1'
      initialParts={[{
        id: 'part-1',
        title: 'Presidents',
        placements: [{ id: 'placement-1', itemId: 'item-1' }],
      }]}
      items={{
        'placement-1': {
          id: 'placement-1',
          title: 'Fill in the missing Presidents.',
          questionType: 'Gap Match',
        },
      }}
      payload={payload('en-US')}
    />,
  );

  expect(html).toContain('aria-label="Drag part 1: Presidents"');
  expect(html).toContain('aria-label="Drag question 1: Fill in the missing Presidents."');
  expect(html).toContain('cursor-grab');
  expect(html).toContain('<circle cx="5.5" cy="3.5" r="1.25"></circle>');
  expect(html).toContain('href="/assessments/assessment-1?tool=assessment-export"');
  if (html.includes('/api/assessments/assessment-1/package')) {
    expect.unreachable("Expected !html.includes('/api/assessments/assessment-1/package')");
  }
  expect(html.includes('≡')).toStrictEqual(false);
});

const authoredParts = [
  {
    id: 'part-1',
    title: '<script>alert(1)</script>',
    placements: [{ id: 'placement-1', itemId: 'item-1' }],
  },
  { id: 'part-2', title: '', placements: [] },
];
const authoredItems = {
  'placement-1': {
    id: 'placement-1',
    title: '<img src=x onerror=alert(1)>',
    questionType: 'single_select',
  },
};

testCase('arrange board localizes all board framing in every locale', () => {
  const htmlByLocale = new Map<InterfaceLocale, string>();
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = renderToString(
      <ArrangeBoard
        initialVersion={'1'.repeat(64)}
        assessmentId='assessment-1'
        initialParts={authoredParts}
        items={authoredItems}
        deliveryPreviewUrl='/assessments/assessment-1/deliver'
        payload={payload(locale)}
      />,
    );
    htmlByLocale.set(locale, html);
    for (
      const id of [
        'assessments.arrange.title',
        'assessments.arrange.cancel',
        'assessments.arrange.actions',
        'assessments.arrange.export',
        'assessments.arrange.launch',
        'assessments.arrange.partSettings',
        'assessments.arrange.partActions',
        'assessments.arrange.moveUp',
        'assessments.arrange.moveDown',
        'assessments.arrange.deletePart',
        'assessments.arrange.dropQuestions',
        'assessments.arrange.questionActions',
        'assessments.arrange.edit',
        'assessments.arrange.moveTo',
        'assessments.arrange.remove',
        'assessments.arrange.addPart',
      ]
    ) expect(html).toContain(i18n.t(id));
    expect(html).toContain(i18n.t('assessments.arrange.itemCount', { count: 1 }));
    expect(html).toContain(i18n.t('assessments.arrange.itemCount', { count: 0 }));
    expect(html).toContain(i18n.t('assessments.arrange.partLabel', { count: 1, title: '' }));
    expect(html).toContain(i18n.t('items.detail.questionType', { type: 'single_select' }));
    expect(html).toContain('&lt;script>alert(1)&lt;/script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)>');
    expect(html).toContain('assessment-1?tool=assessment-export');
    expect(html).toContain('/assessments/assessment-1/deliver');
    expect(html.includes('assessments.arrange.')).toStrictEqual(false);
    expect(html.includes('items.detail.')).toStrictEqual(false);
    if (locale === 'es-ES' || locale === 'es-419') {
      for (
        const formerEnglish of [
          'Arrange assessment',
          'Add Part',
          'Navigation mode',
          'Submission mode',
          'Feedback HTML',
        ]
      ) expect(html.includes(formerEnglish)).toStrictEqual(false);
    }
  }
  if (!(htmlByLocale.get('en-US') !== htmlByLocale.get('es-ES'))) {
    expect.unreachable("Expected htmlByLocale.get('en-US') !== htmlByLocale.get('es-ES')");
  }
});

testCase('arrange board exposes empty, plural, and localized fallback states', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = renderToString(
      <ArrangeBoard
        initialVersion={'1'.repeat(64)}
        assessmentId='assessment-1'
        initialParts={[{ id: 'empty', title: '', placements: [] }]}
        items={{}}
        payload={payload(locale)}
      />,
    );
    expect(html).toContain(i18n.t('assessments.arrange.untitledPart'));
    expect(html).toContain(i18n.t('assessments.arrange.dropQuestions'));
    expect(html).toContain(i18n.t('assessments.arrange.itemCount', { count: 0 }));
    expect(html).toContain('data-arrange-part-settings');
  }
});

testCase('part settings modal renders complete localized labels and stable option values', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = renderToString(
      <I18nProvider payload={payload(locale)}>
        <PartSettingsModal
          items={{}}
          open
          activePart={{
            id: 'part-2',
            title: 'Authored title',
            placements: [],
            options: {
              navigationMode: 'linear',
              submissionMode: 'simultaneous',
              timeLimits: { minTime: 1, maxTime: 2 },
              instructionsHtml: '<p>Keep this HTML</p>',
              feedback: [{
                id: '11111111-1111-4111-8111-111111111111',
                access: 'atEnd',
                showHide: 'show',
                outcomeIdentifier: 'SCORE',
                html: '<p>Feedback</p>',
              }],
            },
          }}
          activePartIndex={1}
          returnFocusRef={createRef()}
          onClose={() => undefined}
          setParts={() => undefined}
          onValidityChange={() => undefined}
        />
      </I18nProvider>,
    );
    for (
      const id of [
        'assessments.arrange.modal.title',
        'assessments.arrange.modal.close',
        'assessments.arrange.modal.navigation',
        'assessments.arrange.modal.linear',
        'assessments.arrange.modal.nonlinear',
        'assessments.arrange.modal.submission',
        'assessments.arrange.modal.individual',
        'assessments.arrange.modal.simultaneous',
        'assessments.arrange.modal.minTime',
        'assessments.arrange.modal.maxTime',
        'assessments.arrange.modal.instructions',
        'assessments.arrange.modal.feedback',
        'assessments.arrange.modal.simpleBlock',
        'assessments.arrange.modal.outcome',
        'assessments.arrange.modal.feedbackHtml',
      ]
    ) {
      expect(html).toContain(
        i18n.t(id, id === 'assessments.arrange.modal.title' ? { part: 2 } : undefined),
      );
    }
    for (
      const value of ['linear', 'nonlinear', 'individual', 'simultaneous', 'SCORE']
    ) {
      expect(html).toContain(value);
    }
    expect(html).toContain('Keep this HTML');
    expect(html.includes('assessments.arrange.modal.')).toStrictEqual(false);
  }
});

testCase('arrange board Cancel leaves the page and confirms before discarding changes', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tempDirectory = await _fs.mkdtemp(_path.join(process.cwd(), '.arrange-board-browser-'));
  const entryPath = `${tempDirectory}/entry.tsx`;
  const bundlePaths = new Map<InterfaceLocale, string>();
  for (const locale of locales) {
    const bundlePath = `${tempDirectory}/bundle-${locale}.js`;
    bundlePaths.set(locale, bundlePath);
    await _fs.writeFile(
      entryPath,
      `
import { render } from "preact";
import ArrangeBoard from "../islands/arrange_board/ArrangeBoard.tsx";

const payload = ${JSON.stringify(payload(locale))};

render(
  <ArrangeBoard
      initialVersion={'1'.repeat(64)}
    assessmentId="assessment-1"
    initialParts={[{
      id: "part-1",
      title: "Presidents",
      placements: [{ id: "placement-1", itemId: "item-1", snapshotRev: 3, blueprintTargetId: "target-1" }],
      options: {
        navigationMode: "nonlinear",
        submissionMode: "individual",
        timeLimits: { minTime: 5, maxTime: 60 },
        instructionsHtml: "<p>Candidate instructions</p>",
        feedback: [{ id: "11111111-1111-4111-8111-111111111111", access: "atEnd", showHide: "show", outcomeIdentifier: "SCORE", html: "<p>Feedback</p>" }],
      },
    }, {
      id: "part-2",
      title: "Second part",
      placements: [],
    }]}
    items={{ "placement-1": { id: "placement-1", title: "Question title", questionType: "single_select" } }}
    payload={payload}
  />,
  document.getElementById("root"),
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
    expect(bundleText.includes('catalogForLocale')).toStrictEqual(false);
    expect(bundleText.includes('CATALOGS')).toStrictEqual(false);
  }

  const server = await startFetchServer((request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/bundle.js') {
      const locale = (url.searchParams.get('locale') ?? 'en-US') as InterfaceLocale;
      const path = bundlePaths.get(locale) ?? bundlePaths.get('en-US')!;
      return new Response(_fsSync.readFileSync(path, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (pathname === '/assessments/assessment-1') {
      return new Response('<h1>Assessment overview</h1>', {
        headers: { 'content-type': 'text/html' },
      });
    }
    const locale = locales.includes((url.searchParams.get('locale') ?? 'en-US') as InterfaceLocale)
      ? (url.searchParams.get('locale') ?? 'en-US')
      : 'en-US';
    return new Response(
      `<!doctype html>
          <html lang="${locale}">
            <body>
              <div id="root"></div>
              <script type="module" src="/bundle.js?locale=${locale}"></script>
            </body>
          </html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  });

  const browser = await chromium.launch();
  try {
    const page: import('playwright').Page = await browser.newPage();
    const arrangeRequests: unknown[] = [];
    const saveControl: { release: (() => void) | null } = { release: null };
    let failNextSave = false;
    await page.route('**/api/assessments/assessment-1/arrange', async (route) => {
      arrangeRequests.push(JSON.parse(route.request().postData() ?? '{}'));
      if (failNextSave) {
        failNextSave = false;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      await new Promise<void>((resolve) => saveControl.release = resolve);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, version: '2'.repeat(64) }),
      });
    });
    const arrangeUrl = `http://${'127.0.0.1'}:${server.port}/arrange`;
    for (const locale of locales) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      const localeArrangeUrl = `${arrangeUrl}?locale=${encodeURIComponent(locale)}`;
      await page.goto(localeArrangeUrl);
      const originalPartLabel = i18n.t('assessments.arrange.partLabel', {
        count: 1,
        title: 'Presidents',
      });
      await page.getByRole('button', { name: originalPartLabel }).nth(1).click();
      const cancelRenameInput = page.locator('input').first();
      await cancelRenameInput.fill('Discarded title');
      await cancelRenameInput.press('Escape');
      expect(await page.locator('input').count()).toStrictEqual(0);
      await page.goto(localeArrangeUrl);
      await page.getByRole('button', { name: originalPartLabel }).nth(1).click();
      const renameInput = page.locator('input').first();
      await renameInput.fill('Renamed part');
      await renameInput.press('Enter');
      await page.getByRole('button', {
        name: i18n.t('assessments.arrange.partLabel', { count: 1, title: 'Renamed part' }),
      }).first().waitFor();
      await page.locator('button').filter({ hasText: 'Renamed part' }).first().click();
      const whitespaceInput = page.locator('input').first();
      await whitespaceInput.fill('   ');
      await whitespaceInput.press('Enter');
      expect(await page.locator('input').count()).toStrictEqual(0);
      await page.goto(localeArrangeUrl);
      const settingsButton = page.locator('[data-arrange-part-settings]').first();
      await settingsButton.click();
      const dialog = page.getByRole('dialog', {
        name: i18n.t('assessments.arrange.modal.title', { part: 1 }),
      });
      await dialog.waitFor();
      await page.waitForFunction(() =>
        document.querySelector('dialog[open] select') === document.activeElement
      );
      expect(
        await dialog.locator('select').first().evaluate((element) =>
          document.activeElement === element
        ),
      ).toStrictEqual(true);
      const selects = dialog.locator('select');
      await selects.nth(0).selectOption('linear');
      await selects.nth(1).selectOption('simultaneous');
      await dialog.getByRole('textbox', {
        name: i18n.t('assessments.arrange.modal.minTime'),
        exact: true,
      }).fill('10');
      await dialog.getByRole('textbox', {
        name: i18n.t('assessments.arrange.modal.maxTime'),
        exact: true,
      }).fill('120');
      await dialog.locator('textarea').nth(0).fill('<p>Updated instructions</p>');
      await dialog.locator('summary').filter({
        hasText: i18n.t('assessments.arrange.modal.feedback'),
      }).click();
      await dialog.getByRole('textbox', {
        name: i18n.t('assessments.arrange.modal.outcome'),
        exact: true,
      }).fill('SCORE_UPDATED');
      await dialog.locator('textarea').nth(1).fill('<p>Updated feedback</p>');
      await dialog.getByRole('button', { name: i18n.t('assessments.arrange.modal.close') })
        .click();
      await page.waitForFunction(() =>
        document.querySelector('[data-arrange-part-settings]') === document.activeElement
      );
      expect(await settingsButton.evaluate((element) => document.activeElement === element))
        .toStrictEqual(true);
      const requestStart = arrangeRequests.length;
      await page.getByRole('button', { name: i18n.t('assessments.arrange.save') }).click();
      await page.getByRole('button', { name: i18n.t('assessments.arrange.saving') }).waitFor();
      expect(
        await page.getByRole('button', { name: i18n.t('assessments.arrange.saving') })
          .isDisabled(),
      ).toStrictEqual(true);
      await page.getByRole('button', { name: i18n.t('assessments.arrange.saving') }).click({
        force: true,
      });
      expect(arrangeRequests.length).toStrictEqual(requestStart + 1);
      saveControl.release?.();
      await page.getByRole('status').filter({ hasText: i18n.t('assessments.arrange.saved') })
        .waitFor();
      const posted = arrangeRequests.at(-1) as {
        parts: Array<{
          id: string;
          title: string;
          options?: {
            navigationMode?: string;
            submissionMode?: string;
            timeLimits?: { minTime?: number; maxTime?: number };
            instructionsHtml?: string;
            feedback?: Array<{
              id: string;
              access: string;
              showHide: string;
              outcomeIdentifier: string;
              html: string;
            }>;
          };
          placements: Array<{
            id: string;
            itemId: string;
            snapshotRev?: number;
            blueprintTargetId?: string;
          }>;
        }>;
      };
      const savedPart = posted.parts.find((part) => part.id === 'part-1');
      if (!savedPart) expect.unreachable('Expected savedPart');
      expect(savedPart.title).toStrictEqual('Presidents');
      expect(savedPart.options).toStrictEqual({
        navigationMode: 'linear',
        submissionMode: 'simultaneous',
        timeLimits: { minTime: 10, maxTime: 120 },
        instructionsHtml: '<p>Updated instructions</p>',
        feedback: [{
          id: '11111111-1111-4111-8111-111111111111',
          access: 'atEnd',
          showHide: 'show',
          outcomeIdentifier: 'SCORE_UPDATED',
          html: '<p>Updated feedback</p>',
        }],
      });
      expect(savedPart.placements).toStrictEqual([{
        id: 'placement-1',
        itemId: 'item-1',
        snapshotRev: 3,
        blueprintTargetId: 'target-1',
      }]);
      expect(posted.parts.find((part) => part.id === 'part-2')?.title).toStrictEqual('Second part');

      await page.getByRole('button', { name: i18n.t('assessments.arrange.questionActions') })
        .first()
        .click();
      await page.getByRole('button', { name: i18n.t('assessments.arrange.remove') }).click();
      await page.getByRole('button', { name: i18n.t('assessments.arrange.partActions') }).first()
        .click();
      await page.getByRole('button', { name: i18n.t('assessments.arrange.deletePart') }).first()
        .click();
      await page.getByRole('button', { name: i18n.t('assessments.arrange.addPart') }).click();
      await page.getByText(i18n.t('assessments.arrange.dropQuestions')).first().waitFor();
      const secondRequestStart = arrangeRequests.length;
      await page.getByRole('button', { name: i18n.t('assessments.arrange.save') }).click();
      await page.getByRole('button', { name: i18n.t('assessments.arrange.saving') }).waitFor();
      expect(arrangeRequests.length).toStrictEqual(secondRequestStart + 1);
      saveControl.release?.();
      await page.getByRole('status').filter({ hasText: i18n.t('assessments.arrange.saved') })
        .waitFor();
      const secondPosted = arrangeRequests.at(-1) as {
        parts: Array<{ id: string; placements: unknown[] }>;
      };
      expect(secondPosted.parts.some((part) => part.id === 'part-1')).toStrictEqual(false);
      expect(secondPosted.parts.some((part) => part.id === 'part-2')).toStrictEqual(true);
      expect(secondPosted.parts.length).toStrictEqual(2);

      await page.getByRole('button', { name: i18n.t('assessments.arrange.cancel') }).click();
      await page.waitForURL((url) => url.pathname === '/assessments/assessment-1');

      await page.goto(localeArrangeUrl);
      await page.getByRole('button', { name: i18n.t('assessments.arrange.addPart') }).click();
      failNextSave = true;
      await page.getByRole('button', { name: i18n.t('assessments.arrange.save') }).click();
      await page.getByRole('alert').filter({ hasText: i18n.t('assessments.arrange.saveFailed') })
        .waitFor();
      expect(
        await page.getByRole('button', { name: i18n.t('assessments.arrange.save') }).isDisabled(),
      ).toStrictEqual(false);

      await page.goto(localeArrangeUrl);
      await page.getByRole('button', { name: i18n.t('assessments.arrange.addPart') }).click();
      await page.getByText(i18n.t('assessments.arrange.unsaved')).waitFor();

      page.once('dialog', (dialog) => dialog.dismiss());
      await page.getByRole('button', { name: i18n.t('assessments.arrange.cancel') }).click();
      expect(page.url()).toStrictEqual(localeArrangeUrl);

      const confirmationMessages: string[] = [];
      page.once('dialog', async (dialog) => {
        confirmationMessages.push(dialog.message());
        await dialog.accept();
      });
      await page.getByRole('button', { name: i18n.t('assessments.arrange.cancel') }).click();
      await page.waitForURL((url) => url.pathname === '/assessments/assessment-1');
      expect(confirmationMessages).toStrictEqual([i18n.t('assessments.arrange.discardConfirm')]);
    }
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tempDirectory, { recursive: true });
  }
});
