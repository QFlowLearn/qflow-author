import { expect, it } from 'vitest';
import { db, shutdownDb } from '../../lib/db.ts';
import { withEnrichmentWorkspace } from '../helpers/enrichment_workspace.ts';
import { withOrganizationWorkspace } from '../helpers/organization_workspace.ts';
import { finishOrganizationNotice } from '../helpers/organization_notice_fixture.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';
import { readOrganizationNotices } from '../../lib/services/question_organization_notices.ts';

it('member search preserves its legacy validation envelope before persistence', async () => {
  try {
    await withEnrichmentWorkspace(async (auth) => {
      await withWorkerHttpSession(auth, 55902, async (app) => {
        for (
          const [query, message] of [
            ['q=a', 'Enter 2 to 200 characters.'],
            ['q=Ada&q=Grace', 'Enter one member search.'],
            ['q=Ada&limit=1000', 'Member search contains an unknown option.'],
          ]
        ) {
          const response = await app.fetch('/api/members/search?' + query);
          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({ error: 'invalid_query', message });
        }
      });
    });
  } finally {
    await shutdownDb();
  }
}, 30000);

it(
  'notice HTTP boundary rejects extra fields and malformed JSON and returns uncached acknowledgements',
  async () => {
    try {
      await withOrganizationWorkspace(async (fixture) => {
        await finishOrganizationNotice(fixture.params);
        await withWorkerHttpSession(fixture.ctx, 55903, async (app) => {
          const path = '/api/items/organization-notices';
          const command = { runId: fixture.runId, executionId: fixture.params.workflowExecutionId };
          const read = await app.fetch(path);
          expect(read.headers.get('cache-control')).toBe('no-store');
          expect(await read.json()).toMatchObject({ total: 1 });
          for (const body of ['{', JSON.stringify({ ...command, read: true })]) {
            const response = await app.fetch(path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body,
            });
            expect(response.status).toBe(400);
            await response.body?.cancel();
          }
          const ack = await app.fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(command),
          });
          expect(ack.status).toBe(204);
          expect(ack.headers.get('cache-control')).toBe('no-store');
          const after = await app.fetch(path);
          expect(after.status).toBe(200);
          await after.body?.cancel();
          expect(await readOrganizationNotices(db, fixture.ctx)).toEqual({
            ok: true,
            value: { total: 0, notices: [] },
          });
        });
      }, { difficulty: 'none' });
    } finally {
      await shutdownDb();
    }
  },
  30000,
);
