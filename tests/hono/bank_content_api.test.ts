import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import {
  authSessions,
  draftSessions,
  editorialEvents,
  uploadsTable,
  userSettingsTable,
} from '../../lib/db/schema.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { createDraftSessionId } from '../../lib/draft_session_id.ts';
import { createBankDraft } from '../../lib/services/bank_drafts.ts';
import { getDraftSession, openLatestRevisionDraftSession } from '../../lib/services/drafts.ts';
import { withEnrichmentWorkspace } from '../helpers/enrichment_workspace.ts';
import { withWorkerHttpSession } from '../helpers/worker_http_fixture.ts';

it(
  'built Worker persists bank draft edits, publishes/retries and exposes revision read/validation contracts',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const id = createDraftSessionId();
        expect(await createBankDraft(auth, { id, collectionId: null, type: 'single_select' }))
          .toEqual({ ok: true, id });
        try {
          await withWorkerHttpSession(auth, 55925, async (app) => {
            const path = '/api/drafts/' + id;
            const request = (path: string, body: unknown, method = 'POST') =>
              app.fetch(path, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              });
            const read = await app.fetch(path);
            expect(read.status).toBe(200);
            expect(await read.json()).toMatchObject({ id, binding: { _tag: 'Bank' } });
            const unsupported = await app.fetch(path, { method: 'PATCH' });
            expect(unsupported.status).toBe(405);
            expect(unsupported.headers.get('allow')).toBe('GET, PUT, DELETE');
            await unsupported.body?.cancel();
            const invalid = await request(path, { type: 'untrusted-type' }, 'PUT');
            expect(invalid.status).toBe(400);
            expect(await invalid.json()).toMatchObject({ error: 'invalid_draft' });
            const session = await getDraftSession(auth, id);
            if (!session) throw new Error('Expected isolated working draft.');
            const draft = { ...session.draft, title: 'API bank question' };
            const saved = await request(path, draft, 'PUT');
            expect(saved.status).toBe(200);
            expect(await saved.json()).toEqual({ ok: true });
            expect((await getDraftSession(auth, id))?.draft.title).toBe(draft.title);
            const published = await request(path + '/create-question', { draft });
            expect(published.status).toBe(201);
            const result: unknown = await published.json();
            if (!result || typeof result !== 'object') {
              throw new Error('Expected publication receipt.');
            }
            const itemId: unknown = Reflect.get(result, 'itemId');
            if (typeof itemId !== 'string') {
              throw new Error('Expected published question identity.');
            }
            const repeated = await request(path + '/create-question', { draft });
            expect(repeated.status).toBe(201);
            expect(await repeated.json()).toEqual(result);
            const conflicting = await request(path + '/create-question', {
              draft: { ...draft, title: 'Changed retry' },
            });
            expect(conflicting.status).toBe(409);
            await conflicting.body?.cancel();
            for (const method of ['GET', 'POST']) {
              const snapshot = await app.fetch('/api/items/' + itemId, { method });
              expect(snapshot.status).toBe(200);
              expect(await snapshot.json()).toMatchObject({ id: itemId, title: draft.title });
            }
            const meta = await app.fetch('/api/items/' + itemId + '/meta');
            expect(meta.status).toBe(200);
            expect(await meta.json()).toMatchObject({ latestRevision: 1 });
            const metaHead = await app.fetch('/api/items/' + itemId + '/meta', { method: 'HEAD' });
            expect(metaHead.status).toBe(405);
            expect(metaHead.headers.get('allow')).toBe('GET');
            const validation = await app.fetch('/api/items/' + itemId + '/validate');
            expect(validation.status).toBe(200);
            expect(await validation.json()).toMatchObject({ ok: true });
            const edit = await openLatestRevisionDraftSession(auth, itemId);
            if (!edit.ok) throw new Error('Expected latest revision working draft.');
            const revised = await request('/api/drafts/' + edit.session.id + '/publish', {
              sourceRevisionId: edit.sourceRevisionId,
              draft: { ...edit.session.draft, itemId, title: 'API revised bank question' },
            });
            expect(revised.status).toBe(201);
            expect(await revised.json()).toMatchObject({ itemId });
            const latest = await app.fetch('/api/items/' + itemId + '/latest');
            expect(latest.status).toBe(200);
            expect(await latest.json()).toMatchObject({
              id: itemId,
              latestRev: 2,
              title: 'API revised bank question',
            });
            const temporary = createDraftSessionId();
            expect(
              (await createBankDraft(auth, {
                id: temporary,
                collectionId: null,
                type: 'single_select',
              })).ok,
            ).toBe(true);
            const removed = await app.fetch('/api/drafts/' + temporary, { method: 'DELETE' });
            expect(removed.status).toBe(204);
            const missing = await app.fetch('/api/drafts/' + temporary);
            expect(missing.status).toBe(404);
            await missing.body?.cancel();
            for (
              const [endpoint, status] of [['/api/source-intake/inspect', 415], [
                '/api/source-intake/execute',
                400,
              ]] as const
            ) {
              const malformed = await request(endpoint, {});
              expect(malformed.status).toBe(status);
              await malformed.body?.cancel();
            }
            const form = new FormData();
            form.set('destination', 'Assessment');
            form.set('purpose', 'generate_new');
            form.set('text', 'Plate tectonics explains the movement of continents.');
            const inspection = await app.fetch('/api/source-intake/inspect', {
              method: 'POST',
              body: form,
            });
            expect(inspection.status).toBe(200);
            expect(await inspection.json()).toMatchObject({
              purpose: 'generate_new',
              inspections: [{
                _tag: 'resolved',
                candidate: { adapter: { id: 'pasted-text', version: '1' } },
              }],
            });
          });
        } finally {
          await db.delete(draftSessions).where(eq(draftSessions.tenantId, auth.tenantId));
          await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, auth.tenantId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
  45000,
);

