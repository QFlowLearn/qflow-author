import { chromium } from 'playwright';
import { startFetchServer } from '../helpers/fetch_server.ts';
import { expect, it } from 'vitest';
import { shutdownDb } from '../../lib/db.ts';
import { artifactImportRoute } from '../../lib/http/routes/import_api/artifact.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import { getMigrationRun } from '../../lib/import/migration_run_queries.ts';
import { createMemoryObjectStorage } from '../memory_object_storage.ts';
import { withBankReviewSource } from '../helpers/bank_review_import.ts';
import { withEnrichmentWorkspace } from '../helpers/enrichment_workspace.ts';
import type { HttpRequest } from '../../lib/http/route.ts';
import type { RequestContext } from '../../lib/tenants.ts';

it(
  'artifact route preserves source bytes and Unicode download headers with tenant isolation',
  async () => {
    const bytes = new TextEncoder().encode('1. Which city is in France?\n*a. Paris\nb. Berlin\n');
    try {
      await withBankReviewSource(
        { filename: 'notes "Ω".txt', mime: 'text/plain', bytes },
        'respondus-standard',
        async (auth, runId) => {
          const record = await getMigrationRun(auth, runId);
          const artifact = record?.artifacts.find((entry) => entry.kind === 'original');
          if (!artifact) throw new Error('Expected staged source artifact.');
          const storage = createMemoryObjectStorage();
          await storage.putObject({
            key: artifact.storageKey,
            data: bytes,
            contentType: artifact.mimeType,
          });
          const catalog = catalogForLocale('en-US');
          function request(actor: RequestContext, artifactId = artifact?.id): HttpRequest {
            const url = new URL(`https://fixture.example/imports/${runId}/artifacts/${artifactId}`);
            const runtime = { state: { storage } };
            const state = {
              runtime,
              auth: actor,
              interfaceLocale: 'en-US' as const,
              catalog,
              i18n: createI18n('en-US', catalog),
              storage,
            };
            return {
              req: new Request(url),
              url,
              params: { id: runId, artifactId: artifactId ?? '' },
              state,
              runtime,
              clientIp: null,
              render() {
                throw new Error('Binary artifacts must not render a page.');
              },
            };
          }
          const response = await artifactImportRoute.handle(request(auth));
          expect(response.status).toBe(200);
          expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
          expect(response.headers.get('content-type')).toBe('text/plain');
          expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
          expect(response.headers.get('x-content-type-options')).toBe('nosniff');
          expect(response.headers.get('content-disposition')).toContain('attachment;');
          expect(response.headers.get('content-disposition')).toContain('%CE%A9');
          const http = await startFetchServer((req) =>
            new URL(req.url).pathname === '/file'
              ? artifactImportRoute.handle({ ...request(auth), req, url: new URL(req.url) })
              : new Response(
                '<!doctype html><html><body><a href="/file">Download source</a></body></html>',
                { headers: { 'content-type': 'text/html' } },
              )
          );
          let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
          try {
            browser = await chromium.launch();
            const page: import('playwright').Page = await browser.newPage();
            page.setDefaultTimeout(10000);
            await page.goto(http.origin);
            const [download] = await Promise.all([
              page.waitForEvent('download'),
              page.getByRole('link', { name: 'Download source' }).click(),
            ]);
            expect(download.suggestedFilename()).toBe('notes _Ω_.txt');
          } finally {
            await browser?.close();
            await http.close();
          }

          expect((await artifactImportRoute.handle(request(auth, crypto.randomUUID()))).status)
            .toBe(
              404,
            );
          await withEnrichmentWorkspace(async (foreign) => {
            expect((await artifactImportRoute.handle(request(foreign))).status).toBe(404);
          });
        },
      );
    } finally {
      await shutdownDb();
    }
  },
  30000,
);
