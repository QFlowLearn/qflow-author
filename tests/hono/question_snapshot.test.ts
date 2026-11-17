import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import { authSessions } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import {
  addEnrichmentQuestions,
  withEnrichmentWorkspace,
} from '../helpers/enrichment_workspace.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';
import { encodeRootPayload, parseRootPayload } from '../../lib/client/root_payload.ts';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { playerMessageCatalogForLocale } from '../../lib/i18n/player_messages/catalogs.ts';

it(
  'snapshot preview hydrates one lazy player, scores and resets with native XML download intact',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const [itemId] = await addEnrichmentQuestions(auth, 1);
        await withWorkerHttpSession(auth, 55907, async (app) => {
          const path = `/items/${itemId}/r/1`;
          const head = await app.fetch(path, { method: 'HEAD' });
          expect(head.status).toBe(200);
          expect(await head.text()).toBe('');
          const wrong = await app.fetch(path, { method: 'PUT' });
          expect(wrong.status).toBe(405);
          expect(wrong.headers.get('allow')).toBe('GET, HEAD');
          expect((await app.fetch(`/items/${itemId}/r/0`)).status).toBe(400);
          expect((await app.fetch(`/items/${itemId}/r/999`)).status).toBe(404);
          const browser = await openLocalAppBrowser({
            endpoint: { _tag: 'ExistingApp', baseUrl: app.baseUrl },
            headless: true,
          });
          try {
            const session = await createSession({ userId: auth.userId, tenantId: auth.tenantId });
            const native: import('playwright').BrowserContext = await browser.newContext({
              authSession: session,
              browser: { javaScriptEnabled: false },
            });
            const nativePage = await native.newPage();
            expect((await nativePage.goto(app.baseUrl + path))?.status()).toBe(200);
            expect(
              await nativePage.getByRole('button', { name: 'Check', exact: true }).isDisabled(),
            ).toBe(true);
            expect(
              await nativePage.getByRole('link', { name: 'Download QTI XML', exact: true })
                .getAttribute('download'),
            ).toBe(`item-${itemId}-r1.xml`);
            expect(await nativePage.locator('[data-qflow-root="QtiItemPreview"]').count()).toBe(1);
            await native.close();
            const context: import('playwright').BrowserContext = await browser.newContext({
              authSession: session,
            });
            const page: import('playwright').Page = await context.newPage();
            await page.goto(app.baseUrl + path);
            const preview = page.locator('[data-qflow-root="QtiItemPreview"]');
            await preview.getByText('Preview ready.', { exact: true }).waitFor();
            expect(await preview.getAttribute('data-qflow-state')).toBe('ready');
            expect(await preview.locator('qti-assessment-item-player').count()).toBe(1);
            await preview.getByRole('radio').first().click();
            await preview.getByText('1 response change', { exact: true }).waitFor();
            await preview.getByRole('button', { name: 'Check', exact: true }).click();
            await preview.getByText('Score calculated.', { exact: true }).waitFor();
            await preview.getByRole('button', { name: 'Reset', exact: true }).click();
            await preview.getByText('Preview reset.', { exact: true }).waitFor();
            await preview.getByText('No response changes', { exact: true }).waitFor();
            await assertNoBlockingA11y(page);
          } finally {
            await browser.close();
            await db.delete(authSessions).where(eq(authSessions.userId, auth.userId));
          }
        });
      });
    } finally {
      await shutdownDb();
    }
  },
  60000,
);

it('standalone preview transport preserves its plain JSON data and escapes hostile XML', () => {
  const props = {
    xml: '</script><script>unsafe()</script>\u2028\u2029',
    mode: 'migration',
    payload: createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']),
    playerCatalog: playerMessageCatalogForLocale('en-US'),
  } as const;
  const root = { id: 'qf-preview', component: 'QtiItemPreview', props } as const;
  const encoded = encodeRootPayload(root);
  expect(encoded).not.toContain('</script>');
  expect(encoded).not.toContain('\u2028');
  expect(parseRootPayload(JSON.parse(encoded))).toEqual({ _tag: 'Parsed', value: root });
  const withCallback = { ...props, onScored() {} };
  expect(() => encodeRootPayload({ ...root, props: withCallback })).toThrow();
});
