import { expect, it } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { organizationMemberships, users } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import {
  addEnrichmentQuestions,
  withEnrichmentWorkspace,
} from '../helpers/enrichment_workspace.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';

it('optional bank columns toggle independently and keep headers aligned with cells', async () => {
  try {
    await withEnrichmentWorkspace(async (auth) => {
      await addEnrichmentQuestions(auth, 1);
      await db.update(users).set({ displayName: 'Ada Author' }).where(eq(users.id, auth.userId));
      await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
        eq(organizationMemberships.userId, auth.userId),
      );
      await withWorkerHttpSession(auth, 55905, async (owned) => {
        const browser = await openLocalAppBrowser({
          endpoint: { _tag: 'ExistingApp', baseUrl: owned.baseUrl },
          headless: true,
        });
        try {
          const context: import('playwright').BrowserContext = await browser.newContext({
            authSession: await createSession({ tenantId: auth.tenantId, userId: auth.userId }),
          });
          const page: import('playwright').Page = await context.newPage();
          page.setDefaultTimeout(10000);
          await page.goto(owned.baseUrl + '/items');
          await page.waitForFunction(() =>
            document.querySelector('[data-qflow-root="BankQuestionTable"]')?.getAttribute(
              'data-qflow-state',
            ) ===
              'ready'
          );
          await assertNoBlockingA11y(page);
          await page.locator('[data-qflow-root="BankQuestionTable"] details').evaluate((details) =>
            details.setAttribute('open', '')
          );
          const choices = page.locator('[data-qflow-root="BankQuestionTable"] details label');
          expect(await choices.count()).toStrictEqual(3);
          const headings = async () =>
            (await page.locator('table thead th').allTextContents()).map((value) =>
              value.replace(/[↕↑↓]/g, '')
            );
          const cells = () => page.locator('table tbody tr:first-child td').allTextContents();
          const assertAligned = async () =>
            expect(await page.locator('table thead th').count()).toStrictEqual(
              await page.locator('table tbody tr:first-child td').count(),
            );
          expect(await headings()).toStrictEqual(['Question', 'Review status', 'Type', 'Updated']);
          await assertAligned();
          await page.getByRole('checkbox', { name: 'Owner' }).check();
          expect(await headings()).toStrictEqual([
            'Question',
            'Review status',
            'Type',
            'Owner',
            'Updated',
          ]);
          await assertAligned();
          if (!((await cells()).includes('Ada Author'))) {
            expect.unreachable("Expected (await cells()).includes('Ada Author')");
          }
          await page.getByRole('checkbox', { name: 'Revision' }).check();
          expect(await headings()).toStrictEqual([
            'Question',
            'Review status',
            'Type',
            'Owner',
            'Revision',
            'Updated',
          ]);
          await assertAligned();
          if (!((await cells()).includes('1'))) {
            expect.unreachable("Expected (await cells()).includes('1')");
          }
          await page.getByRole('checkbox', { name: 'Source' }).check();
          expect(await headings()).toStrictEqual([
            'Question',
            'Review status',
            'Type',
            'Source',
            'Owner',
            'Revision',
            'Updated',
          ]);
          await assertAligned();
          for (const width of [1200, 800]) {
            await page.setViewportSize({ width, height: 800 });
            const headers = await page.locator('table thead th a').evaluateAll((links) =>
              links.map((link) => {
                const [label, arrow] = Array.from(link.children);
                const labelBox = label.getBoundingClientRect();
                const arrowBox = arrow.getBoundingClientRect();
                return {
                  labelTop: labelBox.top,
                  arrowTop: arrowBox.top,
                  arrowLeft: arrowBox.left,
                  labelRight: labelBox.right,
                };
              })
            );
            for (const header of headers) {
              if (!(Math.abs(header.labelTop - header.arrowTop) < 2)) {
                expect.unreachable('Expected Math.abs(header.labelTop - header.arrowTop) < 2');
              }
              if (!(header.arrowLeft >= header.labelRight)) {
                expect.unreachable('Expected header.arrowLeft >= header.labelRight');
              }
            }
            if (
              !(Math.max(...headers.map((header) => header.labelTop)) -
                  Math.min(...headers.map((header) => header.labelTop)) < 2)
            ) {
              expect.unreachable(
                'Expected Math.max(...headers.map((header) => header.labelTop)) - Math.min(...headers.map((header) =',
              );
            }
          }
          await page.getByRole('checkbox', { name: 'Owner' }).uncheck();
          expect(await headings()).toStrictEqual([
            'Question',
            'Review status',
            'Type',
            'Source',
            'Revision',
            'Updated',
          ]);
          await assertAligned();
          expect(await page.getByRole('checkbox', { name: 'Source' }).isChecked()).toStrictEqual(
            true,
          );
          expect(await page.getByRole('checkbox', { name: 'Revision' }).isChecked()).toStrictEqual(
            true,
          );
          expect((await cells()).includes('Ada Author')).toStrictEqual(false);
        } finally {
          await browser.close();
        }
      });
    });
  } finally {
    await shutdownDb();
  }
}, 45000);
