import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { browserEntrySource } from './helpers/assessment_authoring_browser_entry.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { parseAssessmentQuestionCommand } from '../lib/assessment_question_command.ts';
import type { SaveAssessmentQuestionCommand } from '../lib/services/assessment_question_authoring.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

const itemId = '11111111-1111-4111-8111-111111111111';
const placementId = '22222222-2222-4222-8222-222222222222';
const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;

testCase(
  'in-place presentation switches preserve active edits, Undo, settings and revision identity',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.presentation-browser-'));
    const entry = `${temp}/entry.tsx`, bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      browserEntrySource('globalThis.__PAYLOAD__', 'globalThis.__PLAYER__')
        .replace('latestRev: 1,', 'latestRev: globalThis.__REV__,')
        .replace('snapshotRev: 1 }', 'snapshotRev: globalThis.__REV__ }'),
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
    let latestRevision = 1;
    let failStatus = 0;
    let saveGate: ReturnType<typeof Promise.withResolvers<void>> | null = null;
    const commands: SaveAssessmentQuestionCommand[] = [];
    const revisions = new Map<number, Draft>([[1, {
      type: 'single_select',
      itemLanguage: newAuthoringItemLanguage(),
      title: 'Capital of France',
      bodyHtml: '<p>What is the capital of France?</p>',
      promptHtml: 'Choose one.',
      choices: [
        { id: 'A', text: 'Paris', fixed: true },
        { id: 'B', text: 'Rome' },
        { id: 'C', text: 'Oslo' },
      ],
      correctId: 'B',
      shuffle: true,
      required: false,
    }]]);
    const server = await startFetchServer(async (request) => {
      const url = new URL(request.url), path = url.pathname;
      if (path === '/bundle.js') {
        return new Response(script, { headers: { 'content-type': 'text/javascript' } });
      }
      if (path === '/test-styles.css') {
        return new Response(
          await _fs.readFile('static/tw.css', 'utf8') +
            await _fs.readFile('static/styles.css', 'utf8'),
          { headers: { 'content-type': 'text/css' } },
        );
      }
      if (path === '/fonts/inter-latin.woff2') {
        return new Response(await _fs.readFile('static/fonts/inter-latin.woff2'));
      }
      if (path === '/api/assessments') return Response.json({ assessments: [] });
      if (path === '/api/settings') return Response.json({ choiceRichText: false });
      const revision = path.match(/^\/api\/items\/([^/]+)\/revisions\/(\d+)$/);
      if (revision) {
        return Response.json({
          draft: revisions.get(Number(revision[2])),
          pointEditingAuthority: { _tag: 'Generated' },
        });
      }
      if (path === '/api/assessments/assessment-1/questions' && request.method === 'POST') {
        const parsed = parseAssessmentQuestionCommand(await request.json());
        if (!parsed.ok) return Response.json({ error: parsed.message }, { status: 400 });
        const command = parsed.command;
        commands.push(command);
        if (saveGate) await saveGate.promise;
        if (failStatus) {
          const status = failStatus;
          failStatus = 0;
          return Response.json({ error: 'save_failed' }, { status });
        }
        if (command._tag !== 'Revise') {
          return Response.json({ error: 'unexpected_create' }, { status: 400 });
        }
        revisions.set(++latestRevision, command.draft);
        return Response.json(
          { itemId, placementId, revision: latestRevision, identifier: 'capital', fixed: false },
          { status: 201 },
        );
      }
      const locale = locales.find((candidate) => candidate === url.searchParams.get('locale')) ??
        'en-US';
      const payload = createI18nPayload(locale, catalogForLocale(locale), [
        'assessments',
        'authoring',
        'delivery',
        'items',
        'imports',
      ]);
      return new Response(
        `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/test-styles.css"><body class="qf-body"><div id="root" class="qf-shell qf-main"></div><script>globalThis.__REV__=${latestRevision};globalThis.__PAYLOAD__=${
          JSON.stringify(payload)
        };globalThis.__PLAYER__=${
          JSON.stringify(playerMessageCatalogForLocale(locale))
        };</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html' } },
      );
    });
    const browser = await chromium.launch();
    const page: import('playwright').Page = await browser.newPage({
      hasTouch: true,
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(8_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const origin = `http://${'127.0.0.1'}:${server.port}`;
    const active = page.locator('[data-authoring-card]');
    const type = page.getByRole('combobox', { name: 'Question type', exact: true });
    async function open() {
      await page.goto(`${origin}/?fixture=populated`);
      await page.getByRole('button', { name: 'Edit question 1.1: Capital of France', exact: true })
        .click();
      await page.getByPlaceholder('Choice A').waitFor();
      await active.locator('[contenteditable="true"]').first().waitFor();
    }
    async function waitType(value: string) {
      await page.waitForFunction(
        (expected) =>
          document.querySelector<HTMLSelectElement>('[name="question-presentation"]')?.value ===
          expected,
        value,
      );
      await active.locator('[data-choice-id="A"] textarea').waitFor();
    }
    try {
      await open();
      const question = active.locator('[contenteditable="true"]').first();
      await question.evaluate((element) => element.setAttribute('data-stem-identity', 'original'));
      await question.fill('Unsaved question text');
      await page.getByPlaceholder('Choice A').fill('Edited Paris');
      await type.focus();
      await type.selectOption('inline_choice');
      await waitType('inline_choice');
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Edited Paris');
      expect(await question.innerText()).toStrictEqual('Unsaved question text');
      expect(await question.getAttribute('data-stem-identity')).toStrictEqual('original');
      expect(await active.locator('[data-qti-inline-choice]').count()).toStrictEqual(0);
      expect(await active.getByText('Add blank', { exact: true }).count()).toStrictEqual(0);
      expect(await active.getAttribute('data-authoring-card')).toStrictEqual(itemId);
      await page.getByRole('button', { name: 'Undo type change', exact: true }).focus();
      await page.keyboard.press('Enter');
      await waitType('single_select');
      expect(await question.innerText()).toStrictEqual('Unsaved question text');
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Edited Paris');
      // Later edits remain intact across Undo, including an explicit new answer key.
      await type.selectOption('inline_choice');
      await waitType('inline_choice');
      await page.getByPlaceholder('Choice A').fill('Later Paris');
      await question.fill('Later question text');
      await active.locator('[data-choice-id="C"] input[type="radio"]').check();
      await page.getByRole('button', { name: 'Undo type change', exact: true }).click();
      await waitType('single_select');
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Later Paris');
      expect(await question.innerText()).toStrictEqual('Later question text');
      if (!(await active.locator('[data-choice-id="C"] input[type="radio"]').isChecked())) {
        expect.unreachable(
          'Expected await active.locator(\'[data-choice-id="C"] input[type="radio"]\').isChecked()',
        );
      }
      await type.selectOption('inline_choice');
      await waitType('inline_choice');
      await page.getByRole('button', { name: 'Question settings', exact: true }).click();
      const rail = page.locator('#question-settings-inspector');
      if (!(await rail.getByLabel('Randomize answers', { exact: true }).isChecked())) {
        expect.unreachable(
          "Expected await rail.getByLabel('Randomize answers', { exact: true }).isChecked()",
        );
      }
      expect(await rail.getByLabel('Require an answer', { exact: true }).isChecked()).toStrictEqual(
        false,
      );
      await rail.getByLabel('Require an answer', { exact: true }).check();
      await rail.getByRole('button', { name: 'Close question settings', exact: true }).click();
      // A pending/failed save leaves the working draft and local Undo available.
      failStatus = 409;
      saveGate = Promise.withResolvers<void>();
      await page.getByRole('button', { name: /^Save item$/i }).click();
      await page.waitForFunction(() =>
        document.querySelector<HTMLSelectElement>('[name="question-presentation"]')?.disabled ===
        true
      );
      expect(commands.length).toStrictEqual(1);
      saveGate.resolve();
      saveGate = null;
      await page.getByRole('alert').filter({ hasText: 'Item could not be saved' }).waitFor();
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Later Paris');
      if (
        !(await page.getByRole('button', { name: 'Undo type change', exact: true }).isEnabled())
      ) {
        expect.unreachable(
          "Expected await page.getByRole('button', { name: 'Undo type change', exact: true }).isEnabled()",
        );
      }
      await page.getByRole('button', { name: /^Save item$/i }).click();
      await page.waitForFunction(() =>
        !document.querySelector('[data-question-presentation] button')
      );
      expect(commands.length).toStrictEqual(2);
      const saved = commands[1];
      if (!(saved._tag === 'Revise')) expect.unreachable("Expected saved._tag === 'Revise'");
      expect(saved.expectedParentRevision).toStrictEqual(1);
      expect(saved.itemId).toStrictEqual(itemId);
      expect(saved.placementId).toStrictEqual(placementId);
      expect(saved.draft.type).toStrictEqual('inline_choice');
      expect(saved.draft.inlineChoices?.[0].correctId).toStrictEqual('C');
      expect(saved.draft.inlineChoices?.[0].required).toStrictEqual(true);
      expect(saved.draft.inlineChoices?.[0].shuffle).toStrictEqual(true);
      expect(saved.draft.inlineChoices?.[0].options[0].text).toStrictEqual('Later Paris');
      // The actual shared player renders a standalone select after the unchanged question.
      await page.getByRole('tab', { name: 'Preview', exact: true }).click();
      const preview = page.locator('[data-qti-preview-host="true"]');
      await preview.getByText('Preview ready.', { exact: true }).waitFor();
      const trigger = preview.locator('.qti3-inline-choice-trigger');
      await trigger.waitFor();
      await trigger.click();
      expect(await preview.getByRole('option', { name: 'Later Paris', exact: true }).count())
        .toStrictEqual(1);
      await preview.getByRole('option', { name: 'Oslo', exact: true }).click();
      await preview.getByRole('button', { name: 'Check', exact: true }).click();
      await preview.getByText('Score calculated.', { exact: true }).waitFor();
      await open();
      await waitType('inline_choice');
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Later Paris');
      await page.screenshot({ path: '/tmp/qflow-standalone-dropdown-desktop.png' });
      await type.selectOption('single_select');
      await waitType('single_select');
      if (!(await active.locator('[data-choice-id="C"] input[type="radio"]').isChecked())) {
        expect.unreachable(
          'Expected await active.locator(\'[data-choice-id="C"] input[type="radio"]\').isChecked()',
        );
      }
      await page.getByRole('button', { name: /^Save item$/i }).click();
      await page.waitForFunction(() =>
        !document.querySelector('[data-question-presentation] button')
      );
      expect(commands.at(-1)?._tag).toStrictEqual('Revise');
      const changedBack = commands.at(-1);
      if (!(changedBack?._tag === 'Revise')) {
        expect.unreachable("Expected changedBack?._tag === 'Revise'");
      }
      expect(changedBack.expectedParentRevision).toStrictEqual(2);
      expect(revisions.get(latestRevision)?.type).toStrictEqual('single_select');

      for (const locale of locales) {
        const i18n = createI18n(locale, catalogForLocale(locale));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${origin}/?fixture=populated&locale=${locale}`);
        await page.getByRole('button', {
          name: i18n.t('assessments.builder.editQuestion', {
            number: '1.1',
            title: 'Capital of France',
          }),
          exact: true,
        }).click();
        const selector = page.getByRole('combobox', {
          name: i18n.t('editor.presentation.label'),
          exact: true,
        });
        await selector.waitFor();
        await selector.selectOption('inline_choice');
        await waitType('inline_choice');
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        expect(
          await page.locator('[data-question-presentation]').innerText().then((text) =>
            text.includes('editor.presentation.')
          ),
        ).toStrictEqual(false);
        if (locale === 'en-US') {
          await page.screenshot({ path: '/tmp/qflow-standalone-dropdown-mobile.png' });
        }
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

        await page.getByRole('button', { name: i18n.t('editor.presentation.undo'), exact: true })
          .click();
        await waitType('single_select');
      }
      // Restrictions are visible before a change and cannot discard rich answer content.
      const savedDraft = revisions.get(latestRevision);
      if (!savedDraft) expect.unreachable('Expected savedDraft');
      revisions.set(latestRevision, {
        ...savedDraft,
        choices: [{ id: 'A', html: '<strong>Rich answer</strong>' }, { id: 'B', text: 'Other' }],
      });
      await open();
      expect(
        await type.locator('option[value="inline_choice"]').evaluate((
          option: HTMLOptionElement,
        ) => ({ disabled: option.disabled, attribute: option.hasAttribute('disabled') })),
      ).toStrictEqual({ disabled: true, attribute: true });
      await page.getByText(
        'Rich text or media in answers needs a separate conversion. This question keeps its current type.',
        { exact: true },
      ).waitFor();
      expect(await type.inputValue()).toStrictEqual('single_select');
      // A question that has not yet been saved keeps the same editing session when its type changes.
      await page.goto(origin);
      // Hold mounting frames so the author can choose another field before queued autofocus runs.
      await page.evaluate(() => {
        const original = globalThis.requestAnimationFrame.bind(globalThis);
        let release = () => {};
        const gate = new Promise<void>((resolve) => release = resolve);
        globalThis.requestAnimationFrame = (callback) =>
          original((time) => {
            gate.then(() => callback(time)).catch((cause: unknown) => {
              queueMicrotask(() => {
                throw cause;
              });
            });
          });
        Object.assign(globalThis, {
          releaseAuthoringFrames: () => {
            globalThis.requestAnimationFrame = original;
            release();
          },
        });
      });
      await page.getByRole('button', { name: 'Add question', exact: true }).click();
      await page.getByRole('region', { name: 'Insert question', exact: true }).getByRole('button', {
        name: /^Single select/,
      }).click();
      await page.getByPlaceholder('Choice A').waitFor();
      const newQuestion = page.locator('[contenteditable="true"]').first();
      await newQuestion.fill('New question with unsaved wording');
      await newQuestion.evaluate((element) => element.setAttribute('data-stem-identity', 'new'));
      await page.getByPlaceholder('Choice A').focus();
      await page.evaluate(async () => {
        const release = (globalThis as typeof globalThis & { releaseAuthoringFrames?: () => void })
          .releaseAuthoringFrames;
        if (!release) throw new Error('Authoring frame gate was not installed');
        release();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      });
      expect(
        await page.getByPlaceholder('Choice A').evaluate((element) =>
          element === document.activeElement
        ),
      ).toStrictEqual(true);
      await page.getByPlaceholder('Choice A').fill('New first answer');
      await type.selectOption('inline_choice');
      await page.locator('[data-choice-id="A"] textarea').waitFor();
      expect(await newQuestion.innerText()).toStrictEqual('New question with unsaved wording');
      expect(await newQuestion.getAttribute('data-stem-identity')).toStrictEqual('new');
      expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
        'New first answer',
      );
      await page.getByRole('button', { name: 'Undo type change', exact: true }).click();
      await page.locator('[data-choice-id="A"] textarea').waitFor();
      expect(await newQuestion.innerText()).toStrictEqual('New question with unsaved wording');
      expect(await type.inputValue()).toStrictEqual('single_select');
      expect(errors).toStrictEqual([]);
    } finally {
      saveGate?.resolve();
      await browser.close();
      await server.close();
      await _fs.rm(temp, { recursive: true });
    }
  },
);
