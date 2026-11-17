import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { organizationActivation } from '../lib/db/question_organization_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import {
  organizationBrowserEnvironment,
  organizationBrowserRuntime,
} from './helpers/organization_browser_runtime.ts';

testCase(
  'paste topics into the existing setup, preserve mappings, and save through a read-only preview',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withOrganizationWorkspace(async (f) => {
        let app: LocalAppBrowser | undefined;
        const runtime = await organizationBrowserRuntime(f.ctx, 'no_ai');
        try {
          await saveUserSettings(f.ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5280, lastExclusive: 5290 },
              environment: {
                ...builtWorkerBrowserEnvironment,
                DATABASE_URL: databaseUrl,
                ...organizationBrowserEnvironment,
              },
            },
            headless: true,
          });
          const context: import('playwright').BrowserContext = await app.newContext({
            authSession: await createSession({ tenantId: f.ctx.tenantId, userId: f.ctx.userId }),
            browser: { viewport: { width: 1360, height: 1000 } },
          });
          const page: import('playwright').Page = await context.newPage();
          page.setDefaultTimeout(15000);
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route('**/items/organize**', async (route) => {
            if (route.request().method() !== 'POST') return await route.continue();
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: runtime.url + url.pathname + url.search });
            await route.fulfill({ response });
          });
          await page.goto(
            `${app.baseUrl}/items/organize?scope=${encodeURIComponent('collection=' + f.originId)}`,
          );
          await page.getByText('Paste a topic list', { exact: true }).click();
          const text = page.getByLabel('Topic list', { exact: true });
          const add = page.getByRole('button', { name: 'Add topics', exact: true });
          await text.fill('Genetics\n' + 'x'.repeat(81));
          await add.click();
          await page.getByRole('alert').filter({ hasText: 'Shorten the topic on line 2' })
            .waitFor();
          expect(await text.getAttribute('aria-invalid')).toStrictEqual('true');
          if (!(await text.evaluate((element) => document.activeElement === element))) {
            expect.unreachable(
              'Expected await text.evaluate((element) => document.activeElement === element)',
            );
          }
          expect(await page.locator('input[name^="label-outline-"]').count()).toStrictEqual(0);
          await text.fill('1. Genetics .... 12\n• Ecosystems\nCells\nGenetics');
          await page.getByLabel('Add topics under', { exact: true }).selectOption('life');
          await add.focus();
          await page.keyboard.press('Enter');
          await page.getByRole('status').filter({
            hasText: 'Added 2 topics. Skipped 2 repeated names.',
          }).waitFor();
          expect(await page.locator('#category-cells').inputValue()).toStrictEqual('Cells');
          expect(await page.locator('#category-energy').inputValue()).toStrictEqual('Energy');
          expect(await page.getByLabel('Questions without a source mapping').inputValue())
            .toStrictEqual('source_only');
          const genetics = page.locator('input[name^="label-outline-"]').first();
          await genetics.fill('Genetics and inheritance');
          expect(runtime.postCount()).toStrictEqual(0);
          await page.evaluate(() => globalThis.scrollTo(0, 0));
          await page.screenshot({
            path: '/tmp/qflow-outline-desktop.png',
            fullPage: true,
          });
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
            path: '/tmp/qflow-outline-mobile.png',
            fullPage: true,
          });
          await page.getByRole('button', { name: 'Preview organization', exact: true }).click();
          await page.waitForURL((url) => url.searchParams.get('kind') === 'organization');
          await runtime.drain();
          const runId = new URL(page.url()).pathname.split('/').at(-1)!;
          const workspace = new QuestionOrganizationWorkspace(db, () => new Date());
          const view = await workspace.run(
            f.ctx,
            runId,
          );
          if (!(view.ok)) expect.unreachable('Expected view.ok');
          expect(view.value.definition.topics.map((t) => t.label)).toStrictEqual([
            'Cells',
            'Energy',
            'Genetics and inheritance',
            'Ecosystems',
          ]);
          const home = await workspace.home(f.ctx);
          if (!(home.ok)) expect.unreachable('Expected home.ok');
          const saved = home.value.setups.find((s) => s.collectionId === f.originId);
          if (!saved) expect.unreachable('Expected saved');
          expect(saved.policy.sourceMappings).toStrictEqual([{
            sourceId: f.sourceId,
            sectionKey: 'chapter-1',
            topicId: 'cells',
          }]);
          expect(saved.policy.filing).toStrictEqual([{
            topicId: 'cells',
            collectionId: f.destinationId,
          }]);
          expect(
            await db.select().from(organizationActivation).where(
              eq(organizationActivation.collectionId, f.originId),
            ),
          ).toStrictEqual([]);
          expect(
            await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            ),
          ).toStrictEqual([]);
          // A fresh setup has no lingering pasted text, status or topics from the prior collection.
          await page.goto(
            `${app.baseUrl}/items/organize?scope=${encodeURIComponent('collection=' + f.originId)}`,
          );
          await page.getByText('Paste a topic list', { exact: true }).click();
          await page.getByLabel('Topic list', { exact: true }).fill('Discard this draft');
          await page.locator('select[name="collection"]').selectOption(f.destinationId);
          await page.getByText('Paste a topic list', { exact: true }).click();
          expect(await page.getByLabel('Topic list', { exact: true }).inputValue()).toStrictEqual(
            '',
          );
          expect(errors).toStrictEqual([]);
        } finally {
          await runtime.close();
          await app?.close();
          await db.delete(authSessions).where(eq(authSessions.userId, f.ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, f.ctx.userId));
        }
      }, { activation: 'disabled', difficulty: 'none' });
    } finally {
      await shutdownDb();
    }
  },
);
