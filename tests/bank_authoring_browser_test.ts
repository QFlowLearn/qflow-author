import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { Buffer } from 'node:buffer';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessments,
  auditLogs,
  authSessions,
  bankCollectionItems,
  bankCollections,
  draftSessions,
  editorialEvents,
  migrationBatches,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
  userSettingsTable,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  'bank browser creates and resumes a draft, imports owned questions, and edits the committed item',
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const tenantId = crypto.randomUUID(),
      userId = crypto.randomUUID(),
      collectionId = crypto.randomUUID();
    const auth: RequestContext = { tenantId, userId, role: 'owner' };
    const i18n = createI18n('en-US', catalogForLocale('en-US'));
    let app: LocalAppBrowser | undefined;
    try {
      await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Bank browser' });
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.test`,
        emailNormalized: `${userId}@example.test`,
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      await db.insert(bankCollections).values({
        id: collectionId,
        tenantId,
        name: 'Browser collection',
        description: '',
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await saveUserSettings(userId, createInitialUserSettings('en-US'));
      app = await openLocalAppBrowser({
        endpoint: {
          _tag: 'ManagedLocalApp',
          portRange: { first: 5188, lastExclusive: 5198 },
          environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
        },
        headless: true,
      });
      const base = app.baseUrl;
      const context: import('playwright').BrowserContext = await app.newContext({
        authSession: await createSession({ tenantId, userId }),
      });
      const page: import('playwright').Page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(15000);
      await page.goto(`${base}/items?collection=${collectionId}`);
      await page.getByRole('link', { name: 'Create question', exact: true }).click();
      await page.getByRole('button', { name: 'Start draft', exact: true }).click();
      await page.waitForURL('**/items/drafts/*');
      const draftId = new URL(page.url()).pathname.split('/').at(-1);
      await page.locator('[contenteditable=true]').first().waitFor();
      const savedDraft = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && response.url().endsWith(`/api/drafts/${draftId}`)
      );
      await page.locator('[data-qflow-root=ItemEditor][data-qflow-state=ready]').waitFor();
      await page.getByRole('button', { name: i18n.t('inspector.details'), exact: true }).click();
      await page.getByRole('textbox', { name: /^Title/ }).fill('Resumable browser question');
      expect((await savedDraft).status()).toStrictEqual(200);
      const [stored] = await db.select().from(draftSessions).where(eq(draftSessions.id, draftId!));
      expect(stored.clientState.title).toStrictEqual('Resumable browser question');
      page.on('dialog', (dialog) => dialog.accept());
      await page.getByRole('link', { name: 'My drafts', exact: true }).click();
      await page.getByRole('link', { name: 'Resumable browser question', exact: true }).click();
      await page.locator('[contenteditable=true]').first().waitFor();
      await page.getByRole('button', { name: 'Save item', exact: true }).click();
      await page.waitForURL(/\/items\/[0-9a-f-]+$/);
      await page.getByRole('heading', { name: 'Item history', exact: true }).waitFor();
      expect(await db.select().from(assessments).where(eq(assessments.tenantId, tenantId)))
        .toStrictEqual([]);
      await page.goto(`${base}/items?collection=${collectionId}`);
      await page.getByRole('link', { name: 'Resumable browser question', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Import questions', exact: true }).click();
      expect(new URL(page.url()).pathname).toStrictEqual('/imports/new');
      expect(await page.getByRole('main').locator('form[action="/assessments/new"]').count())
        .toStrictEqual(0);
      expect(
        await page.getByRole('link', { name: i18n.t('imports.intake.cancel'), exact: true })
          .getAttribute('href'),
      ).toStrictEqual(`/items?collection=${collectionId}`);
      expect(await page.locator('input[value=generate_new]').count()).toStrictEqual(0);
      await page.waitForFunction(() =>
        !document.querySelector<HTMLInputElement>('#bring-source-files')?.disabled
      );
      await page.locator('#bring-source-files').setInputFiles({
        name: 'owned.respondus',
        mimeType: 'text/plain',
        buffer: Buffer.from('1. Which value equals two plus two?\na. 3\n*b. 4\nPoints: 1'),
      });
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource'), exact: true })
        .click();
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview'), exact: true })
        .click();
      await page.waitForURL(/\/imports\/[0-9a-f-]+$/);
      const runId = new URL(page.url()).pathname.split('/').at(-1);
      if (!runId) expect.unreachable('Expected runId');
      const run = await getMigrationRun(auth, runId);
      if (!run) expect.unreachable('Expected run');
      expect(run.destination).toStrictEqual({ _tag: 'WorkspaceBank', collectionId });
      expect(await page.locator('select[name=blueprintTargetId]').count()).toStrictEqual(0);
      await page.locator('input[type=checkbox][name=itemId]').check();
      await page.getByRole('button', { name: i18n.t('imports.report.acceptSelected'), exact: true })
        .click();
      await page.goto(`${base}/imports/batches/${run.batchId}`);
      await page.locator('select[name=reviewerId]').selectOption(userId);
      await page.getByRole('button', { name: i18n.t('imports.batch.assignReviewer'), exact: true })
        .click();
      await page.goto(`${base}/imports/${runId}`);
      await page.getByRole('button', { name: i18n.t('imports.report.submit'), exact: true })
        .click();
      await page.getByRole('button', { name: i18n.t('imports.report.approve'), exact: true })
        .click();
      await page.locator('input[name=approval]').check();
      await page.getByRole('button', {
        name: i18n.t('imports.report.commitAllAccepted'),
        exact: true,
      })
        .click();
      await expect.poll(async () => (await getMigrationRun(auth, runId))?.execution._tag, {
        timeout: 60000,
      }).toBe('Committed');
      await page.reload();
      await page.getByRole('link', { name: i18n.t('imports.report.openBank'), exact: true })
        .click();
      await page.waitForURL(`**/items?collection=${collectionId}`);
      const committed = await getMigrationRun(auth, runId);
      const importedId = committed?.items[0].createdQuestionId;
      if (!importedId) expect.unreachable('Expected importedId');
      await page.locator(`a[href="/items/${importedId}"], a[href^="/items/${importedId}?"]`).first()
        .click();
      await page.getByRole('heading', { name: 'Item history', exact: true }).waitFor();
      await page.goto(`${base}/items/${importedId}/edit`);
      await page.locator('[contenteditable=true]').first().waitFor();
      await page.locator('[data-qflow-root=ItemEditor][data-qflow-state=ready]').waitFor();
      await page.getByRole('button', { name: i18n.t('inspector.details'), exact: true }).click();
      await page.getByRole('textbox', { name: /^Title/ }).fill('Corrected imported question');
      await page.getByRole('button', { name: 'Save item', exact: true }).click();
      await page.waitForURL(`**/items/${importedId}`);
      await page.locator('#revision-2-heading').waitFor();
      await page.screenshot({ path: '/tmp/qflow-bank-intake-history.png', fullPage: true });
      expect(await db.select().from(assessments).where(eq(assessments.tenantId, tenantId)))
        .toStrictEqual([]);
      await context.close();
    } finally {
      await app?.close();
      await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
      await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId));
      await db.delete(draftSessions).where(eq(draftSessions.tenantId, tenantId));
      await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
      await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, tenantId));
      await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
      await db.update(questions).set({ latestRevisionId: null }).where(
        eq(questions.tenantId, tenantId),
      );
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await db.delete(authSessions).where(eq(authSessions.userId, userId));
      await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, userId));
      await db.delete(organizationMemberships).where(
        eq(organizationMemberships.tenantId, tenantId),
      );
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await shutdownDb();
    }
  },
);
