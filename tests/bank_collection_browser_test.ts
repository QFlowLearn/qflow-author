import { expect, test as testCase } from 'vitest';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';

import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import {
  auditLogs,
  authSessions,
  draftSessions,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
  userSettingsTable,
} from '../lib/db/schema.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  'collection browser flow creates, files, renames, archives, restores, and preserves question identity',
  async function () {
    const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const questionId = crypto.randomUUID();
    const secondQuestionId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'instructor' };
    let app: LocalAppBrowser | undefined;
    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug: tenantId,
        name: 'Editorial browser fixture',
      });
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        emailNormalized: `${userId}@example.com`,
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'instructor',
      });
      await saveUserSettings(userId, createInitialUserSettings('en-US'));
      const body = {
        ...TYPE_DRIVERS.single_select.defaults(),
        type: 'single_select' as const,
        title: 'Inherited question',
        promptHtml: '<p>Which city is the capital of France?</p>',
        choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
        correctId: 'A',
        itemLanguage: newAuthoringItemLanguage(),
      };
      const xml = exportQti3AssessmentItemXml(
        'single_select',
        prepareDriverDraftForBuild('single_select', body),
        { identifier: 'collection-browser' },
      );
      await saveQuestionRevisionFixture(ctx, {
        questionId,
        title: body.title,
        body,
        provenance: { _tag: 'Authored' },
        qtiXml: xml,
        draftState: 'published',
      });
      await saveQuestionRevisionFixture(ctx, {
        questionId: secondQuestionId,
        title: 'Second question',
        body: { ...body, title: 'Second question' },
        provenance: { _tag: 'Authored' },
        qtiXml: xml,
        draftState: 'published',
      });
      const original = await db.select().from(questions).where(eq(questions.id, questionId));
      app = await openLocalAppBrowser({
        endpoint: {
          _tag: 'ManagedLocalApp',
          portRange: { first: 5188, lastExclusive: 5198 },
          environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
        },
        headless: true,
      });
      const context: import('playwright').BrowserContext = await app.newContext({
        authSession: await createSession({ tenantId, userId }),
      });
      const page: import('playwright').Page = await context.newPage();
      await page.goto(`${app.baseUrl}/items`);
      await page.getByRole('heading', { name: 'Question bank', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Collections', exact: true }).click();
      const create = page.locator('form').filter({
        has: page.getByRole('heading', { name: 'Create collection', exact: true }),
      });
      await create.getByLabel('Collection name (required)').fill('Biology / Genetics');
      await create.getByRole('button', { name: 'Create collection', exact: true }).click();
      await page.getByRole('heading', { name: 'Biology / Genetics', exact: true }).waitFor();
      const firstId = new URL(page.url()).searchParams.get('collection');
      if (!firstId) expect.unreachable('Expected firstId');
      await page.getByRole('link', { name: 'Questions', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Select Inherited question' }).check();
      await page.getByRole('checkbox', { name: 'Select Second question' }).check();
      await page.locator('select[name=bulkAction]').selectOption('add_to_collection');
      await page.locator('select[name=collectionId]').selectOption(firstId);
      await page.locator('form').filter({ has: page.locator('select[name=bulkAction]') }).getByRole(
        'button',
      ).filter({ hasText: 'Apply' }).click();
      await page.getByRole('status').filter({ hasText: 'Collection updated.' }).waitFor();
      await page.goto(`${app.baseUrl}/items?collection=${firstId}`);
      await page.getByRole('link', { name: 'Inherited question', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Collections', exact: true }).click();
      await page.getByRole('link', { name: 'Biology / Genetics', exact: true }).click();
      const edit = page.locator('form').filter({
        has: page.getByRole('heading', { name: 'Edit collection', exact: true }),
      });
      await edit.getByLabel('Collection name (required)').fill('Genetics');
      await edit.getByRole('button', { name: 'Save collection', exact: true }).click();
      await page.getByRole('heading', { name: 'Genetics', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Archive collection', exact: true }).click();
      await page.getByText('Archived collections', { exact: true }).waitFor();
      expect(
        (await page.request.get(`${app.baseUrl}/items/collections/${firstId}/arrange`)).status(),
      ).toStrictEqual(404);
      await page.getByRole('link', { name: 'Questions', exact: true }).click();
      await page.goto(`${app.baseUrl}/items?collection=unfiled`);
      expect(await page.getByRole('link', { name: 'Inherited question', exact: true }).count())
        .toStrictEqual(0);
      await page.getByRole('link', { name: 'Collections', exact: true }).click();
      await page.getByRole('link', { name: /Genetics/ }).click();
      await page.getByRole('button', { name: 'Restore collection', exact: true }).click();
      await page.getByRole('heading', { name: 'Genetics', exact: true }).waitFor();
      await create.getByLabel('Collection name (required)').fill('AP Biology');
      await create.getByRole('button', { name: 'Create collection', exact: true }).click();
      await page.getByRole('heading', { name: 'AP Biology', exact: true }).waitFor();
      const secondId = new URL(page.url()).searchParams.get('collection');
      if (!secondId) expect.unreachable('Expected secondId');
      const questionsHref = await page.getByRole('link', { name: 'Questions', exact: true })
        .getAttribute('href');
      if (!questionsHref) expect.unreachable('Questions navigation is missing');
      let releaseHydration: () => void = () => {};
      const hydrationHeld = new Promise<void>((resolve) => {
        releaseHydration = resolve;
      });
      const bootstrapPattern = /\/assets\/bootstrap-[^/]+\.js$/;
      await page.route(bootstrapPattern, async (route) => {
        await hydrationHeld;
        await route.continue();
      });
      try {
        await page.goto(new URL(questionsHref, page.url()).href, { waitUntil: 'commit' });
        const inherited = page.getByRole('checkbox', { name: 'Select Inherited question' });
        await inherited.check();
        await page.locator('select[name=bulkAction]').selectOption('add_to_collection');
        releaseHydration();
        await page.locator('[data-qflow-root=BankQuestionTable][data-qflow-state=ready]')
          .waitFor({ state: 'attached' });
        await page.locator('[data-qflow-root=BankBulkControls][data-qflow-state=ready]')
          .waitFor({ state: 'attached' });
        expect(await inherited.isChecked()).toBe(true);
        expect(await page.locator('select[name=bulkAction]').inputValue()).toBe(
          'add_to_collection',
        );
        const selectPage = page.getByRole('checkbox', { name: 'Select this page', exact: true });
        await selectPage.check();
        expect(await page.locator('input[name=questionId]:checked').count()).toBe(2);
        await selectPage.uncheck();
        expect(await page.locator('input[name=questionId]:checked').count()).toBe(0);
        await inherited.check();
      } finally {
        releaseHydration();
        await page.unroute(bootstrapPattern);
      }
      await page.locator('select[name=collectionId]').selectOption(secondId);
      await page.getByRole('button', { name: 'Apply to selected', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Collection updated.' }).waitFor();
      for (const id of [firstId, secondId]) {
        await page.goto(`${app.baseUrl}/items?collection=${id}`);
        const questionHref = await page.getByRole('link', {
          name: 'Inherited question',
          exact: true,
        }).getAttribute('href');
        if (!questionHref) expect.unreachable('Expected questionHref');
        expect(new URL(questionHref, app.baseUrl).pathname).toStrictEqual(`/items/${questionId}`);
      }
      await page.goto(`${app.baseUrl}/items?collection=${firstId}`);
      await page.getByRole('link', { name: 'Collections', exact: true }).click();
      await page.getByRole('link', { name: 'Genetics', exact: true }).click();
      await page.getByRole('link', { name: 'Arrange questions', exact: true }).click();
      expect(new URL(page.url()).pathname).toStrictEqual(`/items/collections/${firstId}/arrange`);
      expect(await page.locator('article input[name=questionId]').count()).toStrictEqual(0);
      expect(await page.locator('form.ds-card input[name=q]').count()).toStrictEqual(0);
      const arrangement = page.getByRole('form', { name: 'Arrange questions' });
      const priorOrder = await arrangement.locator('input[name=questionId]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('value'))
      );
      const last = priorOrder[1] === questionId ? 'Inherited question' : 'Second question';
      const move = arrangement.getByRole('button', { name: `Move ${last} up`, exact: true });
      await arrangement.locator('button:not([disabled])').first().waitFor();
      await move.focus();
      await page.keyboard.press('Enter');
      await arrangement.getByRole('status').filter({ hasText: 'position 1' }).waitFor();
      if (!(await move.evaluate((element) => element === document.activeElement))) {
        expect.unreachable(
          'Expected await move.evaluate((element) => element === document.activeElement)',
        );
      }
      expect(await move.getAttribute('aria-disabled')).toStrictEqual('true');
      await page.keyboard.press('Enter');
      expect(
        await arrangement.locator('input[name=questionId]').evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('value'))
        ),
      ).toStrictEqual([...priorOrder].reverse());
      await arrangement.getByRole('button', { name: 'Save order', exact: true }).click();
      await page.getByRole('heading', { name: 'Genetics', exact: true }).waitFor();
      await page.goto(`${app.baseUrl}/items?collection=${firstId}`);
      const newOrder = await page.locator('tbody tr[id^=question-]').evaluateAll((nodes) =>
        nodes.map((node) => node.id.slice('question-'.length))
      );
      expect(newOrder).toStrictEqual([...priorOrder].reverse());
      await page.setViewportSize({ width: 390, height: 844 });
      if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
        expect.unreachable(
          'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
        );
      }
      await page.screenshot({ path: '/tmp/qflow-bank-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: '/tmp/qflow-bank-desktop.png', fullPage: true });
      expect(await db.select().from(questions).where(eq(questions.id, questionId))).toStrictEqual(
        original,
      );
      await db.update(organizationMemberships).set({ role: 'owner' }).where(
        eq(organizationMemberships.userId, userId),
      );
      await page.goto(`${app.baseUrl}/settings/tenant`);
      expect(
        await page.evaluate(async () => {
          const form = new FormData();
          form.set('bankDisplayName', 'Invalid request');
          form.set('unexpected', 'value');
          return (await fetch('/settings/tenant/bank-name', { method: 'POST', body: form })).status;
        }),
      ).toStrictEqual(400);
      await page.getByLabel('Bank display name (optional)').fill('Editorial Biology');
      await page.getByRole('button', { name: 'Save bank name', exact: true }).click();
      await page.getByRole('status').waitFor();
      await page.goto(`${app.baseUrl}/items`);
      await page.getByText('Editorial Biology', { exact: true }).waitFor();
      await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
        eq(organizationMemberships.userId, userId),
      );
      await page.reload();
      expect(
        (await page.request.get(`${app.baseUrl}/items/collections/${firstId}/arrange`)).status(),
      ).toStrictEqual(404);
      expect(
        await page.evaluate(async () => {
          const form = new FormData();
          form.set('bankDisplayName', 'Unauthorized change');
          return (await fetch('/settings/tenant/bank-name', { method: 'POST', body: form })).status;
        }),
      ).toStrictEqual(403);
      await page.getByRole('link', { name: 'Collections', exact: true }).click();
      expect(await page.getByRole('button', { name: 'Create collection' }).count()).toStrictEqual(
        0,
      );
      await page.getByRole('link', { name: 'Questions', exact: true }).click();
      expect(await page.locator('select[name=bulkAction]').count()).toStrictEqual(0);
      await page.getByRole('link', { name: 'Inherited question', exact: true }).waitFor();
      await db.update(organizationMemberships).set({ role: 'instructor' }).where(
        eq(organizationMemberships.userId, userId),
      );
      await page.goto(`${app.baseUrl}/items/${questionId}/edit`);
      await page.locator('[data-qflow-root=ItemEditor][data-qflow-state=ready]').waitFor();
      await page.getByRole('button', { name: 'Details and standards', exact: true }).click();
      await page.getByRole('textbox', { name: /^Title/ }).fill('Corrected question');
      await page.getByRole('button', { name: 'Save item', exact: true }).click();
      await page.waitForURL(`**/items/${questionId}`);
      for (const id of [firstId, secondId]) {
        await page.goto(`${app.baseUrl}/items?collection=${id}`);
        await page.getByRole('link', { name: 'Corrected question', exact: true }).click();
        await page.getByRole('heading', { name: 'Item history', exact: true }).waitFor();
        if (!((await page.getByText('Revision 2', { exact: true }).count()) > 0)) {
          expect.unreachable(
            "Expected (await page.getByText('Revision 2', { exact: true }).count()) > 0",
          );
        }
      }
      await context.close();
    } finally {
      await app?.close();
      await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, tenantId));
      await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
      await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
      await db.update(questions).set({ latestRevisionId: null }).where(
        eq(questions.tenantId, tenantId),
      );
      await db.delete(draftSessions).where(eq(draftSessions.tenantId, tenantId));
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await db.delete(authSessions).where(eq(authSessions.userId, userId));
      await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, userId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await db.delete(users).where(eq(users.id, userId));
      await shutdownDb();
    }
  },
);
