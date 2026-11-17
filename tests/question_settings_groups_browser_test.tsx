import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { measureAuthoringCanvasLayout } from './helpers/authoring_canvas_layout.ts';

import { browserEntrySource } from './helpers/assessment_authoring_browser_entry.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { parseAssessmentQuestionCommand } from '../lib/assessment_question_command.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { FieldKey } from '../lib/validation_fields.ts';
import {
  preservedRecoveryFields,
  questionSettingsRecoveryCases,
} from './helpers/question_settings_recovery_fixtures.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
const itemId = '11111111-1111-4111-8111-111111111111';
const placementId = '22222222-2222-4222-8222-222222222222';

testCase(
  'grouped question settings keep edits mounted, reveal rejected fields and expose blocking accessibility findings',
  {
    skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
    // The full type/locale/viewport recovery matrix takes about five minutes locally.
    timeout: 600_000,
  },
  async function () {
    const { chromium } = await import('playwright');
    const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.settings-groups-browser-'));
    const entry = `${temp}/entry.tsx`, bundle = `${temp}/bundle.js`;
    await _fs.writeFile(
      entry,
      browserEntrySource('globalThis.__PAYLOAD__', 'globalThis.__PLAYER__')
        .replace('latestRev: 1,', 'latestRev: globalThis.__REV__,')
        .replace('snapshotRev: 1 }', 'snapshotRev: globalThis.__REV__ }')
        .replace('choiceRichText={false}', 'choiceRichText={globalThis.__RICH__}'),
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
    let revision = 1, missingCatalog = false, richAnswers = false;
    let rejectedFields: FieldKey[] = ['title'];
    let draft: Draft = {
      type: 'single_select',
      itemLanguage: newAuthoringItemLanguage(),
      title: 'Capital of France',
      bodyHtml: '<p>Which city is the capital of France?</p>',
      choices: Array.from(
        { length: 12 },
        (_, index) => ({ id: String.fromCharCode(65 + index), text: `Answer ${index + 1}` }),
      ),
      correctId: 'A',
      shuffle: false,
    };
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
      if (path === '/images/recovery.svg') {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#e5e7eb"/><circle cx="120" cy="120" r="12" fill="#334155"/></svg>',
          { headers: { 'content-type': 'image/svg+xml' } },
        );
      }
      if (path === '/api/assessments') return Response.json({ assessments: [] });
      if (path === '/api/settings') return Response.json({ choiceRichText: richAnswers });
      if (/^\/api\/items\/[^/]+\/revisions\/\d+$/.test(path)) {
        return Response.json({
          pointEditingAuthority: { _tag: 'Generated' },
          draft: missingCatalog
            ? {
              ...draft,
              bodyHtml: '<p data-catalog-idref="missing">Question with missing equivalent</p>',
            }
            : draft,
        });
      }
      if (path.endsWith('/questions') && request.method === 'POST') {
        const parsed = parseAssessmentQuestionCommand(await request.json());
        if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
        if (!(parsed.command._tag === 'Revise')) {
          expect.unreachable("Expected parsed.command._tag === 'Revise'");
        }
        if (rejectedFields.length > 0) {
          const fields = rejectedFields;
          rejectedFields = [];
          return Response.json({
            error: 'invalid_draft',
            message: 'Untrusted server explanation',
            issues: fields.map((field) => ({ field, message: 'Untrusted field explanation' })),
          }, { status: 422 });
        }
        draft = parsed.command.draft;
        return Response.json({
          itemId,
          placementId,
          revision: ++revision,
          identifier: 'capital',
          fixed: false,
        }, {
          status: 201,
        });
      }
      const locale = locales.find((value) => value === url.searchParams.get('locale')) ?? 'en-US';
      return new Response(
        `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/test-styles.css"><body class="qf-body"><main id="root" class="qf-shell qf-main"></main><script>globalThis.__RICH__=${richAnswers};globalThis.__REV__=${revision};globalThis.__PAYLOAD__=${
          JSON.stringify(
            createI18nPayload(locale, catalogForLocale(locale), [
              'assessments',
              'authoring',
              'items',
              'delivery',
            ]),
          )
        };globalThis.__PLAYER__=${
          JSON.stringify(playerMessageCatalogForLocale(locale))
        };</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html' } },
      );
    });
    const browser = await chromium.launch();
    const page: import('playwright').Page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
    const origin = `http://${'127.0.0.1'}:${server.port}`;
    const screenshots = await _fs.mkdtemp(
      _path.join(_os.tmpdir(), 'qflow-written-upload-recovery-'),
    );
    console.info(`Field recovery screenshots: ${screenshots}`);
    const rail = page.locator('#question-settings-inspector');
    const toggle = (group: string) =>
      rail.locator(`[data-settings-group="${group}"] h3 button`).first();
    async function open(locale: typeof locales[number] = 'en-US', contentSelector?: string) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      await page.goto(`${origin}/?fixture=populated&locale=${locale}`);
      await page.getByRole('button', {
        name: i18n.t('assessments.builder.editQuestion', {
          number: '1.1',
          title: 'Capital of France',
        }),
        exact: true,
      }).click();
      await page.locator(
        contentSelector ??
          (richAnswers
            ? '[data-choice-id="A"] [contenteditable="true"]'
            : '[data-choice-id="A"] textarea'),
      ).first().waitFor();
      await page.getByRole('button', {
        name: i18n.t('assessments.builder.questionSettings'),
        exact: true,
      }).click();
      await toggle('details').waitFor();
    }
    try {
      await open();
      expect(
        await rail.locator('[data-settings-group]').evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-settings-group'))
        ),
      ).toStrictEqual(['answer', 'scoring', 'accessibility', 'details']);
      expect(await toggle('answer').getAttribute('aria-expanded')).toStrictEqual('true');
      expect(await toggle('details').getAttribute('aria-expanded')).toStrictEqual('false');
      expect(await toggle('accessibility').getAttribute('aria-expanded')).toStrictEqual('false');
      await toggle('details').focus();
      await page.keyboard.press('Space');
      const title = rail.getByLabel('Title', { exact: true });
      await title.fill('Edited title stays intact');
      await title.evaluate((node) => node.setAttribute('data-control-identity', 'title'));
      await toggle('details').click();
      expect(await title.isVisible()).toStrictEqual(false);
      await toggle('details').click();
      expect(await title.inputValue()).toStrictEqual('Edited title stays intact');
      expect(await title.getAttribute('data-control-identity')).toStrictEqual('title');
      await toggle('accessibility').click();
      const language = rail.getByLabel('Item language', { exact: true });
      await language.fill('fr-CA');
      await language.press('Tab');
      await toggle('accessibility').click();
      await rail.getByLabel('Randomize choices', { exact: true }).check();
      await toggle('details').click();
      await rail.getByRole('button', { name: 'Save question', exact: true }).click();
      const review = rail.getByRole('button', { name: 'Review question title', exact: true });
      await review.waitFor();
      await rail.locator('[data-settings-group="details"] button[aria-expanded="true"]').waitFor();
      expect(await toggle('details').getAttribute('aria-expanded')).toStrictEqual('true');
      await review.click();
      await rail.locator('[data-settings-field="title"]:focus').waitFor();
      if (!(await title.evaluate((node) => node === document.activeElement))) {
        expect.unreachable(
          'Expected await title.evaluate((node) => node === document.activeElement)',
        );
      }
      expect(await title.getAttribute('aria-invalid')).toStrictEqual('true');
      expect(await title.inputValue()).toStrictEqual('Edited title stays intact');
      expect((await page.locator('body').innerText()).includes('Untrusted field explanation'))
        .toStrictEqual(false);
      await title.fill('Saved grouped settings');
      await rail.getByRole('button', { name: 'Save question', exact: true }).click();
      await rail.getByText('Item saved', { exact: true }).waitFor();
      expect(draft.title).toStrictEqual('Saved grouped settings');
      expect(draft.itemLanguage).toStrictEqual('fr-CA');
      expect(draft.shuffle).toStrictEqual(true);
      for (const locale of locales) {
        const i18n = createI18n(locale, catalogForLocale(locale));
        await page.setViewportSize({ width: 390, height: 844 });
        await open(locale);
        await rail.getByRole('button', { name: i18n.t('inspector.answerBehavior'), exact: true })
          .waitFor();
        await rail.getByLabel(i18n.t('driver.rightRail.scoringTemplate'), { exact: true })
          .waitFor();
        await toggle('details').click();
        expect(await rail.getByLabel(i18n.t('inspector.title'), { exact: true }).inputValue())
          .toStrictEqual('Saved grouped settings');
        await rail.getByPlaceholder(i18n.t('assessments.builder.tagExample')).waitFor();
        await toggle('details').click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toStrictEqual(true);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        if (locale === 'en-US') {
          await rail.screenshot({ path: '/tmp/qflow-grouped-settings-mobile.png' });
        }

        await page.getByRole('button', {
          name: i18n.t('assessments.builder.closeQuestionSettings'),
          exact: true,
        }).click();
        const answer = page.locator('[data-choice-id="A"] textarea');
        await answer.fill(`Unsaved answer ${locale}`);
        await page.getByRole('tab', { name: i18n.t('editor.preview'), exact: true }).click();
        await page.getByRole('button', {
          name: i18n.t('assessments.builder.questionSettings'),
          exact: true,
        }).click();
        rejectedFields = ['body', 'choices', 'correct', 'prompt'];
        await rail.getByRole('button', {
          name: i18n.t('assessments.builder.saveQuestion'),
          exact: true,
        }).click();
        await rail.getByRole('button', {
          name: i18n.t('inspector.reviewQuestionText'),
          exact: true,
        }).waitFor();
        if (locale === 'en-US') {
          await rail.screenshot({ path: '/tmp/qflow-field-review-actions-mobile.png' });
        }
        for (
          const [key, selector] of [
            ['inspector.reviewQuestionText', '[data-editor-field="body"] [contenteditable="true"]'],
            ['inspector.reviewAnswers', '[data-choice-id="A"] textarea'],
            ['inspector.reviewCorrectAnswer', '[data-choice-id="A"] [data-choice-selection] input'],
            ['inspector.reviewPrompt', '[data-editor-field="prompt"]'],
          ] as const
        ) {
          const action = rail.getByRole('button', { name: i18n.t(key), exact: true });
          await action.focus();
          const retainedActionFocus = await action.evaluate((element) =>
            new Promise<boolean>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(element === document.activeElement))
              )
            )
          );
          if (!retainedActionFocus) {
            expect.unreachable(`${locale}: opening settings stole keyboard focus from ${key}`);
          }
          await page.keyboard.press('Enter');
          const target = page.locator(selector);
          await page.locator(`${selector}:focus`).waitFor();
          expect(await rail.getAttribute('aria-hidden')).toStrictEqual('true');
          expect(await target.getAttribute('aria-invalid')).toStrictEqual('true');
          expect(
            await page.getByRole('tab', {
              name: i18n.t('editor.content'),
              exact: true,
            }).getAttribute('aria-selected'),
          ).toStrictEqual('true');
          expect(await answer.inputValue()).toStrictEqual(`Unsaved answer ${locale}`);
          expect(await page.getByRole('radio').first().isChecked()).toStrictEqual(true);
          await page.getByRole('button', {
            name: i18n.t('assessments.builder.questionSettings'),
            exact: true,
          }).click();
        }
        await page.getByRole('button', {
          name: i18n.t('assessments.builder.closeQuestionSettings'),
          exact: true,
        }).click();
        await page.locator('[data-editor-field="prompt"]').fill(`Prompt ${locale}`);
        await page.getByRole('button', {
          name: i18n.t('assessments.builder.questionSettings'),
          exact: true,
        }).click();
        await rail.getByRole('button', {
          name: i18n.t('assessments.builder.saveQuestion'),
          exact: true,
        }).click();
        await rail.getByText(i18n.t('editor.itemSaved'), { exact: true }).waitFor();
        expect(draft.choices?.[0].text).toStrictEqual(`Unsaved answer ${locale}`);
        expect(draft.promptHtml).toStrictEqual(`Prompt ${locale}`);
      }

      // Rich answer focus and error associations survive returning from preview.
      richAnswers = true;
      await open();
      await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Preview', exact: true }).click();
      await page.getByRole('button', { name: 'Question settings', exact: true }).click();
      rejectedFields = ['choices'];
      await rail.getByRole('button', { name: 'Save question', exact: true }).click();
      await rail.getByRole('button', { name: 'Review answer choices', exact: true }).click();
      const richAnswer = page.locator('[data-choice-id="A"] [contenteditable="true"]');
      await page.locator('[data-choice-id="A"] [contenteditable="true"]:focus').waitFor();
      expect(await richAnswer.getAttribute('aria-invalid')).toStrictEqual('true');
      expect(await richAnswer.innerText()).toStrictEqual('Unsaved answer sv-SE');
      if (!(await richAnswer.getAttribute('aria-describedby'))) {
        expect.unreachable("Expected await richAnswer.getAttribute('aria-describedby')");
      }
      expect(await rail.isHidden()).toStrictEqual(true);
      await page.screenshot({ path: '/tmp/qflow-rejected-answer-review-mobile.png' });
      richAnswers = false;

      // A collapsed answer group opens at the rejected limit, retaining other settings.
      const { correctId: _correctId, ...multiDraft } = draft;
      draft = {
        ...multiDraft,
        type: 'multi_select',
        correctIds: ['A'],
        minChoices: 1,
        maxChoices: 3,
      };
      await open();
      await toggle('answer').click();
      rejectedFields = ['minChoices', 'maxChoices'];
      await rail.getByRole('button', { name: 'Save question', exact: true }).click();
      await rail.getByRole('button', { name: 'Review minimum selections', exact: true }).click();
      await rail.locator('[data-settings-field="minChoices"]:focus').waitFor();
      expect(await rail.locator('[data-settings-field="minChoices"]').getAttribute('aria-invalid'))
        .toStrictEqual('true');
      expect(await toggle('answer').getAttribute('aria-expanded')).toStrictEqual('true');
      expect(await rail.locator('[data-settings-field="minChoices"]').inputValue()).toStrictEqual(
        '1',
      );
      await toggle('answer').click();
      await rail.getByRole('button', { name: 'Review maximum selections', exact: true }).click();
      await rail.locator('[data-settings-field="maxChoices"]:focus').waitFor();
      expect(await rail.locator('[data-settings-field="maxChoices"]').getAttribute('aria-invalid'))
        .toStrictEqual('true');
      expect(await rail.locator('[data-settings-field="maxChoices"]').inputValue()).toStrictEqual(
        '3',
      );
      expect(draft.shuffle).toStrictEqual(true);
      expect(draft.itemLanguage).toStrictEqual('fr-CA');
      const specializedCases = questionSettingsRecoveryCases();
      const spacingFailures: Array<{
        readonly caseName: string;
        readonly layout: Awaited<ReturnType<typeof measureAuthoringCanvasLayout>>;
      }> = [];
      richAnswers = false;
      for (const locale of locales) {
        const i18n = createI18n(locale, catalogForLocale(locale));
        await page.setViewportSize({ width: 390, height: 844 });
        for (const item of specializedCases) {
          draft = {
            ...item.initial,
            type: item.type,
            itemLanguage: newAuthoringItemLanguage(),
            title: 'Capital of France',
          };
          draft = {
            ...draft,
            bodyHtml: `${draft.bodyHtml ?? ''}<p>${
              'Explain which evidence supports the answer, including the observations and their limits. '
                .repeat(4)
            }</p>`,
          };
          if (draft.textEntries) {
            draft = {
              ...draft,
              textEntries: draft.textEntries.map((slot) => ({
                ...slot,
                answers: slot.answers.map((answer) => ({
                  ...answer,
                  value: 'Retained blank answer',
                })),
              })),
            };
          }
          const expectedDraft = structuredClone(draft);
          rejectedFields = [...new Set<FieldKey>([...item.fields, 'prompt'])];
          await open(locale, '[data-editor-field="prompt"]');
          await page.evaluate(
            (theme) => document.documentElement.dataset.theme = theme,
            locale === 'en-US' || locale === 'es-ES' ? 'wireframe' : 'dark',
          );
          await rail.getByRole('button', {
            name: i18n.t('assessments.builder.closeQuestionSettings'),
            exact: true,
          }).click();
          await page.getByRole('tab', { name: i18n.t('editor.preview'), exact: true }).click();
          await page.getByRole('button', {
            name: i18n.t('assessments.builder.questionSettings'),
            exact: true,
          }).click();
          await rail.getByRole('button', {
            name: i18n.t('assessments.builder.saveQuestion'),
            exact: true,
          }).click();
          for (const [index, field] of item.fields.entries()) {
            const action = rail.getByRole('button', {
              name: i18n.t(item.labels[index]),
              exact: true,
            });
            await action.focus();
            await page.keyboard.press('Enter');
            const destination = field === 'correct' && item.type === 'graphic_order'
              ? 'order'
              : field === 'correct' &&
                  (item.type === 'graphic_associate' || item.type === 'graphic_gap_match')
              ? 'matchPairs'
              : field === 'matchSources' && item.type === 'graphic_gap_match'
              ? 'choices'
              : field;
            const selector = item.type === 'gap_match' && field === 'correct'
              ? '[data-choice-selection] select'
              : `[data-editor-field="${destination}"]`;
            const target = page.locator(selector).first();
            await page.locator(`${selector}:focus`).waitFor();
            const invalid = await target.getAttribute('aria-invalid');
            if (invalid !== 'true') {
              await page.screenshot({
                path: `${screenshots}/${item.type}-${field}-failure.png`,
                fullPage: true,
              });
            }
            expect(invalid, `${locale}/${item.type}/${field}`).toStrictEqual('true');
            const description = await target.getAttribute('aria-describedby');
            if (!description) expect.unreachable('Expected description');
            if (!(await page.locator(`[id="${description}"]`).isVisible())) {
              expect.unreachable(
                'Expected await page.locator(`[id="${description}"]`).isVisible()',
              );
            }
            if (item.type === 'graphic_order' && (field === 'order' || field === 'correct')) {
              expect(await target.getAttribute('draggable')).toStrictEqual('true');
              expect(await target.getAttribute('aria-label')).toStrictEqual(
                i18n.t('driver.step', { number: 1 }),
              );
            }
            if (item.type === 'graphic_gap_match' && field === 'matchPairs') {
              expect(
                await page.locator('[data-editor-field="matchTargets"]').first()
                  .getAttribute('aria-describedby'),
              ).toStrictEqual(description);
            }
            expect(await rail.getAttribute('aria-hidden')).toStrictEqual('true');
            if (
              locale === 'en-US' &&
              (item.type === 'extended_text' || item.type === 'upload' ||
                item.type === 'inline_choice' || item.type === 'gap_match' ||
                item.type === 'hottext' || item.type === 'slider' || item.type === 'hotspot' ||
                item.type === 'select_point' || item.type === 'position_object' ||
                item.type === 'graphic_associate' || item.type === 'graphic_order' ||
                item.type === 'graphic_gap_match')
            ) {
              await page.screenshot({
                path: `${screenshots}/${item.type}-focused-mobile.png`,
                fullPage: true,
                animations: 'disabled',
              });
            }
            await page.getByRole('button', {
              name: i18n.t('assessments.builder.questionSettings'),
              exact: true,
            }).click();
          }
          await rail.getByRole('button', { name: i18n.t('inspector.reviewPrompt'), exact: true })
            .click();
          await page.locator('[data-editor-field="prompt"]:focus').waitFor();
          await page.getByRole('button', {
            name: i18n.t('assessments.builder.questionSettings'),
            exact: true,
          }).click();
          await rail.getByRole('button', {
            name: i18n.t('assessments.builder.saveQuestion'),
            exact: true,
          }).click();
          await rail.getByText(i18n.t('editor.itemSaved'), { exact: true }).waitFor().catch(
            async (cause: unknown) => {
              throw new Error(
                `${locale}/${item.type}: ${await page.locator('body').innerText()}\n${
                  errors.join('\n')
                }`,
                { cause },
              );
            },
          );
          const additionalPreservedKeys = preservedRecoveryFields[item.type] ?? [];
          if (!(draft.bodyHtml?.includes('including the observations and their limits.'))) {
            expect.unreachable(
              "Expected draft.bodyHtml?.includes('including the observations and their limits.')",
            );
          }
          for (
            const key of [
              'sources',
              'targets',
              'choices',
              'correctPairs',
              'textEntries',
              'promptHtml',
              'rubricHtml',
              'expectedLength',
              'expectedLines',
              'uploadMaxFileSize',
              'uploadFileTypes',
              'uploadMultiple',
              'inlineChoices',
              'gapChoices',
              'gaps',
              'correctGapPairs',
              ...additionalPreservedKeys,
            ] as const
          ) {
            expect(draft[key]).toStrictEqual(expectedDraft[key]);
          }
          expect((await page.locator('body').innerText()).includes('Untrusted field explanation'))
            .toStrictEqual(false);
          await rail.getByRole('button', {
            name: i18n.t('assessments.builder.closeQuestionSettings'),
            exact: true,
          }).click();
          for (const width of [320, 390, 768, 1024, 1280]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(() => document.fonts.ready);
            const layout = await measureAuthoringCanvasLayout(page);
            if (layout.overflow || layout.outside.length) {
              spacingFailures.push({ caseName: `${locale}/${item.type}/${width}`, layout });
              await page.screenshot({
                path: `${screenshots}/${locale}-${item.type}-spacing-failure-${width}.png`,
                fullPage: true,
              });
            }
            if (
              locale === 'en-US' && ['match', 'text_entry', 'graphic_order'].includes(item.type)
            ) {
              await page.screenshot({
                path: `${screenshots}/${item.type}-spacing-${width}.png`,
                fullPage: true,
                animations: 'disabled',
              });
            }
          }
          await page.setViewportSize({ width: 390, height: 844 });
          if (locale === 'en-US' && item.type === 'match') {
            await page.screenshot({
              path: '/tmp/qflow-specialized-recovery-mobile.png',
              fullPage: true,
              animations: 'disabled',
            });
          }
        }
      }
      expect(spacingFailures).toStrictEqual([]);
      draft = {
        type: 'single_select',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Capital of France',
        bodyHtml: '<p>Which city?</p>',
        choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Rome' }],
        correctId: 'A',
      };
      missingCatalog = true;
      await open();
      await rail.getByText(/CATALOG_REFERENCE_MISSING/).waitFor();
      expect(await toggle('accessibility').getAttribute('aria-expanded')).toStrictEqual('false');
      if (!(await rail.getByText(/CATALOG_REFERENCE_MISSING/).isVisible())) {
        expect.unreachable(
          'Expected await rail.getByText(/CATALOG_REFERENCE_MISSING/).isVisible()',
        );
      }
      expect(await rail.getByRole('button', { name: 'Save question', exact: true }).isEnabled())
        .toStrictEqual(false);
      expect(errors).toStrictEqual([]);
    } finally {
      await browser.close();
      await server.close();
      await _fs.rm(temp, { recursive: true });
    }
  },
);
