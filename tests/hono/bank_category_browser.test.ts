import { expect, it } from 'vitest';

import { db, shutdownDb } from '../../lib/db.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { BankEnrichmentStore } from '../../lib/services/bank_enrichment_store.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import {
  addEnrichmentQuestions,
  withEnrichmentWorkspace,
} from '../helpers/enrichment_workspace.ts';
import { assignOverviewFixture } from '../helpers/enrichment_overview_fixture.ts';
import { enrichmentDefinitionFixture } from '../bank_enrichment_fixture.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';

it('category selections refresh dependent counts without applying the question list', async () => {
  try {
    await withEnrichmentWorkspace(async (auth) => {
      const ids = await addEnrichmentQuestions(auth, 4);
      const schemeId = crypto.randomUUID(), versionId = crypto.randomUUID();
      const definition = enrichmentDefinitionFixture();
      const saved = await new BankEnrichmentStore(db, () => new Date()).saveVersion(auth, {
        id: versionId,
        schemeId,
        expectedVersion: 0,
        definition: {
          ...definition,
          subjects: definition.subjects.map((subject) => ({
            ...subject,
            label: subject.id === 'life' ? 'Biology' : 'Physics',
          })),
        },
      });
      if (!(saved.ok)) expect.unreachable('Expected saved.ok');
      for (
        const [selected, subject, topic, difficulty] of [
          [ids.slice(0, 2), 'life', 'cells', 'easy'],
          [ids.slice(2, 3), 'physical', 'energy', 'easy'],
          [ids.slice(3), 'physical', 'energy', 'hard'],
        ] as const
      ) {
        await assignOverviewFixture(auth, schemeId, versionId, selected, {
          subject: { state: 'assigned', valueIds: [subject] },
          topic: { state: 'assigned', valueIds: [topic] },
          difficulty: { state: 'assigned', valueIds: [difficulty] },
        });
      }
      await withWorkerHttpSession(auth, 55906, async (owned) => {
        const browser = await openLocalAppBrowser({
          endpoint: { _tag: 'ExistingApp', baseUrl: owned.baseUrl },
          headless: true,
        });
        try {
          const authSession = await createSession({ tenantId: auth.tenantId, userId: auth.userId });
          const context: import('playwright').BrowserContext = await browser.newContext({
            authSession,
          });
          const page: import('playwright').Page = await context.newPage();
          page.setDefaultTimeout(10000);
          const facetQueries: string[] = [];
          page.on('request', (request) => {
            const url = new URL(request.url());
            if (url.pathname === '/api/items/facets') facetQueries.push(url.search);
          });
          await page.goto(owned.baseUrl + '/items');
          await page.waitForFunction(() =>
            document.querySelector('[data-qflow-root="BankCategoryFilters"]')?.getAttribute(
              'data-qflow-state',
            ) === 'ready'
          );
          for (const name of ['Subject', 'Topic', 'Difficulty']) {
            const select = page.getByRole('combobox', { name, exact: true });
            expect(await select.isDisabled()).toStrictEqual(true);
            expect(await select.locator('option').first().textContent()).toStrictEqual(
              'Choose a category set',
            );
          }
          const rows = () => page.locator('[data-qflow-root="BankQuestionTable"] tbody tr').count();
          const subjectValue = `${versionId}:life`;
          await page.getByRole('combobox', { name: 'Category set' }).selectOption(schemeId);
          await page.getByRole('combobox', { name: 'Topic' }).locator('option', {
            hasText: 'Energy (2)',
          }).waitFor({ state: 'attached' });
          expect(await page.getByRole('combobox', { name: 'Subject' }).isEnabled()).toStrictEqual(
            true,
          );
          expect(new URL(page.url()).search).toStrictEqual('');
          expect(await rows()).toStrictEqual(4);
          await page.getByRole('combobox', { name: 'Subject' }).selectOption(subjectValue);
          await page.getByRole('combobox', { name: 'Topic' }).locator('option', {
            hasText: 'Energy (0)',
          }).waitFor({ state: 'attached' });
          expect(
            await page.getByRole('combobox', { name: 'Difficulty' }).locator('option', {
              hasText: 'Easy (2)',
            }).count(),
          ).toStrictEqual(1);
          if (
            !(facetQueries.some((query) =>
              new URLSearchParams(query).get('subject') === subjectValue
            ))
          ) {
            expect.unreachable(
              "Expected facetQueries.some((query) => new URLSearchParams(query).get('subject') === subjectValue )",
            );
          }
          expect(new URL(page.url()).search).toStrictEqual('');
          expect(await rows()).toStrictEqual(4);
          await page.getByRole('combobox', { name: 'Topic' }).selectOption(`${versionId}:cells`);
          await page.getByRole('combobox', { name: 'Subject' }).locator('option', {
            hasText: 'Physics (0)',
          }).waitFor({ state: 'attached' });
          await page.getByRole('combobox', { name: 'Difficulty' }).selectOption(
            `${versionId}:hard`,
          );
          await page.getByRole('combobox', { name: 'Subject' }).locator('option', {
            hasText: 'Biology (0)',
          }).waitFor({ state: 'attached' });
          for (const name of ['Difficulty', 'Topic', 'Subject']) {
            await page.getByRole('combobox', { name }).selectOption('');
          }
          await page.getByRole('combobox', { name: 'Topic' }).locator('option', {
            hasText: 'Energy (2)',
          }).waitFor({ state: 'attached' });
          await page.getByRole('combobox', { name: 'Subject' }).selectOption(subjectValue);
          await page.getByRole('combobox', { name: 'Topic' }).locator('option', {
            hasText: 'Energy (0)',
          }).waitFor({ state: 'attached' });
          await page.getByRole('button', { name: 'Apply filters', exact: true }).press('Enter');
          await page.waitForURL((url) => url.searchParams.get('subject') === subjectValue);
          expect(await rows()).toStrictEqual(2);
          await page.getByRole('combobox', { name: 'Category set' }).selectOption('');
          expect(await page.getByRole('combobox', { name: 'Subject' }).isDisabled()).toStrictEqual(
            true,
          );
          await page.getByText('Choose a category set to enable Subject, Topic, and Difficulty.')
            .waitFor();
          await context.close();
          const noJs: import('playwright').BrowserContext = await browser.newContext({
            authSession,
            browser: { javaScriptEnabled: false },
          });
          const staticPage = await noJs.newPage();
          staticPage.setDefaultTimeout(10000);
          await staticPage.goto(owned.baseUrl + '/items');
          await staticPage.getByRole('combobox', { name: 'Category set' }).selectOption(schemeId);
          expect(await staticPage.getByRole('combobox', { name: 'Subject' }).isDisabled())
            .toStrictEqual(true);
          await staticPage.getByRole('button', { name: 'Apply filters', exact: true }).press(
            'Enter',
          );
          await staticPage.waitForURL((url) => url.searchParams.get('scheme') === schemeId);
          expect(await staticPage.getByRole('combobox', { name: 'Subject' }).isEnabled())
            .toStrictEqual(true);
          await staticPage.getByRole('combobox', { name: 'Subject' }).selectOption(subjectValue);
          await staticPage.getByRole('button', { name: 'Apply filters', exact: true }).press(
            'Enter',
          );
          await staticPage.waitForURL((url) => url.searchParams.get('subject') === subjectValue);
          expect(await staticPage.locator('[data-qflow-root="BankQuestionTable"] tbody tr').count())
            .toStrictEqual(2);
          await noJs.close();
        } finally {
          await browser.close();
        }
      });
    });
  } finally {
    await shutdownDb();
  }
}, 60000);
