import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import {
  organizationActivation,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import {
  organizationBrowserEnvironment,
  organizationBrowserRuntime,
} from './helpers/organization_browser_runtime.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';

testCase(
  'preview topic correction saves one lesson, survives a lost response and reruns without tagging the bank',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withOrganizationWorkspace(async (f) => {
        let app: LocalAppBrowser | undefined;
        const runtime = await organizationBrowserRuntime(f.ctx);
        try {
          await saveUserSettings(f.ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5260, lastExclusive: 5270 },
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
          page.setDefaultTimeout(20000);
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          let loseResponse = true;
          await page.route('**/items/organize**', async (route) => {
            if (route.request().method() !== 'POST') return await route.continue();
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: runtime.url + url.pathname + url.search });
            if (
              loseResponse && route.request().postData()?.includes('organization-teach-preview') &&
              response.ok()
            ) {
              loseResponse = false;
              await route.fulfill({
                status: 503,
                contentType: 'text/plain',
                body: 'Test connection interruption',
              });
            } else await route.fulfill({ response });
          });
          await page.goto(
            `${app.baseUrl}/items/organize?scope=${encodeURIComponent('collection=' + f.originId)}`,
          );
          await page.getByRole('button', { name: 'Preview organization', exact: true }).click();
          await page.waitForURL((u) => u.searchParams.get('kind') === 'organization');
          await runtime.drain();
          await page.reload();
          const oldUrl = page.url();
          await page.getByText('Showing 20 of 100 preview questions.', { exact: false }).waitFor();
          expect(await page.getByText('Less certain topic', { exact: true }).count()).toStrictEqual(
            10,
          );
          expect(await page.getByText('Source and topic coverage', { exact: true }).count())
            .toStrictEqual(10);
          await page.getByRole('button', { name: 'Organize collection', exact: true }).waitFor();
          await page.getByText('Correct topic', { exact: true }).first().click();
          await page.getByLabel('Topic to teach', { exact: true }).first().selectOption('energy');
          if (
            !(await page.getByRole('button', { name: 'Organize collection', exact: true })
              .isDisabled())
          ) {
            expect.unreachable(
              "Expected await page.getByRole('button', { name: 'Organize collection', exact: true }) .isDisabled()",
            );
          }
          await page.getByRole('status').filter({ hasText: '1 teaching example ready to save' })
            .waitFor();
          await page.getByText('View question', { exact: true }).first().click();
          await page.screenshot({
            path: '/tmp/qflow-preview-correction-desktop.png',
            fullPage: true,
          });
          await page.getByRole('button', {
            name: 'Save corrections and preview again',
            exact: true,
          }).click();
          await page.getByRole('alert').waitFor();
          const countSetups = async () =>
            (await db.select().from(organizationSetups).where(
              eq(organizationSetups.tenantId, f.ctx.tenantId),
            )).length;
          const afterFirst = await countSetups();
          await page.getByRole('button', {
            name: 'Save corrections and preview again',
            exact: true,
          }).click();
          await page.waitForURL((u) => u.toString() !== oldUrl);
          expect(await countSetups()).toStrictEqual(afterFirst);
          await runtime.drain();
          await page.reload();
          await page.getByRole('button', { name: 'Organize collection', exact: true }).waitFor();
          const runId = new URL(page.url()).pathname.split('/').at(-1);
          if (!runId) expect.unreachable('Expected runId');
          const result = await new QuestionOrganizationWorkspace(db, organizationNow).run(
            f.ctx,
            runId,
          );
          if (!(result.ok)) expect.unreachable('Expected result.ok');
          expect(result.value.definition.examples.length).toStrictEqual(1);
          expect(result.value.sample.filter((s) => s.topic === 'Energy').length).toStrictEqual(1);
          expect(
            (await db.select().from(enrichmentChanges).where(
              eq(enrichmentChanges.tenantId, f.ctx.tenantId),
            )).length,
          ).toStrictEqual(0);
          expect(
            (await db.select().from(organizationActivation).where(
              eq(organizationActivation.tenantId, f.ctx.tenantId),
            )).length,
          ).toStrictEqual(0);
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByText('Correct topic', { exact: true }).first().click();
          await page.getByLabel('Topic to teach', { exact: true }).first().selectOption('cells');
          if (
            !(await page.evaluate(() =>
              document.documentElement.scrollWidth <= globalThis.innerWidth
            ))
          ) {
            expect.unreachable(
              'Expected await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth )',
            );
          }
          await page.evaluate(() => globalThis.scrollTo(0, 0));
          await page.screenshot({
            path: '/tmp/qflow-preview-correction-mobile.png',
            fullPage: true,
          });
          await page.getByRole('button', { name: 'Discard corrections', exact: true }).click();
          if (
            !(await page.getByRole('button', { name: 'Organize collection', exact: true })
              .isEnabled())
          ) {
            expect.unreachable(
              "Expected await page.getByRole('button', { name: 'Organize collection', exact: true }) .isEnabled()",
            );
          }
          expect(errors).toStrictEqual([]);
        } finally {
          await runtime.close();
          await app?.close();
          await db.delete(authSessions).where(eq(authSessions.userId, f.ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, f.ctx.userId));
        }
      }, { activation: 'disabled', clef: true, difficulty: 'none', count: 105 });
    } finally {
      await shutdownDb();
    }
  },
);
