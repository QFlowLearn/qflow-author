import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { shutdownDb } from '../lib/db.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { createAssessmentDraft } from './assessment_fixture.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { readInstructorDefaults } from '../lib/services/instructor_defaults.ts';
import { authoringPreferencesService } from '../lib/services/authoring_preferences.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { Page } from 'playwright';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import {
  type BrowserLoadingEvidence,
  captureBrowserLoading,
  observeBrowserLoading,
} from './helpers/browser_loading.ts';

testCase(
  'instructor edits workspace answer defaults in the live UI, overrides locally, resets and reloads across assessments',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const evidence = await createBrowserEvidenceDirectory();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const first = await createAssessmentDraft(ctx, { title: 'Default answers QA' });
        const second = await createAssessmentDraft(ctx, { title: 'Other assessment QA' });
        let app: LocalAppBrowser | undefined;
        let failurePage: Page | undefined;
        let loading: BrowserLoadingEvidence | undefined;
        let phase:
          | 'preferences'
          | 'authoring'
          | 'saved-card-hydration'
          | 'fresh-hydration'
          | 'locale-layouts' = 'preferences';
        try {
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5310, lastExclusive: 5320 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const browser: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
            browser: { viewport: { width: 1280, height: 900 } },
          });
          const page: import('playwright').Page = await browser.newPage();
          failurePage = page;
          page.setDefaultTimeout(20000);
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(safeErrorSummary(error)));
          const origin = app.baseUrl;
          loading = observeBrowserLoading(page, origin, () => phase);
          await page.goto(`${origin}/settings/editor`);
          const order = page.getByLabel('Answer order', { exact: true });
          expect(await order.inputValue()).toStrictEqual('question-default');
          await order.selectOption('shuffled');
          await page.getByRole('button', { name: 'Save preferences', exact: true }).focus();
          await Promise.all([
            page.waitForURL('**/settings/editor?success=1'),
            page.keyboard.press('Enter'),
          ]);
          expect(await readInstructorDefaults(ctx)).toStrictEqual({
            answerChoiceOrder: 'shuffled',
            maximumScore: null,
          });
          const invalid = await page.request.post(`${origin}/settings/editor`, {
            form: { answerChoiceOrder: 'unexpected' },
            headers: { origin },
          });
          expect(invalid.status()).toStrictEqual(400);
          expect(await readInstructorDefaults(ctx)).toStrictEqual({
            answerChoiceOrder: 'shuffled',
            maximumScore: null,
          });
          await page.getByRole('status').filter({ hasText: 'Preferences saved.' }).waitFor();
          const start = async (type = 'Single select') => {
            await page.getByRole('button', { name: '+ Add Question', exact: true }).click();
            await page.locator('[data-type-option]').filter({ hasText: type }).click();
            if (type === 'Inline choice') {
              await page.getByLabel('Shuffle options', { exact: true }).waitFor();
            } else await page.getByPlaceholder('Choice A').waitFor();
            await page.getByRole('button', { name: 'Question settings', exact: true }).click();
            await page.locator('[data-settings-group="details"] h3 button').click();
            await page.getByLabel('Remember changes for new questions', { exact: true }).waitFor();
          };
          phase = 'authoring';
          for (const assessment of [first, second]) {
            await page.goto(`${origin}/assessments/${assessment.id}`);
            await start();
            expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
              .toStrictEqual(true);
            await page.getByRole('link', { name: 'Edit my new question defaults', exact: true })
              .waitFor();
          }
          // Dropdowns use the same instructor preference through their actual per-slot controls.
          for (const assessment of [first, second]) {
            await page.goto(`${origin}/assessments/${assessment.id}`);
            await start('Inline choice');
            expect(await page.getByLabel('Shuffle options', { exact: true }).isChecked())
              .toStrictEqual(true);
            await page.getByText(
              'Your workspace default randomizes answers in new choice questions. Assessment defaults take precedence.',
              { exact: true },
            ).waitFor();
          }
          await page.screenshot({
            path: evidence.path('qflow-dropdown-defaults-desktop.png'),
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toStrictEqual(true);
          await page.screenshot({
            path: evidence.path('qflow-dropdown-defaults-mobile.png'),
            fullPage: true,
          });
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.getByLabel('Shuffle options', { exact: true }).uncheck();
          const [dropdownSaved] = await Promise.all([
            page.waitForResponse((response) =>
              response.url().endsWith(`/api/assessments/${second.id}/questions`) &&
              response.request().method() === 'POST'
            ),
            page.getByRole('button', { name: 'Save question', exact: true }).click(),
          ]);
          expect(dropdownSaved.status(), await dropdownSaved.text()).toStrictEqual(201);
          expect(await readInstructorDefaults(ctx)).toStrictEqual({
            answerChoiceOrder: 'shuffled',
            maximumScore: null,
          });
          await page.reload();
          await start('Inline choice');
          expect(await page.getByLabel('Shuffle options', { exact: true }).isChecked())
            .toStrictEqual(false);
          await page.getByRole('button', { name: 'Reset remembered settings', exact: true })
            .click();
          await page.getByRole('status').filter({ hasText: 'Remembered settings cleared' })
            .waitFor();
          expect(await page.getByLabel('Shuffle options', { exact: true }).isChecked())
            .toStrictEqual(false);
          await page.reload();
          await start('Inline choice');
          expect(await page.getByLabel('Shuffle options', { exact: true }).isChecked())
            .toStrictEqual(true);
          // Loading and editing an existing dropdown must not remember its unchanged answer order.
          await page.reload();
          await page.getByRole('button', { name: /^Edit question 1\.1:/ }).click();
          await page.getByLabel('Shuffle options', { exact: true }).waitFor();
          expect(await page.getByLabel('Shuffle options', { exact: true }).isChecked())
            .toStrictEqual(false);
          // A saved card must also wait for its click handler during slow hydration.
          phase = 'saved-card-hydration';
          const savedCardScripts = Promise.withResolvers<void>();
          const savedCardScriptRequested = page.waitForRequest((request) =>
            request.resourceType() === 'script'
          );
          await page.route('**/*', async (route) => {
            if (route.request().resourceType() === 'script') await savedCardScripts.promise;
            await route.continue();
          });
          try {
            await page.reload({ waitUntil: 'commit' });
            await savedCardScriptRequested;
            const edit = page.getByRole('button', { name: /^Edit question 1\.1:/ });
            await edit.waitFor();
            expect(await edit.isDisabled()).toStrictEqual(true);
            await page.screenshot({
              path: evidence.path('qflow-saved-dropdown-before-hydration.png'),
              fullPage: true,
            });
            const editing = edit.click();
            savedCardScripts.resolve();
            await editing;
          } finally {
            savedCardScripts.resolve();
            await page.unrouteAll({ behavior: 'wait' });
          }
          await page.getByLabel('Shuffle options', { exact: true }).waitFor();
          expect(await page.getByLabel('Shuffle options', { exact: true }).isChecked())
            .toStrictEqual(false);
          phase = 'authoring';
          await page.locator('[data-editor-field="prompt"]').fill('Updated dropdown instructions.');
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          const [dropdownRevised] = await Promise.all([
            page.waitForResponse((response) =>
              response.url().endsWith(`/api/assessments/${second.id}/questions`) &&
              response.request().method() === 'POST'
            ),
            page.getByRole('button', { name: 'Save question', exact: true }).click(),
          ]);
          expect(dropdownRevised.status(), await dropdownRevised.text()).toStrictEqual(201);
          expect(await authoringPreferencesService.read(ctx, second.id)).toStrictEqual([]);
          await page.reload();
          await start('Inline choice');
          expect(await page.getByLabel('Shuffle options', { exact: true }).isChecked())
            .toStrictEqual(true);
          await page.reload();
          await start('Multiple select');
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          await page.reload();
          await start();
          // Saving an assessment override must not rewrite the workspace default.
          await page.getByLabel('Randomize choices', { exact: true }).uncheck();
          const save = page.getByRole('button', { name: 'Save question', exact: true });
          const [saved] = await Promise.all([
            page.waitForResponse((response) =>
              response.url().endsWith(`/api/assessments/${second.id}/questions`) &&
              response.request().method() === 'POST'
            ),
            save.click(),
          ]);
          expect(saved.status(), await saved.text()).toStrictEqual(201);
          expect(await readInstructorDefaults(ctx)).toStrictEqual({
            answerChoiceOrder: 'shuffled',
            maximumScore: null,
          });
          await page.reload();
          await start();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(false);
          // Reset only this type's local preference; the active draft stays unchanged.
          await page.getByRole('button', { name: 'Reset remembered settings', exact: true })
            .click();
          await page.getByRole('status').filter({ hasText: 'Remembered settings cleared' })
            .waitFor();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(false);
          await page.reload();
          await start();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          // A one-question exception never creates a new local override.
          await page.getByLabel('Remember changes for new questions', { exact: true }).uncheck();
          await page.getByLabel('Randomize choices', { exact: true }).uncheck();
          const [exception] = await Promise.all([
            page.waitForResponse((response) =>
              response.url().endsWith(`/api/assessments/${second.id}/questions`) &&
              response.request().method() === 'POST'
            ),
            save.click(),
          ]);
          expect(exception.status(), await exception.text()).toStrictEqual(201);
          await page.reload();
          await start();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          // The editor preference itself can be reset, persists across reload, and is translated.
          await page.goto(`${origin}/settings/editor`);
          await order.selectOption('question-default');
          await Promise.all([
            page.waitForURL('**/settings/editor?success=1'),
            page.getByRole('button', { name: 'Save preferences', exact: true }).click(),
          ]);
          expect(await readInstructorDefaults(ctx)).toStrictEqual(null);
          // Slow script delivery must not expose apparently usable, inert authoring controls.
          phase = 'fresh-hydration';
          const scripts = Promise.withResolvers<void>();
          const scriptRequested = page.waitForRequest((request) =>
            request.resourceType() === 'script'
          );
          await page.route('**/*', async (route) => {
            if (route.request().resourceType() === 'script') await scripts.promise;
            await route.continue();
          });
          try {
            await page.goto(`${origin}/assessments/${first.id}`, { waitUntil: 'commit' });
            await scriptRequested;
            const add = page.getByRole('button', { name: '+ Add Question', exact: true });
            await add.waitFor();
            for (
              const name of [
                '+ Add Question',
                'Add question',
                'From library',
                'Write from text',
                'Assessment settings',
              ]
            ) {
              expect(await page.getByRole('button', { name, exact: true }).isDisabled(), name)
                .toStrictEqual(true);
            }
            await page.screenshot({ path: evidence.path('qflow-defaults-before-hydration.png') });
            // Begin the ordinary click while disabled; browser actionability waits for readiness.
            const starting = start();
            scripts.resolve();
            await starting;
          } finally {
            scripts.resolve();
            await page.unrouteAll({ behavior: 'wait' });
          }
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(false);
          await page.screenshot({
            path: evidence.path('qflow-defaults-ready-desktop.png'),
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toStrictEqual(true);
          await page.screenshot({
            path: evidence.path('qflow-defaults-ready-mobile.png'),
            fullPage: true,
          });
          phase = 'locale-layouts';
          for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
            await saveUserSettings(ctx.userId, createInitialUserSettings(locale));
            await page.goto(`${origin}/settings/editor`);
            const i18n = createI18n(locale, catalogForLocale(locale));
            expect(
              await page.getByLabel(i18n.t('settings.editor.answerChoiceOrder'), { exact: true })
                .inputValue(),
            ).toStrictEqual('question-default');
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
              .toStrictEqual(true);
            await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
            if (locale === 'en-US') {
              await page.locator('main').screenshot({
                path: evidence.path('qflow-instructor-defaults-mobile.png'),
              });
            }
          }
          expect(errors).toStrictEqual([]);
          await browser.close();
        } catch (cause: unknown) {
          if (failurePage) {
            await captureBrowserFailure(failurePage, evidence, 'qflow-instructor-defaults');
            if (loading) {
              await captureBrowserLoading(loading, evidence, 'qflow-instructor-defaults');
            }
          }
          throw cause;
        } finally {
          loading?.stop();
          await app?.close();
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
