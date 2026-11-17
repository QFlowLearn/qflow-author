import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { authSessions } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { getMigrationRun } from '../../lib/import/migration_run_queries.ts';
import { withAssessmentReviewSource } from '../helpers/bank_review_import.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';

it(
  'assessment import plan hydrates, saves through its shared API and transports saved coverage',
  async () => {
    try {
      await withAssessmentReviewSource(
        {
          filename: 'planned.txt',
          mime: 'text/plain',
          bytes: new TextEncoder().encode('1. Choose a city in France.\n*a. Paris\nb. Berlin\n'),
        },
        'respondus-standard',
        'recover_existing',
        async (auth, runId) => {
          await withWorkerHttpSession(auth, 55910, async (app) => {
            const browser = await openLocalAppBrowser({
              endpoint: { _tag: 'ExistingApp', baseUrl: app.baseUrl },
              headless: true,
            });
            try {
              const session = await createSession({ tenantId: auth.tenantId, userId: auth.userId });
              const native: import('playwright').BrowserContext = await browser.newContext({
                authSession: session,
                browser: { javaScriptEnabled: false },
              });
              const nativePage = await native.newPage();
              await nativePage.goto(`${app.baseUrl}/imports/${runId}`);
              const nativePlan = nativePage.locator('[data-qflow-root="BlueprintPanel"]');
              await nativePlan.evaluate((root) =>
                root.closest('details')?.setAttribute('open', '')
              );
              expect(
                await nativePlan.getByRole('button', { name: 'Save plan', exact: true })
                  .isDisabled(),
              ).toBe(true);
              await native.close();
              const context: import('playwright').BrowserContext = await browser.newContext({
                authSession: session,
              });
              const page: import('playwright').Page = await context.newPage();
              page.setDefaultTimeout(15000);
              await page.goto(`${app.baseUrl}/imports/${runId}`);
              const plan = page.locator('[data-qflow-root="BlueprintPanel"]');
              await plan.evaluate((root) => root.closest('details')?.setAttribute('open', ''));
              await plan.getByRole('textbox', { name: 'Outcome', exact: true }).fill(
                'Identify a French city',
              );
              const [saved] = await Promise.all([
                page.waitForResponse((response) =>
                  response.url().endsWith(`/api/imports/${runId}/blueprint`)
                ),
                page.waitForEvent('load'),
                plan.getByRole('button', { name: 'Save plan', exact: true }).click(),
              ]);
              expect(saved.status()).toBe(200);
              await page.waitForFunction(() =>
                document.querySelector('[data-qflow-root="BlueprintPanel"]')?.getAttribute(
                    'data-qflow-state',
                  ) === 'ready' &&
                document.querySelector('[data-qflow-root="BlueprintPanel"]')?.textContent?.includes(
                  'Identify a French city',
                )
              );
              const record = await getMigrationRun(auth, runId);
              expect(record?.destination._tag).toBe('Assessment');
              if (
                record?.destination._tag !== 'Assessment' ||
                record.destination.blueprint._tag !== 'Defined'
              ) throw new Error('Saved plan is missing.');
              expect(record.destination.blueprint.outcomes[0]?.title).toBe(
                'Identify a French city',
              );
              await plan.evaluate((root) => root.closest('details')?.setAttribute('open', ''));
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

it(
  'generation source keeps JavaScript actions gated and edits its single blueprint tree without calling a provider',
  async () => {
    try {
      await withAssessmentReviewSource(
        {
          filename: 'generation-notes.txt',
          mime: 'text/plain',
          bytes: new TextEncoder().encode(
            'Photosynthesis converts light into chemical energy. Leaves contain chloroplasts.\n',
          ),
        },
        'pasted-text',
        'generate_new',
        async (auth, runId) => {
          await withWorkerHttpSession(auth, 55911, async (app) => {
            const browser = await openLocalAppBrowser({
              endpoint: { _tag: 'ExistingApp', baseUrl: app.baseUrl },
              headless: true,
            });
            try {
              const session = await createSession({ tenantId: auth.tenantId, userId: auth.userId });
              const native: import('playwright').BrowserContext = await browser.newContext({
                authSession: session,
                browser: { javaScriptEnabled: false },
              });
              const nativePage = await native.newPage();
              await nativePage.goto(`${app.baseUrl}/imports/${runId}`);
              expect(
                await nativePage.getByRole('button', { name: 'Generate questions', exact: true })
                  .isDisabled(),
              ).toBe(true);
              await native.close();
              const context: import('playwright').BrowserContext = await browser.newContext({
                authSession: session,
              });
              const page: import('playwright').Page = await context.newPage();
              const providerRequests: string[] = [];
              page.on('request', (request) => {
                if (new URL(request.url()).pathname.endsWith('/generate')) {
                  providerRequests.push(request.method());
                }
              });
              await page.goto(`${app.baseUrl}/imports/${runId}`);
              const generation = page.locator('[data-qflow-root="ConversionGeneration"]');
              await generation.getByRole('textbox', { name: 'Outcome', exact: true }).fill(
                'Explain photosynthesis',
              );
              await generation.getByRole('button', { name: 'Add outcome', exact: true }).click();
              expect(
                await generation.getByRole('textbox', { name: 'Outcome', exact: true }).count(),
              ).toBe(2);
              expect(await generation.locator('[data-qflow-root]').count()).toBe(0);
              expect(providerRequests).toEqual([]);
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