it(
  'built Worker streams persisted R2 uploads with private headers, HEAD and missing-object responses',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        try {
          await withWorkerHttpSession(auth, 55926, async (app) => {
            const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            const form = new FormData();
            form.set('file', new File([bytes], 'sample.png', { type: 'image/png' }));
            const saved = await app.fetch('/api/uploads', { method: 'POST', body: form });
            expect(saved.status).toBe(201);
            const payload: unknown = await saved.json();
            if (!payload || typeof payload !== 'object') {
              throw new Error('Expected upload receipt.');
            }
            const url: unknown = Reflect.get(payload, 'url');
            if (typeof url !== 'string' || !url.startsWith('/uploads/')) {
              throw new Error('Expected local upload URL.');
            }
            const response = await app.fetch(url);
            expect(response.status).toBe(200);
            expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
            expect(response.headers.get('content-type')).toBe('image/png');
            expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
            expect(response.headers.get('content-security-policy')).toContain("script-src 'none'");
            expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
            const head = await app.fetch(url, { method: 'HEAD' });
            expect(head.status).toBe(200);
            expect(head.headers.get('content-length')).toBe(String(bytes.byteLength));
            expect(await head.text()).toBe('');
            await withEnrichmentWorkspace(async (other) => {
              await saveUserSettings(other.userId, createInitialUserSettings('en-US'));
              const session = await createSession({
                userId: other.userId,
                tenantId: other.tenantId,
              });
              try {
                const denied = await fetch(app.baseUrl + url, {
                  headers: { cookie: `qflow_session=${encodeURIComponent(session.token)}` },
                  redirect: 'manual',
                });
                expect(denied.status).toBe(403);
                await denied.body?.cancel();
              } finally {
                await db.delete(authSessions).where(eq(authSessions.userId, other.userId));
                await db.delete(userSettingsTable).where(
                  eq(userSettingsTable.userId, other.userId),
                );
              }
            });
            const unknown = await app.fetch('/uploads/' + crypto.randomUUID());
            expect(unknown.status).toBe(404);
            await unknown.body?.cancel();
            const bad = await app.fetch('/api/uploads', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            });
            expect(bad.status).toBe(415);
            await bad.body?.cancel();
          });
        } finally {
          await db.delete(uploadsTable).where(eq(uploadsTable.tenantId, auth.tenantId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
  30000,
);
