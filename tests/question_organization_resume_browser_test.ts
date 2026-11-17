import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { organizationRuns } from '../lib/db/question_organization_schema.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import {
  organizationBrowserEnvironment,
  organizationBrowserRuntime,
} from './helpers/organization_browser_runtime.ts';

testCase(
  'instructor stops and resumes unfinished organization once after a lost response, then undoes the whole run',
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
          if (
            !((await processOrganizationStep(f.params, {
              database: db,
              now: organizationNow,
              newId: () => crypto.randomUUID(),
              provider: () => {
                throw new Error('Source rules must not use AI');
              },
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await processOrganizationStep(f.params, { database: db, now: organizationNow, newId: () =',
            );
          }
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
          page.setDefaultTimeout(20000);
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          let loseResumeResponse = true;
          await page.route('**/items/organize**', async (route) => {
            if (route.request().method() !== 'POST') return await route.continue();
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: runtime.url + url.pathname + url.search });
            if (
              loseResumeResponse && route.request().postData()?.includes('organization-resume') &&
              response.ok()
            ) {
              loseResumeResponse = false;
              await route.fulfill({
                status: 503,
                contentType: 'text/plain',
                body: 'Test connection interruption',
              });
            } else await route.fulfill({ response });
          });
          await page.goto(`${app.baseUrl}/items/organize/${f.runId}?kind=organization`);
          await page.getByRole('button', { name: 'Cancel processing', exact: true }).click();
          const resume = page.getByRole('button', {
            name: 'Resume unfinished questions',
            exact: true,
          });
          await resume.waitFor();
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            )).length,
          ).toStrictEqual(20);
          await page.screenshot({
            path: '/tmp/qflow-organization-resume-desktop.png',
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
            path: '/tmp/qflow-organization-resume-mobile.png',
            fullPage: true,
          });
          await resume.click();
          await page.getByText(
            'The request could not be confirmed. Try again; the same request will not start a duplicate run.',
            { exact: true },
          ).waitFor();
          const [first] = await db.select().from(organizationRuns).where(
            eq(organizationRuns.id, f.runId),
          );
          if (!(first.executionId !== f.params.workflowExecutionId)) {
            expect.unreachable('Expected first.executionId !== f.params.workflowExecutionId');
          }
          await resume.click();
          await page.getByRole('button', { name: 'Cancel processing', exact: true }).waitFor();
          expect(
            (await db.select().from(workflowDispatches).where(
              eq(workflowDispatches.jobId, f.runId),
            )).length,
          ).toStrictEqual(2);
          await runtime.drain();
          await page.reload();
          expect(await resume.count()).toStrictEqual(0);
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            )).length,
          ).toStrictEqual(22);
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
          expect(await resume.count()).toStrictEqual(0);
          expect(errors).toStrictEqual([]);
        } finally {
          await runtime.close();
          await app?.close();
          await db.delete(authSessions).where(eq(authSessions.userId, f.ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, f.ctx.userId));
        }
      }, { activation: 'disabled', count: 22 });
    } finally {
      await shutdownDb();
    }
  },
);
