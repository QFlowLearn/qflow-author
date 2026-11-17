import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import { safeErrorSummary } from '../lib/error_summary.ts';

import { join } from 'node:path';
import { browserEntrySource } from './helpers/assessment_authoring_browser_entry.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { parseAssessmentQuestionCommand } from '../lib/assessment_question_command.ts';
import type { SaveAssessmentQuestionCommand } from '../lib/services/assessment_question_authoring.ts';
import { createQuestionVariantDraft, parseQuestionVariantDraft } from '../lib/question_variants.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import {
  parsePlacementRemovalCommand,
  type PlacementRemovalCommand,
} from '../lib/assessment_placement_removal.ts';

const sourceItemId = '11111111-1111-4111-8111-111111111111';
const sourcePlacementId = '22222222-2222-4222-8222-222222222222';
const lastPlacementId = '55555555-5555-4555-8555-555555555555';
const otherPartPlacementId = '66666666-6666-4666-8666-666666666666';
testCase(
  'duplicate is adjacent, selects an independent copy, and guards dirty drafts and failed saves',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.assessment-duplicate-browser-'));
    const entry = join(temp, 'entry.tsx'), bundle = join(temp, 'bundle.js');
    await _fs.writeFile(
      entry,
      browserEntrySource(
        JSON.stringify(
          createI18nPayload('en-US', catalogForLocale('en-US'), [
            'assessments',
            'authoring',
            'delivery',
            'items',
            'imports',
          ]),
        ),
        JSON.stringify(playerMessageCatalogForLocale('en-US')),
      ),
      'utf8',
    );
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=esm',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      '--loader:.css=empty',
      '--loader:.min.mjs=file',
      `--outfile=${bundle}`,
    ], {});
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const script = await _fs.readFile(bundle, 'utf8');
    const revisions = new Map<number, Draft>([[1, {
      type: 'single_select',
      title: 'Capital of France',
      itemLanguage: newAuthoringItemLanguage(),
      bodyHtml: '<p>What is the capital of France?</p>',
      choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Paris' }],
      correctId: 'A',
    }]]);
    const copies = new Map<string, Draft>();
    const commands: SaveAssessmentQuestionCommand[] = [];
    let latestRevision = 1;
    let failSave = false;
    let failCopyOpen = false;
    let failRemoval = true;
    const removals: PlacementRemovalCommand[] = [];
    const server = await startFetchServer(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/bundle.js') {
        return new Response(script, { headers: { 'content-type': 'text/javascript' } });
      }
      if (path === '/test-styles.css') {
        return new Response(
          await _fs.readFile('static/tw.css', 'utf8') +
            await _fs.readFile('static/styles.css', 'utf8'),
          {
            headers: { 'content-type': 'text/css' },
          },
        );
      }
      if (path === '/fonts/inter-latin.woff2') {
        return new Response(await _fs.readFile('static/fonts/inter-latin.woff2'));
      }
      if (path === '/api/assessments') return Response.json({ assessments: [] });
      if (path === '/api/settings') return Response.json({ choiceRichText: false });
      if (
        path === `/api/assessments/assessment-1/placements/${sourcePlacementId}` &&
        request.method === 'DELETE'
      ) {
        const command = parsePlacementRemovalCommand(await request.json());
        if (!command) expect.unreachable('Expected command');
        removals.push(command);
        if (failRemoval) {
          failRemoval = false;
          return Response.json({ ok: false, code: 'storage_failed' }, { status: 503 });
        }
        return Response.json({
          ok: true,
          value: {
            id: command.removalId,
            placementId: sourcePlacementId,
            partId: '77777777-7777-4777-8777-777777777777',
            itemId: sourceItemId,
            snapshotRev: command.expectedRevision,
            blueprintTargetId: null,
            fixed: false,
            position: 1,
            title: 'Capital of France',
            removedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            restoredAt: null,
          },
        });
      }
      const revision = path.match(/^\/api\/items\/([^/]+)\/revisions\/(\d+)$/);
      if (revision) {
        if (revision[1] !== sourceItemId && failCopyOpen) {
          failCopyOpen = false;
          return Response.json({ error: 'read_failed' }, { status: 503 });
        }
        const draft = revision[1] === sourceItemId
          ? revisions.get(Number(revision[2]))
          : copies.get(revision[1]);
        return draft
          ? Response.json({ draft, pointEditingAuthority: { _tag: 'Generated' } })
          : Response.json({ error: 'missing' }, { status: 404 });
      }
      if (path === '/api/assessments/assessment-1/questions' && request.method === 'POST') {
        const parsed = parseAssessmentQuestionCommand(await request.json());
        if (!parsed.ok) return Response.json({ error: parsed.message }, { status: 400 });
        const command = parsed.command;
        commands.push(command);
        if (failSave) {
          failSave = false;
          return Response.json({ error: 'save_failed' }, { status: 500 });
        }
        if (command._tag === 'Revise') {
          revisions.set(++latestRevision, command.draft);
          return Response.json(
            {
              itemId: sourceItemId,
              placementId: sourcePlacementId,
              revision: latestRevision,
              identifier: 'source',
              fixed: false,
            },
            { status: 201 },
          );
        }
        if (command._tag === 'Variant') {
          const source = revisions.get(command.sourceRevision);
          if (!source) expect.unreachable('Expected source');
          const itemId = crypto.randomUUID(), placementId = crypto.randomUUID();
          copies.set(
            itemId,
            createQuestionVariantDraft(
              parseQuestionVariantDraft(source, 'source'),
              command.targetType,
            ),
          );
          return Response.json({
            itemId,
            placementId,
            revision: 1,
            identifier: 'copy',
            fixed: false,
          }, {
            status: 201,
          });
        }
        return Response.json({ error: 'unexpected_create' }, { status: 400 });
      }
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/test-styles.css"><body class="qf-body"><div id="root" class="qf-shell qf-main"></div><script type="module" src="/bundle.js"></script></body>',
        { headers: { 'content-type': 'text/html' } },
      );
    });
    const browser = await chromium.launch();
    const page: import('playwright').Page = await browser.newPage({ hasTouch: true });
    page.setDefaultTimeout(5_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
    const origin = `http://${'127.0.0.1'}:${server.port}`;
    const cards = page.locator('article[id^="assessment-question-"]');
    async function openSource() {
      await page.goto(`${origin}/?fixture=populated&duplicate=1&multipart=1`);
      await page.getByRole('button', { name: 'Edit question 1.1: Capital of France', exact: true })
        .click();
      await page.getByPlaceholder('Choice A').waitFor();
    }
    async function assertAdjacent() {
      await page.waitForFunction(() =>
        document.querySelectorAll('article[id^="assessment-question-"]').length === 4
      );
      await page.waitForFunction(() =>
        document.querySelectorAll('article[id^="assessment-question-"]')[1]?.hasAttribute(
          'data-authoring-card',
        )
      );
      const ids = await cards.evaluateAll((elements) => elements.map((element) => element.id));
      expect(ids[0]).toStrictEqual(`assessment-question-${sourcePlacementId}`);
      expect(ids[2]).toStrictEqual(`assessment-question-${lastPlacementId}`);
      expect(ids[3]).toStrictEqual(`assessment-question-${otherPartPlacementId}`);
      expect(await cards.nth(1).getByRole('heading', { level: 3 }).innerText()).toStrictEqual(
        'Capital of France',
      );
      if (!(await cards.nth(1).getAttribute('data-authoring-card'))) {
        expect.unreachable("Expected await cards.nth(1).getAttribute('data-authoring-card')");
      }
      if (!(await cards.nth(1).getAttribute('data-authoring-card') !== sourceItemId)) {
        expect.unreachable(
          "Expected await cards.nth(1).getAttribute('data-authoring-card') !== sourceItemId",
        );
      }
    }
    try {
      await openSource();
      await page.getByRole('button', { name: 'Duplicate question', exact: true }).click();
      await assertAdjacent();
      const firstCopy = commands.at(-1);
      if (!(firstCopy?._tag === 'Variant')) {
        expect.unreachable("Expected firstCopy?._tag === 'Variant'");
      }
      expect(commands.at(-1)).toStrictEqual({
        _tag: 'Variant',
        requestId: firstCopy.requestId,
        partId: '77777777-7777-4777-8777-777777777777',
        sourcePlacementId,
        sourceItemId,
        sourceRevision: 1,
        targetType: 'single_select',
      });
      await page.getByPlaceholder('Choice A').fill('Copy only');
      expect(revisions.get(1)?.choices?.[0].text).toStrictEqual('Paris');

      await openSource();
      await page.getByPlaceholder('Choice A').fill('Saved before duplication');
      await page.getByRole('button', { name: 'Duplicate question', exact: true }).click();
      const guard = page.getByRole('dialog', { name: 'Keep your question changes?' });
      await guard.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await cards.count()).toStrictEqual(3);
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
        'Saved before duplication',
      );
      const before = commands.length;
      await page.getByRole('button', { name: 'Duplicate question', exact: true }).click();
      failSave = true;
      await guard.getByRole('button', { name: 'Save and continue', exact: true }).click();
      await guard.getByRole('alert').waitFor();
      expect(commands.length).toStrictEqual(before + 1);
      expect(commands.at(-1)?._tag).toStrictEqual('Revise');
      expect(await cards.count()).toStrictEqual(3);
      await guard.getByRole('button', { name: 'Save and continue', exact: true }).click();
      await assertAdjacent();
      const duplicate = commands.at(-1);
      if (!(duplicate?._tag === 'Variant')) {
        expect.unreachable("Expected duplicate?._tag === 'Variant'");
      }
      expect(duplicate.sourceRevision).toStrictEqual(2);
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
        'Saved before duplication',
      );

      await openSource();
      await page.getByPlaceholder('Choice A').fill('Discarded edit');
      await page.getByRole('button', { name: 'Duplicate question', exact: true }).click();
      await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
      await assertAdjacent();
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Paris');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      if (
        !(await page.getByRole('button', { name: 'Duplicate question', exact: true }).isVisible())
      ) {
        expect.unreachable(
          "Expected await page.getByRole('button', { name: 'Duplicate question', exact: true }).isVisible()",
        );
      }
      if (
        !(await page.getByRole('button', { name: 'Remove question from assessment', exact: true })
          .isVisible())
      ) {
        expect.unreachable(
          "Expected await page.getByRole('button', { name: 'Remove question from assessment', exact: true }) .",
        );
      }
      await page.getByRole('button', { name: 'Edit question 1.3: Capital of France', exact: true })
        .click();
      await page.locator(`#assessment-question-${lastPlacementId}[data-authoring-card]`).waitFor();
      await page.locator(`#assessment-question-${lastPlacementId}`).getByPlaceholder('Choice A')
        .waitFor();
      await page.evaluate(() =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      );
      await page.getByRole('button', { name: 'Duplicate question', exact: true }).evaluate((
        button,
      ) => button.scrollIntoView({ block: 'center' }));
      await page.evaluate(() =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      );
      const tool = await page.getByRole('button', { name: 'Duplicate question', exact: true })
        .boundingBox();
      if (!tool) expect.unreachable('Expected tool');
      await page.touchscreen.tap(tool.x + tool.width / 2, tool.y + tool.height / 2);
      await page.waitForFunction(() =>
        document.querySelectorAll('article[id^="assessment-question-"]').length === 5
      );
      const mobileIds = await cards.evaluateAll((elements) =>
        elements.map((element) => element.id)
      );
      expect(mobileIds[2]).toStrictEqual(`assessment-question-${lastPlacementId}`);
      expect(mobileIds[4]).toStrictEqual(`assessment-question-${otherPartPlacementId}`);
      await page.waitForFunction(() =>
        document.querySelectorAll('article[id^="assessment-question-"]')[3]?.hasAttribute(
          'data-authoring-card',
        )
      );
      if (!(await cards.nth(3).getAttribute('data-authoring-card'))) {
        expect.unreachable("Expected await cards.nth(3).getAttribute('data-authoring-card')");
      }
      await page.screenshot({ path: '/tmp/qflow-adjacent-duplicate-mobile.png', fullPage: false });
      await page.getByPlaceholder('Choice A').fill('Keep before removal');
      await page.getByRole('button', { name: 'Remove question from assessment', exact: true })
        .click();
      await guard.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await cards.count()).toStrictEqual(5);
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
        'Keep before removal',
      );

      // The copy is committed before its editor fetch: a failed read must not hide it or suggest retrying creation.
      await page.setViewportSize({ width: 1280, height: 900 });
      await openSource();
      failCopyOpen = true;
      let readFailureMessage = '';
      page.once('dialog', async (dialog) => {
        readFailureMessage = dialog.message();
        await dialog.dismiss();
      });
      const beforeReadFailure = commands.length;
      await page.getByRole('button', { name: 'Duplicate question', exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelectorAll('article[id^="assessment-question-"]').length === 4
      );
      await page.getByRole('button', { name: 'Duplicate question', exact: true }).waitFor();
      await page.waitForFunction(() =>
        !document.querySelector('button[aria-label="Duplicate question"]')?.hasAttribute('disabled')
      );
      expect(commands.length).toStrictEqual(beforeReadFailure + 1);
      expect(readFailureMessage).toStrictEqual(
        'The copy was saved, but could not be opened. Reload this assessment to edit it.',
      );
      expect(await cards.nth(0).getAttribute('data-authoring-card')).toStrictEqual(sourceItemId);
      // Option recovery also works inside the production provider, not only the isolated drivers.
      await page.getByRole('button', { name: 'Remove choice A', exact: true }).click();
      await page.getByRole('button', { name: 'Undo removal', exact: true }).waitFor();
      await page.locator('[contenteditable="true"]').first().waitFor();
      await page.screenshot({ path: '/tmp/qflow-option-undo-in-builder-desktop.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      await page.screenshot({ path: '/tmp/qflow-option-undo-in-builder-mobile.png' });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await page.getByPlaceholder('Choice A').waitFor();
      expect(await page.getByRole('radio').first().isChecked()).toStrictEqual(true);
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Paris');
      await openSource();
      const remove = page.getByRole('button', {
        name: 'Remove question from assessment',
        exact: true,
      });
      await remove.click();
      await page.waitForFunction(() =>
        !document.querySelector('button[aria-label="Remove question from assessment"]')
          ?.hasAttribute('disabled')
      );
      expect(await cards.count()).toStrictEqual(3);
      expect(removals.length).toStrictEqual(1);
      await remove.click();
      await page.waitForFunction(() =>
        document.querySelectorAll('article[id^="assessment-question-"]').length === 2
      );
      expect(removals.length).toStrictEqual(2);
      expect(removals[0]).toStrictEqual(removals[1]);
      expect(removals[0].expectedRevision).toStrictEqual(1);
      expect(errors).toStrictEqual([]);
    } finally {
      await browser.close();
      await server.close();
      await _fs.rm(temp, { recursive: true });
    }
  },
);
