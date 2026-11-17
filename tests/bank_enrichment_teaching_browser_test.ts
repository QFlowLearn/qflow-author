import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { enrichmentRuns } from '../lib/db/bank_enrichment_job_schema.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { organizationBrowserRuntime } from './helpers/organization_browser_runtime.ts';
import { currentQuestion, finishMutation } from './helpers/enrichment_mutation_fixture.ts';

testCase('instructor corrects matching topics in one action, sees teaching results and undoes', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
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
            environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
          },
          headless: true,
        });
        runtime = await organizationBrowserRuntime(f.ctx, 'no_ai');
        const runtimeUrl = runtime.url;
        const context: import('playwright').BrowserContext = await app.newContext({
          authSession: await createSession({ tenantId: f.ctx.tenantId, userId: f.ctx.userId }),
          browser: { viewport: { width: 1280, height: 950 } },
        });
        const page: import('playwright').Page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/items/organize**', async (route) => {
          if (route.request().method() !== 'POST') return await route.continue();
          const url = new URL(route.request().url());
          const response = await route.fetch({ url: runtimeUrl + url.pathname + url.search });
          await route.fulfill({ response });
        });
        await page.goto(`${app.baseUrl}/items?scheme=${f.schemeId}`);
        await page.getByRole('link', { name: 'Edit matching classifications', exact: true })
          .click();
        await page.getByRole('combobox', { name: 'Topic', exact: true }).selectOption('cells');
        expect(await page.getByRole('combobox', { name: 'Subject', exact: true }).inputValue())
          .toStrictEqual('life');
        await page.getByRole('button', { name: 'Update 3 questions', exact: true }).click({
          trial: true,
        });
        await page.screenshot({
          path: '/tmp/qflow-teaching-form.png',
          fullPage: true,
        });
        await page.getByRole('button', { name: 'Update 3 questions', exact: true }).click();
        await page.waitForURL((url) => /\/items\/organize\/[0-9a-f-]{36}$/.test(url.pathname));
        const id = new URL(page.url()).pathname.split('/').pop();
        if (!id) expect.unreachable('Expected id');
        const [run] = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id));
        if (!(run.workflowExecutionId)) expect.unreachable('Expected run.workflowExecutionId');
        await finishMutation(id, run.workflowExecutionId);
        await page.reload();
        await page.getByText(
          'This category set now has 3 teaching examples.',
          { exact: true },
        ).waitFor();
        expect((await currentQuestion(f.ctx, f.schemeId, f.ids[0])).topic?.origin).toStrictEqual(
          'human',
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: '/tmp/qflow-teaching-result-mobile.png',
          fullPage: true,
        });
        if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
          expect.unreachable(
            'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
          );
        }
        await page.getByText('Undo this run', { exact: true }).click();
        await page.getByRole('button', { name: 'Restore previous classifications', exact: true })
          .click();
        await page.waitForURL((url) => !url.pathname.endsWith(id));
        const undoId = new URL(page.url()).pathname.split('/').pop();
        if (!undoId) expect.unreachable('Expected undoId');
        const [undo] = await db.select().from(enrichmentRuns).where(
          eq(enrichmentRuns.id, undoId),
        );
        if (!(undo.workflowExecutionId)) expect.unreachable('Expected undo.workflowExecutionId');
        await finishMutation(undoId, undo.workflowExecutionId);
        await page.reload();
        const status = await new BankEnrichmentJobRead(db, organizationNow).get(f.ctx, undoId);
        if (!(status.ok && status.value.kind === 'undo')) {
          expect.unreachable("Expected status.ok && status.value.kind === 'undo'");
        }
        expect(status.value.teachingExampleCount).toStrictEqual(0);
        await page.getByText(
          'This category set now has 0 teaching examples.',
          { exact: true },
        ).waitFor();
        expect(errors).toStrictEqual([]);
      } finally {
        await runtime?.close();
        await app?.close();
        await db.delete(authSessions).where(eq(authSessions.userId, f.ctx.userId));
        await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, f.ctx.userId));
      }
    }, { count: 3, difficulty: 'none', activation: 'disabled' });
  } finally {
    await shutdownDb();
  }
});
