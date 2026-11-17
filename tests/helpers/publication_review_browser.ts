import { expect } from 'vitest';
import { builtWorkerBrowserEnvironment } from './built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { authSessions, userSettingsTable } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import type { RequestContext } from '../../lib/tenants.ts';

/** Real membership grant controls and exact-review links, using the test database. */
export async function checkPublicationReviewBrowser(
  auth: RequestContext,
  questionId: string,
): Promise<void> {
  await saveUserSettings(auth.userId, createInitialUserSettings('en-US'));
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Browser test database is required.');
  const app = await openLocalAppBrowser({
    endpoint: {
      _tag: 'ManagedLocalApp',
      portRange: { first: 5188, lastExclusive: 5198 },
      environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
    },
    headless: true,
  });
  try {
    const context: import('playwright').BrowserContext = await app.newContext({
      authSession: await createSession(auth),
    });
    const page: import('playwright').Page = await context.newPage();
    await page.goto(app.baseUrl + '/settings/members');
    const row = page.getByRole('row').filter({ hasText: auth.userId + '@example.test' });
    await row.getByRole('button', { name: 'Grant', exact: true }).click();
    await row.getByRole('button', { name: 'Revoke', exact: true }).waitFor();
    await row.getByRole('button', { name: 'Revoke', exact: true }).click();
    await row.getByRole('button', { name: 'Grant', exact: true }).waitFor();
    expect(new URL(page.url()).pathname).toStrictEqual('/settings/members');
    for (
      const [data, status] of [
        [{ action: 'grant', userId: 'invalid' }, 400],
        [{ action: 'grant', userId: crypto.randomUUID() }, 404],
        [{ action: 'grant', userId: auth.userId, extra: 'unexpected' }, 400],
      ] as const
    ) {
      const response = await context.request.post(app.baseUrl + '/settings/publication-grants', {
        form: data,
        headers: { origin: app.baseUrl },
      });
      expect(response.status()).toStrictEqual(status);
    }
    await page.goto(app.baseUrl + '/items/reviews?view=closed');
    const navigation = page.waitForResponse((response) =>
      response.request().isNavigationRequest() &&
      new URL(response.url()).pathname === '/items/' + questionId
    );
    await page.getByRole('link', { name: 'Owned review item · Revision 1', exact: true }).click();
    const loaded = await navigation;
    expect(loaded.status()).toStrictEqual(200);
    await page.screenshot({ path: '/tmp/qflow-step04-self-review.png', fullPage: true });
    await page.getByText('Self-review', { exact: true }).waitFor();
    expect(new URL(page.url()).pathname).toStrictEqual('/items/' + questionId);
    await page.screenshot({ path: '/tmp/qflow-step04-self-review.png', fullPage: true });
    await page.waitForLoadState('networkidle');
    await context.close();
  } finally {
    await app.close();
    await db.delete(authSessions).where(eq(authSessions.tenantId, auth.tenantId));
    await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, auth.userId));
  }
}
