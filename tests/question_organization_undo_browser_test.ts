import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { organizationRuns } from '../lib/db/question_organization_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { settleOrganizationAfterWorkflowTerminal } from '../lib/services/question_organization_settlement.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import {
  organizationBrowserEnvironment,
  organizationBrowserRuntime,
} from './helpers/organization_browser_runtime.ts';

testCase(
  'bulk undo survives a lost response, updates progress without losing focus, and continues after a stopped worker',
  { skip: process.env['QFLOW_BROWSER_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!(databaseUrl && /test/.test(new URL(databaseUrl).pathname))) {
      expect.unreachable('Expected databaseUrl && /test/.test(new URL(databaseUrl).pathname)');
    }
    try {
      await withOrganizationWorkspace(async (f) => {
        let app: LocalAppBrowser | undefined;
        let runtime = await organizationBrowserRuntime(f.ctx, 'no_ai');
        const services = {
          database: db,
          now: organizationNow,
          newId: () => crypto.randomUUID(),
          provider: () => {
            throw new Error('Undo must not call AI');
          },
        };
        try {
          for (let i = 0; i < 12; i++) {
            if (!((await processOrganizationStep(f.params, services)).ok)) {
              expect.unreachable('Expected (await processOrganizationStep(f.params, services)).ok');
            }
          }
          await saveUserSettings(f.ctx.userId, createInitialUserSettings('en-US'));
          app = await openLocalAppBrowser({
            endpoint: {
              _tag: 'ManagedLocalApp',
              portRange: { first: 5290, lastExclusive: 5300 },
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
          let loseResponse = true;
          await page.route('**/items/organize**', async (route) => {
            if (route.request().method() !== 'POST') return await route.continue();
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: runtime.url + url.pathname + url.search });
            if (loseResponse && response.ok()) {
              loseResponse = false;
              await route.fulfill({
                status: 503,
                contentType: 'text/plain',
                body: 'Test response interruption',
              });
            } else await route.fulfill({ response });
          });
          await page.goto(`${app.baseUrl}/items/organize/${f.runId}?kind=organization`);
          const undo = page.getByRole('button', { name: 'Undo this run', exact: true });
          await undo.click();
          await page.getByText(
            'The request could not be confirmed. Try again; the same request will not start a duplicate run.',
            { exact: true },
          ).waitFor();
          const [queued] = await db.select().from(organizationRuns).where(
            eq(organizationRuns.id, f.runId),
          );
          expect(queued.state).toStrictEqual('undoing');
          await undo.click();
          await page.getByRole('status').filter({ hasText: 'Undoing changes' }).waitFor();
          expect(
            (await db.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId)))[0]
              .executionId,
          ).toStrictEqual(queued.executionId);
          expect(await undo.count()).toStrictEqual(0);
          expect(
            await page.getByRole('button', { name: 'Resume unfinished questions', exact: true })
              .count(),
          ).toStrictEqual(0);
          await page.getByRole('link', { name: 'Open collection', exact: true }).focus();
          expect(
            await processOrganizationStep({
              jobId: f.runId,
              workflowExecutionId: queued.executionId,
            }, services),
          ).toStrictEqual({ ok: true, value: { state: 'more', completed: 20 } });
          await page.getByText('Checked 20 of 45 questions. Later edits are kept.', { exact: true })
            .waitFor();
          expect(await page.evaluate(() => document.activeElement?.textContent)).toStrictEqual(
            'Open collection',
          );
          await page.screenshot({
            path: '/tmp/qflow-undo-progress-desktop.png',
            fullPage: true,
          });
          await db.transaction((tx) =>
            settleOrganizationAfterWorkflowTerminal(tx, {
              jobId: f.runId,
              tenantId: f.ctx.tenantId,
              executionId: queued.executionId,
            })
          );
          await page.getByRole('button', { name: 'Continue undo', exact: true }).waitFor();
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
            path: '/tmp/qflow-undo-stopped-mobile.png',
            fullPage: true,
          });
          await runtime.close();
          runtime = await organizationBrowserRuntime(f.ctx, 'no_ai');
          await page.getByRole('button', { name: 'Continue undo', exact: true }).click();
          await page.getByRole('status').filter({ hasText: 'Undoing changes' }).waitFor();
          await runtime.drain();
          await page.getByRole('status').filter({ hasText: 'Changes undone' }).waitFor();
          expect(
            (await db.select().from(bankCollectionItems).where(
              eq(bankCollectionItems.collectionId, f.destinationId),
            )).length,
          ).toStrictEqual(0);
          expect(
            (await db.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId)))[0]
              .undoProcessed,
          ).toStrictEqual(45);
          expect(errors).toStrictEqual([]);
        } finally {
          await runtime.close();
          await app?.close();
          await db.delete(authSessions).where(eq(authSessions.userId, f.ctx.userId));
          await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, f.ctx.userId));
        }
      }, { count: 45, activation: 'disabled' });
    } finally {
      await shutdownDb();
    }
  },
);
