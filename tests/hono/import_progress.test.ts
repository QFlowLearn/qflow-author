import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { authSessions } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { withQueuedBankReviewSource } from '../helpers/bank_review_import.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';

it(
  'queued import progress polls its negotiated state and reloads after deterministic analysis',
  async () => {
    try {
      await withQueuedBankReviewSource(
        {
          filename: 'queued-review.txt',
          mime: 'text/plain',
          bytes: new TextEncoder().encode('1. Which answer is correct?\n*a. Yes\nb. No\n'),
        },
        'respondus-standard',
        async (auth, runId, analyze) => {
          await withWorkerHttpSession(auth, 55909, async (app) => {
            const browser = await openLocalAppBrowser({
              endpoint: { _tag: 'ExistingApp', baseUrl: app.baseUrl },
              headless: true,
            });
            try {
              const session = await createSession({ tenantId: auth.tenantId, userId: auth.userId });
              const context: import('playwright').BrowserContext = await browser.newContext({
                authSession: session,
              });
              const page: import('playwright').Page = await context.newPage();
              page.setDefaultTimeout(15000);
              await page.goto(`${app.baseUrl}/imports/${runId}`);
              const progress = page.locator(`[data-qflow-root="ImportProgress"]`);
              await page.waitForFunction(() =>
                document.querySelector('[data-qflow-root="ImportProgress"]')?.getAttribute(
                  'data-qflow-state',
                ) === 'ready'
              );
              expect(await progress.count()).toBe(1);
              expect(await progress.locator('[data-qflow-root]').count()).toBe(0);
              const poll = await page.waitForResponse((response) =>
                response.url().endsWith(`/imports/${runId}`) &&
                response.request().headers()['accept'] === 'application/json'
              );
              expect(poll.status()).toBe(200);
              expect(await poll.json()).toEqual({ state: 'Queued' });
              expect(poll.headers()['cache-control']).toBe('no-store');
              expect(poll.headers()['vary']).toContain('Accept');
              const [reloaded] = await Promise.all([
                page.waitForResponse((response) =>
                  response.url().endsWith(`/imports/${runId}`) &&
                  response.request().resourceType() === 'document'
                ),
                analyze(),
              ]);
              expect(reloaded.status()).toBe(200);
              await progress.waitFor({ state: 'detached' });
              expect(await page.locator('article[id^="item-"]').count()).toBe(1);
              await assertNoBlockingA11y(page);
            } finally {
              await browser.close();
              await db.delete(authSessions).where(eq(authSessions.userId, auth.userId));
            }
          });
        },
      );
    } finally {
      await shutdownDb();
    }
  },
  60000,
);
