import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';

testCase(
  'text preparation preserves focus, keys, field edits, undo, insertion and saved revisions',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Text assistance verification',
        });
        let app: LocalAppBrowser | undefined;
        try {
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5320, lastExclusive: 5330 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const browser: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
            browser: { viewport: { width: 1280, height: 1000 } },
          });
          const page: import('playwright').Page = await browser.newPage();
          page.setDefaultTimeout(15000);
          page.on('dialog', (dialog) => dialog.accept());
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
          const url = `${app.baseUrl}/assessments/${assessment.id}`;
          await page.goto(url);
          const start = async (discardCurrent = false) => {
            await page.getByRole('button', { name: '+ Add Question', exact: true }).click();
            await page.getByRole('button', { name: 'Type or paste a question', exact: true })
              .click();
            if (discardCurrent) {
              const guard = page.getByRole('dialog', {
                name: 'Keep your question changes?',
                exact: true,
              });
              await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
              await guard.waitFor({ state: 'detached' });
            }
            await page.getByRole('textbox', { name: 'Type or paste a question', exact: true })
              .waitFor().catch(async (cause: unknown) => {
                throw new Error(await page.locator('body').innerText(), { cause });
              });
          };
          const source = page.getByRole('textbox', {
            name: 'Type or paste a question',
            exact: true,
          });
          const save = async () => {
            const button = page.getByRole('button', { name: 'Save item', exact: true });
            if (!(await button.isEnabled())) {
              expect.unreachable(await page.locator('body').innerText());
            }
            const [response] = await Promise.all([
              page.waitForResponse((r) =>
                r.url().endsWith(`/api/assessments/${assessment.id}/questions`) &&
                r.request().method() === 'POST'
              ),
              button.click(),
            ]);
            expect(response.status(), await response.text()).toStrictEqual(201);
            await source.waitFor({ state: 'detached' });
            await page.getByText('Item saved', { exact: true }).first().waitFor();
          };
          await start();
          const first =
            'MC Which organelle produces ATP?\nA. Nucleus\nB. Mitochondrion\nC. Golgi\nD. Ribosome\nAnswer: B';
          await source.fill(first);
          await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
          await page.getByPlaceholder('Choice B').waitFor();
          expect(await page.getByPlaceholder('Choice B').inputValue()).toStrictEqual(
            'Mitochondrion',
          );
          // A click before the pause timer fires must produce one reversible preparation.
          await page.waitForTimeout(1100);
          await page.getByRole('button', { name: 'Undo preparation', exact: true }).click();
          expect(await page.getByPlaceholder('Choice B').inputValue()).toStrictEqual('');
          await page.getByRole('button', { name: 'Restore prepared draft', exact: true }).click();
          await page.getByRole('button', { name: 'Replace draft from text', exact: true }).click();
          await source.focus();
          await source.press('End');
          await source.pressSequentially(' ');
          await page.getByRole('status').filter({ hasText: 'Question prepared' }).waitFor();
          expect(
            await source.evaluate((el) => el === document.activeElement),
            await page.evaluate(() => document.activeElement?.outerHTML),
          ).toStrictEqual(true);
          // Manual changes must survive later source edits until explicit replacement.
          await page.getByPlaceholder('Choice A').fill('Human alternative');
          await source.fill(first.replace('Nucleus', 'New alternative'));
          await page.getByRole('button', { name: 'Replace draft from text', exact: true })
            .waitFor();
          expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
            .toStrictEqual(false);
          expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
            'Human alternative',
          );
          await page.getByRole('button', { name: 'Replace draft from text', exact: true }).click();
          expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
            'New alternative',
          );
          await page.getByRole('button', { name: 'Undo preparation', exact: true }).click();
          expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
            'Human alternative',
          );
          await page.getByRole('button', { name: 'Restore prepared draft', exact: true }).click();
          expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
            'New alternative',
          );
          await page.getByRole('tab', { name: 'Preview', exact: true }).click();
          await page.getByRole('tab', { name: 'Content', exact: true }).click();
          expect(await source.inputValue()).toStrictEqual(
            first.replace('Nucleus', 'New alternative'),
          );
          await page.getByRole('button', { name: 'Undo preparation', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          await page.getByLabel('Randomize choices', { exact: true }).check();
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await save();
          await start();
          await page.route(
            `**/api/assessments/${assessment.id}/question-assistance`,
            async (route) => {
              expect(route.request().postDataJSON().recent).toStrictEqual([
                { type: 'single_select', choiceCount: 4 },
              ]);
              await route.fulfill({ json: { composition: null } });
            },
          );
          await source.fill('Choose a structure for this question.');
          await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
          await page.getByRole('status').filter({ hasText: 'Choose a question type' }).waitFor();
          await page.unrouteAll({ behavior: 'wait' });
          const type = page.getByLabel('Question type', { exact: true });
          await type.selectOption('multi_select');
          await source.fill('MC Which are mammals?\nA. Dog\nB. Cat\nC. Trout\nAnswer: A, B');
          await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
          expect(await type.inputValue()).toStrictEqual('multi_select');
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          await page.getByRole('spinbutton', { name: /Minimum selections/ }).fill('1');
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await source.fill('MR Which are mammals?\nA. Dog\nB. Cat\nC. Trout\nAnswer: A, B');
          await page.waitForTimeout(1100);
          await page.getByRole('button', { name: 'Replace draft from text', exact: true })
            .waitFor();
          await page.getByRole('button', { name: 'Use the editor below', exact: true }).click();
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          expect(await page.getByRole('spinbutton', { name: /Minimum selections/ }).inputValue())
            .toStrictEqual('1');
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await save();
          const before = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(before);
          const last = before.parts[0].placements[1];
          const insertion = page.locator(`#assessment-question-${last.id}`).getByRole('button', {
            name: 'Question actions',
            exact: true,
          });
          await insertion.focus();
          await insertion.press('Enter');
          await page.locator(`#assessment-question-${last.id}`).getByRole('button', {
            name: 'Insert before',
            exact: true,
          }).press('Enter');
          await page.getByRole('button', { name: 'Type or paste a question', exact: true }).click();
          await source.fill('Short answer: Name our planet.\nAnswer: Earth');
          await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
          await page.getByRole('status').filter({ hasText: 'Question prepared.' }).waitFor();
          await save();
          const after = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(after);
          expect(after.parts[0].placements.length).toStrictEqual(3);
          expect(after.parts[0].placements[2].id).toStrictEqual(last.id);
          await page.reload();
          await start();
          await source.fill('MC Missing key?\nA. First\nB. Second');
          await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
          expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
            .toStrictEqual(false);
          // Real unconfigured local endpoint reports failure, without losing source.
          await source.fill('Give one word naming a planet.');
          await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
          await page.getByRole('status').filter({ hasText: 'Assistance is unavailable' }).waitFor();
          expect(await source.inputValue()).toStrictEqual('Give one word naming a planet.');
          await page.setViewportSize({ width: 390, height: 844 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toStrictEqual(true);
          await page.screenshot({ path: '/tmp/qflow-text-assistance-mobile.png', fullPage: true });
          await start(true);
          const received = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const completed = Promise.withResolvers<void>();
          let requests = 0;
          await page.route(
            `**/api/assessments/${assessment.id}/question-assistance`,
            async (route) => {
              requests++;
              const body = route.request().postDataJSON();
              expect(body.recent).toStrictEqual([]); // Reload above ended the earlier authoring session.
              if (requests === 1) {
                received.resolve();
                await release.promise;
                await route.fulfill({ json: { composition: null } }).catch(() => {});
                completed.resolve();
              } else {await route.fulfill({
                  json: {
                    composition: {
                      type: 'text_entry',
                      stem: 'Name the planet we live on.',
                      choices: [],
                      answers: ['Earth'],
                      choiceCount: 4,
                      shuffle: null,
                      complete: false,
                    },
                  },
                });}
            },
          );
          try {
            await source.dispatchEvent('compositionstart');
            await source.fill('Name a planet.');
            await page.waitForTimeout(1000); // Must exceed the 800 ms debounce while IME is active.
            expect(requests).toStrictEqual(0);
            const requestStarted = page.waitForRequest((request) =>
              request.url().endsWith('/question-assistance') &&
              request.postDataJSON().text === 'Name a planet.'
            );
            await Promise.all([requestStarted, source.dispatchEvent('compositionend')]);
            await received.promise;
            await source.evaluate((element) => {
              element.dataset.identity = 'stable';
            });
            await source.fill('Name the planet we live on.\nAnswer: Earth');
            await page.getByRole('status').filter({ hasText: 'Question prepared.' }).waitFor();
            release.resolve();
            await completed.promise;
            expect(await source.getAttribute('data-identity')).toStrictEqual('stable');
            expect(await source.evaluate((element) => element === document.activeElement))
              .toStrictEqual(true);
            expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
              .toStrictEqual(true);
            await save();
          } finally {
            release.resolve();
            await page.unrouteAll({ behavior: 'wait' });
          }
          await start();
          const assistanceType = page.getByLabel('Question type', { exact: true });
          await assistanceType.selectOption('text_entry');
          const shortSource = 'Name our home planet.\nAnswer: Earth';
          await source.fill(shortSource);
          await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
          if (!(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())) {
            expect.unreachable(
              "Expected await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled()",
            );
          }
          // Returning to previously prepared text must not leave Save stuck disabled.
          await source.fill(shortSource + 'x');
          await source.fill(shortSource);
          await page.waitForFunction(() =>
            [...document.querySelectorAll('button')].some((b) =>
              b.textContent === 'Save item' && !b.disabled
            )
          );
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          await page.getByRole('button', { name: 'Details and standards', exact: true }).click();
          await page.getByPlaceholder('Auto-generated from the prompt', { exact: true }).fill(
            'Human title',
          );
          await page.getByLabel('Remember changes for new questions', { exact: true }).uncheck();
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await source.fill('MC Which planet?\nA. Earth\nB. Mars\nAnswer: A');
          await page.waitForTimeout(1100);
          await page.getByRole('button', { name: 'Replace draft from text', exact: true })
            .waitFor();
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          expect(
            await page.getByPlaceholder('Auto-generated from the prompt', { exact: true })
              .inputValue(),
          ).toStrictEqual('Human title');
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await assistanceType.selectOption('single_select');
          await page.getByRole('button', { name: 'Replace draft from text', exact: true }).click();
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          expect(
            await page.getByLabel('Remember changes for new questions', { exact: true })
              .isChecked(),
          ).toStrictEqual(false);
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await page.getByRole('button', { name: 'Undo preparation', exact: true }).click();
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          expect(
            await page.getByPlaceholder('Auto-generated from the prompt', { exact: true })
              .inputValue(),
          ).toStrictEqual('Human title');
          expect(
            await page.getByLabel('Remember changes for new questions', { exact: true })
              .isChecked(),
          ).toStrictEqual(false);
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await page.getByRole('button', { name: 'Restore prepared draft', exact: true }).click();
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          await page.getByLabel('Randomize choices', { exact: true }).uncheck();
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await assistanceType.selectOption('text_entry');
          await page.getByRole('button', { name: 'Replace draft from text', exact: true }).click();
          await page.getByRole('button', { name: 'Undo preparation', exact: true }).click();
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(false);
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          // Natural dictation: provisional preview, completed suggestions, review, and persistence.
          await start(true);
          await page.setViewportSize({ width: 1440, height: 1000 });
          const spoken =
            'MC 4 options, Who was the second president, Thomas Jefferson, George Washington, you do the rest, randomize.';
          const composition = {
            type: 'single_select',
            stem: 'Who was the second president',
            choices: ['Thomas Jefferson', 'George Washington'],
            answers: [],
            choiceCount: 4,
            shuffle: true,
            complete: true,
          };
          const completionStarted = Promise.withResolvers<void>();
          const finishCompletion = Promise.withResolvers<void>();
          let completionCalls = 0;
          await page.route(
            `**/api/assessments/${assessment.id}/question-assistance`,
            (route) =>
              route.fulfill({
                json: {
                  composition: {
                    ...composition,
                    stem: route.request().postDataJSON().text.includes('second US president')
                      ? 'Who was the second US president'
                      : composition.stem,
                    shuffle: !route.request().postDataJSON().text.includes('do not randomize'),
                  },
                },
              }),
          );
          await page.route(
            `**/api/assessments/${assessment.id}/question-completion`,
            async (route) => {
              completionCalls++;
              expect(route.request().postDataJSON()).toStrictEqual(
                completionCalls === 1
                  ? composition
                  : { ...composition, stem: 'Who was the second US president', shuffle: false },
              );
              completionStarted.resolve();
              await finishCompletion.promise;
              await route.fulfill({
                json: {
                  additionalChoices: ['John Adams', 'James Madison'],
                  answers: ['John Adams'],
                },
              });
            },
          );
          try {
            await source.fill(spoken);
            await page.getByRole('status').filter({ hasText: 'Adding missing options' }).waitFor();
            await completionStarted.promise;
            const preview = page.getByRole('region', { name: 'Live preview', exact: true });
            if (!((await preview.innerText()).includes('Thomas Jefferson'))) {
              expect.unreachable(
                "Expected (await preview.innerText()).includes('Thomas Jefferson')",
              );
            }
            if (!((await preview.innerText()).includes('Randomized choices'))) {
              expect.unreachable(
                "Expected (await preview.innerText()).includes('Randomized choices')",
              );
            }
            expect(await preview.getByText('Option not supplied yet', { exact: true }).count())
              .toStrictEqual(2);
            expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
              .toStrictEqual(false);
            expect(
              await source.evaluate((el) => el === document.activeElement),
              await page.evaluate(() => document.activeElement?.outerHTML),
            ).toStrictEqual(true);
            // Appending a presentation command while generation is running must reuse the request.
            await source.fill(spoken.replace('randomize.', 'do not randomize.'));
            await page.getByRole('status').filter({ hasText: 'Adding missing options' }).waitFor();
            expect(completionCalls).toStrictEqual(1);
            expect((await preview.innerText()).includes('Randomized choices')).toStrictEqual(false);
            await source.fill(spoken);
            await page.getByRole('status').filter({ hasText: 'Adding missing options' }).waitFor();
            expect(completionCalls).toStrictEqual(1);
            if (!((await preview.innerText()).includes('Randomized choices'))) {
              expect.unreachable(
                "Expected (await preview.innerText()).includes('Randomized choices')",
              );
            }
            finishCompletion.resolve();
            const review = page.getByRole('checkbox', {
              name: 'I reviewed the suggested options and answer.',
              exact: true,
            });
            await page.getByRole('status').filter({ hasText: 'Question prepared.' }).waitFor();
            expect(await review.count()).toStrictEqual(0);
            expect(await page.getByText('Recognize automatically', { exact: true }).count())
              .toStrictEqual(0);
            expect(await page.getByPlaceholder('Choice C').inputValue()).toStrictEqual(
              'John Adams',
            );
            expect(await preview.getByText('Suggested', { exact: true }).count()).toStrictEqual(2);
            expect(await preview.getByText('Correct answer', { exact: true }).count())
              .toStrictEqual(1);
            expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
              .toStrictEqual(true);
            await page.screenshot({ path: '/tmp/qflow-composer-desktop.png', fullPage: true });
            if (!(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())) {
              expect.unreachable(
                "Expected await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled()",
              );
            }
            // Pause saving until interpretation confirms that only the shuffle setting changed.
            const preparedOptions = await preview.locator('ol').innerText();
            await source.fill(spoken.replace('randomize.', 'do not randomize.'));
            expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
              .toStrictEqual(false);
            await page.getByRole('status').filter({ hasText: 'Question prepared.' }).waitFor();
            expect(completionCalls).toStrictEqual(1);
            if (!(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())) {
              expect.unreachable(
                "Expected await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled()",
              );
            }
            expect(await preview.locator('ol').innerText()).toStrictEqual(preparedOptions);
            await page.getByRole('button', { name: 'Question settings', exact: true }).click();
            expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
              .toStrictEqual(false);
            await page.getByLabel('Randomize choices', { exact: true }).check();
            expect(await preview.locator('ol').innerText()).toStrictEqual(preparedOptions);
            await page.getByLabel('Randomize choices', { exact: true }).uncheck();
            expect(completionCalls).toStrictEqual(1);
            await page.getByRole('button', { name: 'Close question settings', exact: true })
              .click();
            await page.getByRole('button', { name: 'Undo preparation', exact: true }).click();
            if (!((await preview.innerText()).includes('Randomized choices'))) {
              expect.unreachable(
                "Expected (await preview.innerText()).includes('Randomized choices')",
              );
            }
            await page.getByRole('button', { name: 'Restore prepared draft', exact: true }).click();
            expect(await preview.locator('ol').innerText()).toStrictEqual(preparedOptions);
            // Content changes request a fresh completion.
            await source.fill(
              spoken.replace('second president', 'second US president').replace(
                'randomize.',
                'do not randomize.',
              ),
            );
            await page.getByRole('button', { name: 'Replace draft from text', exact: true })
              .click();
            await page.getByRole('status').filter({ hasText: 'Question prepared.' })
              .waitFor();
            expect(completionCalls).toStrictEqual(2);
            expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
              .toStrictEqual(true);
            await page.getByRole('button', { name: 'Use the editor below', exact: true }).click();
            await page.getByLabel('Question type', { exact: true }).selectOption('multi_select');
            expect(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())
              .toStrictEqual(false);
            await page.getByRole('button', { name: 'Use the editor below', exact: true }).click();
            await page.setViewportSize({ width: 390, height: 844 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
              .toStrictEqual(true);
            await page.screenshot({ path: '/tmp/qflow-composer-mobile.png', fullPage: true });
            await save();
            const saved = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(saved);
            const placement = saved?.parts[0].placements.at(-1);
            if (!placement) expect.unreachable('Expected placement');
            const persisted = await browser.request.get(
              `${app.baseUrl}/api/items/${placement.itemId}/latest`,
            );
            expect(persisted.status()).toStrictEqual(200);
            const item = await persisted.json();
            expect(item.draft.choices.map((choice: { text: string }) => choice.text)).toStrictEqual(
              [
                'Thomas Jefferson',
                'George Washington',
                'John Adams',
                'James Madison',
              ],
            );
            expect(item.draft.correctId).toStrictEqual('C');
            expect(item.draft.shuffle).toStrictEqual(false);
          } finally {
            finishCompletion.resolve();
            await page.unrouteAll({ behavior: 'wait' });
          }
          // A late completion must not replace a newer, explicitly prepared source.
          await start();
          const staleStarted = Promise.withResolvers<void>();
          const releaseStale = Promise.withResolvers<void>();
          const staleFinished = Promise.withResolvers<void>();
          await page.route(
            `**/api/assessments/${assessment.id}/question-assistance`,
            (route) => route.fulfill({ json: { composition } }),
          );
          await page.route(
            `**/api/assessments/${assessment.id}/question-completion`,
            async (route) => {
              staleStarted.resolve();
              await releaseStale.promise;
              await route.fulfill({
                json: {
                  additionalChoices: ['John Adams', 'James Madison'],
                  answers: ['John Adams'],
                },
              }).catch(() => {});
              staleFinished.resolve();
            },
          );
          try {
            await source.fill(spoken);
            await page.getByRole('status').filter({ hasText: 'Adding missing options' }).waitFor();
            await staleStarted.promise;
            await source.fill('MC Replacement question?\nA. First\nB. Second\nAnswer: B');
            await page.getByRole('status').filter({ hasText: 'Question prepared.' }).waitFor();
            releaseStale.resolve();
            await staleFinished.promise;
            expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('First');
            expect(await page.getByPlaceholder('Choice B').inputValue()).toStrictEqual('Second');
            expect(
              await page.getByRole('checkbox', {
                name: 'I reviewed the suggested options and answer.',
                exact: true,
              }).count(),
            ).toStrictEqual(0);
            if (!(await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled())) {
              expect.unreachable(
                "Expected await page.getByRole('button', { name: 'Save item', exact: true }).isEnabled()",
              );
            }
          } finally {
            releaseStale.resolve();
            await page.unrouteAll({ behavior: 'wait' });
          }
          // Server rejects unknown assessments and cross-origin requests before inference.
          const endpoint =
            `${app.baseUrl}/api/assessments/${crypto.randomUUID()}/question-assistance`;
          expect((await browser.request.post(endpoint, {
            headers: { Origin: app.baseUrl },
            data: { text: 'Question?', recent: [] },
          })).status()).toStrictEqual(404);
          expect((await browser.request.post(endpoint, {
            headers: { Origin: 'https://untrusted.example' },
            data: { text: 'Question?', recent: [] },
          })).status()).toStrictEqual(403);
          expect(errors).toStrictEqual([]);
        } finally {
          await app?.close();
          await deleteAssessment(ctx, assessment.id);
          await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, ctx.userId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
