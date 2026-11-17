import { expect } from 'vitest';
import { builtWorkerBrowserEnvironment } from './built_worker_environment.ts';
import * as _fs from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { authSessions, userSettingsTable } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import type { RequestContext } from '../../lib/tenants.ts';

/** Exercise the real comparison players and owned revision assets using keyboard disclosure controls. */
export async function checkRevisionComparisonBrowser(
  auth: RequestContext,
  questionId: string,
): Promise<void> {
  const directory = `build/client/comparison-${auth.tenantId}`;
  await _fs.mkdir(directory);
  let app: LocalAppBrowser | undefined;
  try {
    for (const revision of [2, 3, 4, 7]) {
      await _fs.writeFile(
        `${directory}/r${revision}.svg`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${
          revision === 2 ? '#1256a0' : '#a03412'
        }"/><text x="10" y="55" fill="white">Diagram ${revision}</text></svg>`,
        'utf8',
      );
    }
    await saveUserSettings(auth.userId, createInitialUserSettings('en-US'));
    app = await openLocalAppBrowser({
      endpoint: {
        _tag: 'ManagedLocalApp',
        isolation: 'fixture',
        portRange: { first: 5188, lastExclusive: 5198 },
        environment: {
          ...builtWorkerBrowserEnvironment,
          DATABASE_URL: process.env['DATABASE_URL']!,
        },
      },
      headless: true,
    });
    const context: import('playwright').BrowserContext = await app.newContext({
      authSession: await createSession(auth),
    });
    const page: import('playwright').Page = await context.newPage();
    page.setDefaultTimeout(20000);
    const assets = new Set<string>();
    page.on('response', (response) => {
      if (response.ok() && response.url().includes(`/comparison-${auth.tenantId}/`)) {
        assets.add(new URL(response.url()).pathname);
      }
    });
    await page.goto(`${app.baseUrl}/items/${questionId}?historyBefore=6`);
    await page.getByRole('spinbutton', { name: 'Earlier revision', exact: true }).fill('2');
    await page.getByRole('spinbutton', { name: 'Later revision', exact: true }).fill('4');
    await page.getByRole('button', { name: 'Compare revisions', exact: true }).click();
    await page.getByRole('heading', { name: 'Revision 2 → Revision 4', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    const comparison = page.locator('#comparison');
    const evidence = comparison.locator('details > summary').filter({ hasText: 'Correct answer' });
    await evidence.focus();
    await page.keyboard.press('Enter');
    await evidence.locator('..').getByText('"B"', { exact: true })
      .waitFor();
    await evidence.locator('..').getByText('"C"', { exact: true })
      .waitFor();
    const previews = comparison.locator('summary').filter({
      hasText: 'Show before and after previews',
    });
    await previews.focus();
    await page.keyboard.press('Enter');
    await comparison.getByRole('img', { name: 'Revision 2', exact: true }).waitFor();
    await comparison.getByRole('img', { name: 'Revision 4', exact: true }).waitFor();
    if (!(assets.has(`/comparison-${auth.tenantId}/r2.svg`))) {
      expect.unreachable('Expected assets.has(`/comparison-${auth.tenantId}/r2.svg`)');
    }
    if (!(assets.has(`/comparison-${auth.tenantId}/r4.svg`))) {
      expect.unreachable('Expected assets.has(`/comparison-${auth.tenantId}/r4.svg`)');
    }
    expect(await comparison.getByRole('img', { name: 'Revision 7', exact: true }).count())
      .toStrictEqual(0);
    await page.screenshot({ path: '/tmp/qflow-step03-comparison.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
      expect.unreachable(
        'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
      );
    }
    expect(new URL(page.url()).searchParams.get('historyBefore')).toStrictEqual('6');
    await page.getByRole('link', { name: 'Latest revisions', exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has('historyBefore'));
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).searchParams.get('compare')).toStrictEqual('2');
    expect(new URL(page.url()).searchParams.get('compareTo')).toStrictEqual('4');
    const historyEntry = page.locator('li').filter({ has: page.locator('#revision-3-heading') });
    const restore = historyEntry.locator('summary').filter({ hasText: 'Restore earlier content' });
    await restore.focus();
    await page.keyboard.press('Enter');
    await historyEntry.getByRole('button', { name: 'Create restored revision', exact: true })
      .click();

    await page.waitForURL((url) => url.searchParams.has('notice') || url.searchParams.has('error'));
    expect(new URL(page.url()).searchParams.get('error'), await page.locator('body').innerText())
      .toStrictEqual(null);
    await page.screenshot({ path: '/tmp/qflow-review-restored.png', fullPage: true });
    await page.locator('#revision-8-heading').waitFor();
    await page.getByText('Restored from revision 3', { exact: true }).waitFor();
    await page.locator('#review > summary').press('Enter');
    const reviewNote = page.locator('#review textarea[name="changeReason"]');
    await reviewNote.waitFor();
    expect(await reviewNote.getAttribute('required')).toStrictEqual(null);
    expect(await reviewNote.getAttribute('maxlength')).toStrictEqual('4000');
    await context.close();
  } finally {
    await app?.close();
    await db.delete(authSessions).where(eq(authSessions.tenantId, auth.tenantId));
    await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, auth.userId));
    await _fs.rm(directory, { recursive: true });
  }
}
