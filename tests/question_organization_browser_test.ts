import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import { withImportedOrganizationQuestions } from './helpers/imported_organization_questions.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import { organizationActivation } from '../lib/db/question_organization_schema.ts';
import { bankCollectionItems, bankCollections } from '../lib/db/bank_schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import {
  organizationBrowserEnvironment,
  organizationBrowserRuntime,
} from './helpers/organization_browser_runtime.ts';

testCase(
  'instructor previews topics, files a collection, toggles future processing and undoes in Auto-organize',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withOrganizationWorkspace(async (f) => {
        let app: LocalAppBrowser | undefined,
          runtime: Awaited<ReturnType<typeof organizationBrowserRuntime>> | undefined;
        try {
          await saveUserSettings(f.ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5240, lastExclusive: 5250 },
              environment: {
                ...builtWorkerBrowserEnvironment,
                DATABASE_URL: databaseUrl,
                ...organizationBrowserEnvironment,
              },
            },
            headless: true,
          });
          runtime = await organizationBrowserRuntime(f.ctx);
          let runtimeUrl = runtime.url;
          const context: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: f.ctx.tenantId, userId: f.ctx.userId }),
            browser: { viewport: { width: 1360, height: 1000 } },
          });
          const anonymous: import('playwright').BrowserContext = await app.newContext();
          try {
            const response = await anonymous.request.get(
              `${app.baseUrl}/api/items/organization-notices`,
            );
            expect(response.status()).toStrictEqual(401);
          } finally {
            await anonymous.close();
          }
          const crossOrigin = await context.request.post(
            `${app.baseUrl}/api/items/organization-notices`,
            {
              headers: { Origin: 'https://untrusted.example' },
              data: { runId: f.runId, executionId: f.params.workflowExecutionId },
            },
          );
          expect(crossOrigin.status()).toStrictEqual(403);
          const page: import('playwright').Page = await context.newPage();
          page.setDefaultTimeout(20000);
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const submittedIds: string[] = [];
          await page.route('**/items/organize**', async (route) => {
            if (route.request().method() !== 'POST') return await route.continue();
            const body = route.request().postDataBuffer();
            if (!body) expect.unreachable('Expected body');
            const form = await new Response(new Uint8Array(body), {
              headers: { 'content-type': route.request().headers()['content-type'] },
            }).formData();
            const payload = form.get('payload');
            if (!(typeof payload === 'string')) {
              expect.unreachable("Expected typeof payload === 'string'");
            }
            const command: unknown = JSON.parse(payload);
            if (
              command && typeof command === 'object' && 'action' in command &&
              command.action === 'organization-preview'
            ) {
              if (!('operationId' in command && typeof command.operationId === 'string')) {
                expect.unreachable(
                  "Expected 'operationId' in command && typeof command.operationId === 'string'",
                );
              }
              submittedIds.push(command.operationId);
            }
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: runtimeUrl + url.pathname + url.search });
            await route.fulfill({ response });
          });
          await page.goto(
            `${app.baseUrl}/items/organize?scope=${encodeURIComponent('collection=' + f.originId)}`,
          );
          await page.getByRole('button', { name: 'Preview organization', exact: true }).waitFor();
          expect(await page.getByText('Difficulty levels', { exact: true }).count()).toStrictEqual(
            0,
          );
          await page.getByLabel('Vocabulary name', { exact: true }).fill('');
          await page.getByRole('button', { name: 'Preview organization', exact: true }).click();
          expect(runtime.postCount(), 'A required name must prevent submission').toStrictEqual(0);
          await page.getByLabel('Vocabulary name', { exact: true }).fill('Middle school science');
          const published = await db.select({
            id: questions.id,
            revision: questions.latestRevisionId,
          }).from(questions).where(eq(questions.tenantId, f.ctx.tenantId));
          await db.update(questions).set({ latestRevisionId: null }).where(
            eq(questions.tenantId, f.ctx.tenantId),
          );
          for (let attempt = 0; attempt < 2; attempt++) {
            await page.getByRole('button', { name: 'Preview organization', exact: true }).click();
            await page.getByRole('alert').waitFor();
            await page.getByRole('button', { name: 'Preview organization', exact: true }).waitFor({
              state: 'visible',
            });
          }
          expect(submittedIds.length).toStrictEqual(2);
          expect(submittedIds[0], 'An unchanged retry keeps its request identity').toStrictEqual(
            submittedIds[1],
          );
          // Switch away and back on the same page after failure, as in the production incident.
          await page.locator('select[name=collection]').selectOption(f.destinationId);
          await page.locator('select[name=collection]').selectOption(f.originId);
          await page.getByLabel('Vocabulary name', { exact: true }).fill('Corrected science rules');
          for (const question of published) {
            await db.update(questions).set({ latestRevisionId: question.revision }).where(
              eq(questions.id, question.id),
            );
          }
          await page.screenshot({
            path: '/tmp/qflow-organization-setup.png',
            fullPage: true,
          });
          await page.getByRole('button', { name: 'Preview organization', exact: true }).click();
          await page.waitForURL((url) => url.searchParams.get('kind') === 'organization');
          expect(submittedIds.length).toStrictEqual(3);
          if (!(submittedIds[2] !== submittedIds[1])) {
            expect.unreachable('Changed inputs receive a new request identity');
          }
          const previewUrl = page.url();
          await runtime.drain();
          await page.reload();
          await page.getByRole('button', { name: 'Organize collection', exact: true }).waitFor();
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            )).length,
          ).toStrictEqual(0);
          expect(
            (await db.select().from(organizationActivation).where(
              eq(organizationActivation.collectionId, f.originId),
            )).length,
          ).toStrictEqual(0);
          await page.getByText('View question', { exact: true }).first().click();
          await page.screenshot({
            path: '/tmp/qflow-organization-preview.png',
            fullPage: true,
          });
          await page.getByRole('button', { name: 'Organize collection', exact: true }).click();
          await page.waitForURL((url) => url.toString() !== previewUrl);
          const appliedRunUrl = page.url();
          await page.goto(`${app.baseUrl}/items`);
          await runtime.drain();
          await page.reload();
          const updates = page.locator('summary').filter({ hasText: 'Organization updates (1)' });
          await updates.waitFor();
          await updates.focus();
          await page.keyboard.press('Enter');
          await page.getByText('Organization complete', { exact: false }).waitFor();
          await page.screenshot({ path: '/tmp/qflow-notices-desktop.png' });
          await page.setViewportSize({ width: 390, height: 844 });
          if (
            !(await page.evaluate(() =>
              document.documentElement.scrollWidth <= globalThis.innerWidth
            ))
          ) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth )',
            );
          }
          await page.screenshot({ path: '/tmp/qflow-notices-mobile.png' });
          await page.setViewportSize({ width: 1360, height: 1000 });
          // A failed acknowledgement keeps the update available and does not navigate away.
          await page.route('**/api/items/organization-notices', async (route) => {
            if (route.request().method() === 'POST') {
              return await route.fulfill({ status: 503, body: '{}' });
            }
            await route.continue();
          });
          await page.getByRole('button', { name: 'View results', exact: true }).click();
          await page.getByRole('alert').filter({
            hasText: 'Could not update organization notices.',
          }).waitFor();
          if (!(new URL(page.url()).pathname === '/items')) {
            expect.unreachable("Expected new URL(page.url()).pathname === '/items'");
          }
          await page.unroute('**/api/items/organization-notices');
          const viewResults = page.getByRole('button', { name: 'View results', exact: true });
          await viewResults.focus();
          await page.keyboard.press('Enter');
          await page.waitForURL(appliedRunUrl);
          // Read persisted acknowledgement independently of navigation and background polls.
          const noticesRead = await context.request.get(
            `${app.baseUrl}/api/items/organization-notices`,
          );
          expect(noticesRead.status()).toStrictEqual(200);
          expect((await noticesRead.json()).total).toStrictEqual(0);
          await page.goto(`${app.baseUrl}/assessments`);
          expect(await page.getByText('Organization updates (1)', { exact: true }).count())
            .toStrictEqual(0);
          await page.goto(appliedRunUrl);
          await page.getByRole('button', { name: 'Undo this run', exact: true }).waitFor();
          const downloadLink = page.getByRole('link', {
            name: 'Download run summary',
            exact: true,
          });
          await downloadLink.focus();
          const pendingDownload = page.waitForEvent('download');
          await page.keyboard.press('Enter');
          const download = await pendingDownload;
          const reportPath = await download.path();
          if (!reportPath) expect.unreachable('Expected reportPath');
          const report = await _fs.readFile(reportPath, 'utf8');
          expect(report).toContain('# Question organization summary');
          expect(report).toContain('| Organized | 3 |');
          expect(report).toContain('| Life science | Cells | 0 | 3 | 0 | 3 |');
          await page.screenshot({ path: '/tmp/qflow-run-report-desktop.png' });
          await page.setViewportSize({ width: 390, height: 844 });
          await downloadLink.scrollIntoViewIfNeeded();
          if (
            !(await page.evaluate(() =>
              document.documentElement.scrollWidth <= globalThis.innerWidth
            ))
          ) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth )',
            );
          }
          await page.screenshot({ path: '/tmp/qflow-run-report-mobile.png' });
          await page.setViewportSize({ width: 1360, height: 1000 });

          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            )).length,
          ).toStrictEqual(3);
          await page.getByRole('button', {
            name: 'Use these rules for future questions',
            exact: true,
          }).click();
          await page.getByRole('button', { name: 'Turn off automatic organization', exact: true })
            .waitFor();
          if (
            !((await db.select().from(organizationActivation).where(
              eq(organizationActivation.collectionId, f.originId),
            ))[0].setupId)
          ) {
            expect.unreachable(
              'Expected (await db.select().from(organizationActivation).where( eq(organizationActivation.collectio',
            );
          }
          const deactivate = page.getByRole('button', {
            name: 'Turn off automatic organization',
            exact: true,
          });
          // Finish this page's hydration before holding the next page's copy of the same module.
          await deactivate.and(page.locator(':enabled')).waitFor();
          // Hold the next page's island module so server-rendered controls cannot accept lost clicks.
          const progressModule = await questionOrganizationProgressModule(app.baseUrl);
          const hydration = Promise.withResolvers<void>();
          const pendingModule = page.waitForRequest(progressModule);
          await page.route(progressModule, async (route) => {
            await hydration.promise;
            await route.continue();
          });
          const undo = page.getByRole('button', { name: 'Undo this run', exact: true });
          try {
            // Inspect SSR before navigation finishes loading its deliberately held production script.
            await deactivate.click({ noWaitAfter: true });
            await pendingModule;
            await page.getByText('Automatic organization is off.', { exact: true }).waitFor();
            expect(await undo.isDisabled(), 'Undo waits for island hydration').toStrictEqual(true);
          } finally {
            hydration.resolve();
            await page.unroute(progressModule);
          }
          await undo.click();
          await page.getByRole('status').filter({ hasText: 'Undoing changes' }).waitFor();
          await runtime.drain();
          await page.reload();
          await page.getByRole('status').filter({ hasText: 'Changes undone' }).waitFor();
          expect(
            await page.getByRole('link', { name: 'Download run summary', exact: true }).count(),
          ).toStrictEqual(0);
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            )).length,
          ).toStrictEqual(0);
          await page.setViewportSize({ width: 390, height: 844 });
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
            path: '/tmp/qflow-organization-mobile.png',
            fullPage: true,
          });
          const importedCollectionId = crypto.randomUUID();
          await db.insert(bankCollections).values({
            id: importedCollectionId,
            tenantId: f.ctx.tenantId,
            name: 'Imported biology questions',
            description: '',
            position: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          await withImportedOrganizationQuestions(f.ctx, importedCollectionId, async () => {
            await runtime!.close();
            runtime = await organizationBrowserRuntime(f.ctx, 'no_ai');
            runtimeUrl = runtime.url;
            await page.goto(
              `${app!.baseUrl}/items/organize?scope=${
                encodeURIComponent('collection=' + importedCollectionId)
              }`,
            );
            await page.getByRole('button', { name: 'Use section titles as topics', exact: true })
              .click();
            expect(
              await page.getByLabel('Questions without a source mapping', { exact: true })
                .inputValue(),
            ).toStrictEqual('source_only');
            expect(await page.getByLabel('Vocabulary name', { exact: true }).inputValue())
              .toStrictEqual('Imported biology questions');
            expect(
              await page.locator('input[name=audience]').count(),
              'Source mappings must not ask for audience setup',
            ).toStrictEqual(0);
            const newTopic = page.locator('select[name^="destination-source-"]');
            expect(await newTopic.count()).toStrictEqual(2);
            for (const select of await newTopic.all()) await select.selectOption(f.destinationId);
            expect((await Promise.all(
              (await page.locator('input[name^="label-source-"]').all()).map((field) =>
                field.inputValue()
              ),
            )).sort()).toStrictEqual(['Biology / Cells', 'Physics / Energy']);
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
              path: '/tmp/qflow-organization-source-setup.png',
              fullPage: true,
            });
            await page.getByRole('button', { name: 'Preview organization', exact: true }).click();
            await page.waitForURL((url) => url.searchParams.get('kind') === 'organization');
            const sourcePreview = page.url();
            await runtime.drain();
            await page.reload();
            await page.getByRole('button', { name: 'Organize collection', exact: true }).click();
            await page.waitForURL((url) => url.toString() !== sourcePreview);
            const sourceApplyUrl = page.url();
            await runtime.drain();
            await page.goto(`${app!.baseUrl}/items/organize`);
            const sourceUpdates = page.locator('summary').filter({
              hasText: 'Organization updates (1)',
            });
            await sourceUpdates.click();
            const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
            await dismiss.focus();
            await page.keyboard.press('Enter');
            await page.getByText('You’re all caught up.', { exact: true }).waitFor();
            if (
              !(await page.locator('summary').filter({ hasText: 'Organization updates (0)' })
                .evaluate((element) => element === document.activeElement))
            ) {
              expect.unreachable(
                "Expected await page.locator('summary').filter({ hasText: 'Organization updates (0)' }) .evaluate((e",
              );
            }
            const dismissedRead = await context.request.get(
              `${app!.baseUrl}/api/items/organization-notices`,
            );
            expect(dismissedRead.status()).toStrictEqual(200);
            expect((await dismissedRead.json()).total).toStrictEqual(0);
            await page.reload();
            expect(await page.getByText('Organization updates (1)', { exact: true }).count())
              .toStrictEqual(0);
            await page.goto(sourceApplyUrl);
            await page.getByRole('button', { name: 'Undo this run', exact: true }).waitFor();
            expect(
              (await db.select().from(bankCollectionItems).where(
                eq(bankCollectionItems.collectionId, f.destinationId),
              )).length,
            ).toStrictEqual(2);
            await page.getByRole('button', { name: 'Undo this run', exact: true }).click();
            await page.getByRole('status').filter({ hasText: 'Undoing changes' }).waitFor();
            await runtime.drain();
            await page.reload();
            await page.getByRole('status').filter({ hasText: 'Changes undone' }).waitFor();
            expect(
              (await db.select().from(bankCollectionItems).where(
                eq(bankCollectionItems.collectionId, f.destinationId),
              )).length,
            ).toStrictEqual(0);
          }, 'qti');
          expect(errors).toStrictEqual([]);
        } finally {
          await runtime?.close();
          await app?.close();
          await db.delete(authSessions).where(eq(authSessions.userId, f.ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, f.ctx.userId));
        }
      }, { activation: 'disabled', clef: true, difficulty: 'none' });
    } finally {
      await shutdownDb();
    }
  },
);

/** Resolve the exact compiled hydration module from the required production manifest. */
async function questionOrganizationProgressModule(baseUrl: string): Promise<string> {
  const manifest: unknown = JSON.parse(
    await _fs.readFile('.cloudflare/output/v1/workers/default/assets/.vite/manifest.json', 'utf8'),
  );
  if (!(manifest && typeof manifest === 'object' && !Array.isArray(manifest))) {
    expect.unreachable('Built hydration guard requires a client manifest object');
  }
  const entry: unknown = Reflect.get(manifest, 'islands/QuestionOrganizationProgress.tsx');
  if (
    !(entry && typeof entry === 'object' && 'file' in entry && typeof entry.file === 'string' &&
      /^assets\/[^/]+\.js$/.test(entry.file))
  ) {
    expect.unreachable(
      'Built hydration guard requires the QuestionOrganizationProgress island asset',
    );
  }
  return new URL(entry.file, `${baseUrl}/`).href;
}
