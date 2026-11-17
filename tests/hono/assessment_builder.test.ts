import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { authSessions } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { deleteAssessment, getAssessment } from '../../lib/services/assessment_records.ts';
import { withEnrichmentWorkspace } from '../helpers/enrichment_workspace.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import { isCanonicalUuid } from '../../lib/uuid.ts';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';
import { parseRootPayload } from '../../lib/client/root_payload.ts';

it(
  'built authoring creates a real question and retains its single owning root after reload',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        let assessmentId: string | undefined;
        try {
          await withWorkerHttpSession(auth, 55908, async (app) => {
            const created = await app.fetch('/api/assessments', {
              method: 'POST',
              signal: AbortSignal.timeout(15000),
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ title: 'Worker authoring pilot' }),
            });
            expect(created.status).toBe(201);
            const body: unknown = await created.json();
            if (
              !body || typeof body !== 'object' || !('id' in body) || !isCanonicalUuid(body.id)
            ) throw new Error('Invalid assessment acknowledgement.');
            assessmentId = body.id;
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
              expect((await page.goto(`${app.baseUrl}/assessments/${assessmentId}`))?.status())
                .toBe(200);
              await page.waitForFunction(() =>
                document.querySelector('[data-qflow-root="AssessmentBuilder"]')?.getAttribute(
                  'data-qflow-state',
                ) === 'ready'
              );
              expect(
                await page.locator('[data-qflow-root="AssessmentBuilder"] [data-qflow-root]')
                  .count(),
              ).toBe(
                0,
              );
              const transport: unknown = JSON.parse(
                await page.locator(
                  '[data-qflow-root="AssessmentBuilder"] + script[data-qflow-payload-for]',
                )
                  .textContent() ?? 'null',
              );
              expect(parseRootPayload(transport)._tag).toBe('Parsed');
              const add = page.getByRole('button', { name: 'Add question', exact: true });
              await add.focus();
              await page.keyboard.press('Enter');
              const picker = page.getByRole('region', { name: 'Insert question', exact: true });
              await picker.getByRole('button', { name: /^Single select/ }).click();
              await page.getByPlaceholder('Choice A').waitFor();
              await page.locator('[contenteditable="true"]').first().fill(
                'Which city is in France?',
              );
              await page.getByPlaceholder('Choice A').fill('Paris');
              await page.getByPlaceholder('Choice B').fill('Berlin');
              await page.getByRole('radio').first().check();
              const [saved] = await Promise.all([
                page.waitForResponse((response) =>
                  response.url().endsWith(`/api/assessments/${assessmentId}/questions`) &&
                  response.request().method() === 'POST'
                ),
                page.getByRole('button', { name: 'Save item', exact: true }).click(),
              ]);
              expect(saved.status()).toBe(201);
              const record = await getAssessment(auth, assessmentId);
              expect(record?.parts.flatMap((part) => part.placements)).toHaveLength(1);
              await page.reload();
              await page.waitForFunction(() =>
                document.querySelector('[data-qflow-root="AssessmentBuilder"]')?.getAttribute(
                  'data-qflow-state',
                ) === 'ready'
              );
              await page.getByRole('button', { name: /Edit question 1.1:/ }).waitFor();
              expect(await page.locator('[data-qflow-root="AssessmentBuilder"]').innerText())
                .toContain('Paris');
              await assertNoBlockingA11y(page);
              const placement = record?.parts[0]?.placements[0];
              if (!placement || !('itemId' in placement)) {
                throw new Error('Expected one saved question placement.');
              }
              const removalId = crypto.randomUUID();
              const removed = await app.fetch(
                `/api/assessments/${assessmentId}/placements/${placement.id}`,
                {
                  method: 'DELETE',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ removalId, expectedRevision: 1 }),
                },
              );
              expect(removed.status).toBe(200);
              await page.reload();
              await page.waitForFunction(() =>
                document.querySelector('[data-qflow-root="AssessmentBuilder"]')?.getAttribute(
                  'data-qflow-state',
                ) === 'ready'
              );
              const [restored] = await Promise.all([
                page.waitForResponse((response) =>
                  response.url().endsWith(
                    `/api/assessments/${assessmentId}/removals/${removalId}`,
                  ) && response.request().method() === 'POST'
                ),
                page.getByRole('button', { name: 'Undo removal', exact: true }).click(),
              ]);
              expect(restored.status()).toBe(200);
              expect(
                (await getAssessment(auth, assessmentId))?.parts.flatMap((part) => part.placements),
              ).toHaveLength(1);
              await page.getByRole('button', { name: /Edit question 1.1:/ }).waitFor();

              const head = await app.fetch(`/assessments/${assessmentId}`, { method: 'HEAD' });
              expect(head.status).toBe(200);
              expect(await head.text()).toBe('');
              expect(head.headers.get('cache-control')).toBe('private, no-store');
              const wrong = await app.fetch(`/assessments/${assessmentId}`, { method: 'PUT' });
              expect(wrong.status).toBe(405);
              expect(wrong.headers.get('allow')).toBe('GET, HEAD');
              const defaultsMethod = await app.fetch(
                `/api/assessments/${assessmentId}/question-defaults`,
                { method: 'PUT' },
              );
              expect(defaultsMethod.status).toBe(405);
              expect(defaultsMethod.headers.get('allow')).toBe('GET, PATCH');
              expect(defaultsMethod.headers.get('cache-control')).toBe('private, no-store');
            } finally {
              await browser.close();
              await db.delete(authSessions).where(eq(authSessions.userId, auth.userId));
            }
          });
        } finally {
          if (assessmentId) {
            expect((await deleteAssessment(auth, assessmentId))._tag).toBe('Deleted');
          }
        }
      });
    } finally {
      await shutdownDb();
    }
  },
  90000,
);
