import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { authoringPreferencesService } from '../lib/services/authoring_preferences.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';

testCase(
  'author remembers settings across reload, makes a one-question exception and resets future defaults',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Remembered authoring settings',
        });
        let app: LocalAppBrowser | undefined;
        try {
          await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5300, lastExclusive: 5310 },
              environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
            },
            headless: true,
          });
          const browser: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
            browser: { viewport: { width: 1280, height: 900 } },
          });
          const page: import('playwright').Page = await browser.newPage();
          page.setDefaultTimeout(20000);
          page.on('dialog', (dialog) => dialog.accept());
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const url = `${app.baseUrl}/assessments/${assessment.id}`;
          const start = async (type = 'Single select') => {
            const dirty =
              await page.locator('#question-settings-inspector').getByText('Unsaved changes', {
                exact: true,
              }).count() > 0;
            await page.getByRole('button', { name: '+ Add Question', exact: true }).click();
            await page.locator('[data-type-option]').filter({ hasText: type }).click();
            if (dirty) {
              const prompt = page.getByRole('dialog', { name: 'Keep your question changes?' });
              await prompt.getByRole('button', { name: 'Discard changes', exact: true }).click();
            }
            await page.getByPlaceholder('Choice A').waitFor();
            await page.getByRole('button', { name: 'Question settings', exact: true }).click();
            await page.locator('[data-settings-group="details"] h3 button').click();
            await page.getByLabel('Remember changes for new questions', { exact: true }).waitFor();
          };
          const save = async () => {
            await page.getByRole('button', { name: 'Close question settings', exact: true })
              .click();
            const saveButton = page.getByRole('button', { name: 'Save item', exact: true });
            if (!(await saveButton.isEnabled())) {
              expect.unreachable(await page.locator('body').innerText());
            }
            const [response] = await Promise.all([
              page.waitForResponse((r) =>
                r.url().endsWith(`/api/assessments/${assessment.id}/questions`) &&
                r.request().method() === 'POST'
              ),
              saveButton.click(),
            ]);
            expect(response.status(), await response.text()).toStrictEqual(201);
          };
          await page.goto(url);
          await start();
          await page.getByRole('button', { name: 'Close question settings', exact: true }).click();
          await page.getByPlaceholder('Choice A').fill('Discarded answer');
          await start();
          expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Option A');
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(false);
          await page.getByLabel('Randomize choices', { exact: true }).check();
          await save();
          expect(
            (await authoringPreferencesService.read(ctx, assessment.id)).find((p) =>
              p.typeId === 'single_select'
            )?.settings,
          ).toStrictEqual({ shuffle: true });
          await start();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          await page.reload();
          await start();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          await page.getByLabel('Remember changes for new questions', { exact: true }).uncheck();
          await page.getByLabel('Randomize choices', { exact: true }).uncheck();
          await save();
          // Re-enabling memory on the same saved question must not teach the consumed exception.
          await page.getByRole('button', { name: 'Question settings', exact: true }).click();
          await page.locator('[data-settings-group="details"] h3 button').click();
          await page.getByLabel('Remember changes for new questions', { exact: true }).check();
          await save();
          await page.reload();
          await start('Multiple select');
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          await page.getByLabel('Randomize choices', { exact: true }).uncheck();
          // Discarding a draft must not teach its settings.
          await page.reload();
          await start();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(true);
          await page.setViewportSize({ width: 390, height: 844 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toStrictEqual(true);
          await page.getByLabel('Remember changes for new questions', { exact: true })
            .scrollIntoViewIfNeeded();
          await page.locator('#question-settings-inspector').screenshot({
            path: '/tmp/qflow-authoring-preferences.png',
          });
          await page.getByRole('button', { name: 'Reset remembered settings', exact: true })
            .click();
          await page.getByRole('status').filter({ hasText: 'Remembered settings cleared' })
            .waitFor();
          expect(
            await page.getByLabel('Randomize choices', { exact: true }).isChecked(),
            'Reset must leave the open question untouched',
          ).toStrictEqual(true);
          await page.reload();
          await page.setViewportSize({ width: 1280, height: 900 });
          await start();
          expect(await page.getByLabel('Randomize choices', { exact: true }).isChecked())
            .toStrictEqual(false);
          const endpoint = `${app.baseUrl}/api/assessments/${assessment.id}/authoring-preferences`;
          const resetReceived = Promise.withResolvers<void>();
          const releaseReset = Promise.withResolvers<void>();
          await page.route(endpoint, async (route) => {
            const response = await route.fetch();
            resetReceived.resolve();
            await releaseReset.promise;
            await route.fulfill({ response });
          });
          try {
            await page.getByLabel('Randomize choices', { exact: true }).check();
            await page.getByRole('button', { name: 'Reset remembered settings', exact: true })
              .click();
            await resetReceived.promise;
            await page.getByLabel('Required', { exact: true }).uncheck();
            releaseReset.resolve();
            await page.getByRole('status').filter({ hasText: 'Remembered settings cleared' })
              .waitFor();
          } finally {
            releaseReset.resolve();
            await page.unrouteAll({ behavior: 'wait' });
          }
          await save();
          expect(
            (await authoringPreferencesService.read(ctx, assessment.id)).find((p) =>
              p.typeId === 'single_select'
            )?.settings,
            'Changes made before reset must stay forgotten when a new setting changes during reset',
          ).toStrictEqual({ required: false });
          expect((await browser.request.delete(endpoint, {
            headers: { Origin: app.baseUrl },
            data: { typeId: 'single_select', userId: crypto.randomUUID() },
          })).status()).toStrictEqual(400);
          expect((await browser.request.delete(endpoint, {
            headers: { Origin: 'https://untrusted.example' },
            data: { typeId: 'single_select' },
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
