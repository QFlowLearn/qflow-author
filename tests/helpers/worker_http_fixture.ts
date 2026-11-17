import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { authSessions, userSettingsTable } from '../../lib/db/schema.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { type BuiltAppServer, startBuiltAppServer } from '../../tools/built_app_server.ts';
import { builtWorkerBrowserEnvironment } from './built_worker_environment.ts';
import { requireQaDatabaseUrl } from './qa_database.ts';

/** Own a built Worker, preferences and session for a caller-owned, newly created tenant fixture. */
export async function withWorkerHttpSession(
  auth: RequestContext,
  port: number,
  run: (
    app: { readonly baseUrl: string; fetch(path: string, init?: RequestInit): Promise<Response> },
  ) => Promise<void>,
): Promise<void> {
  const databaseUrl = requireQaDatabaseUrl(process.env.DATABASE_URL);
  let app: BuiltAppServer | undefined;
  try {
    await saveUserSettings(auth.userId, createInitialUserSettings('en-US'));
    const session = await createSession({ userId: auth.userId, tenantId: auth.tenantId });
    app = await startBuiltAppServer({
      mode: 'qa',
      cwd: process.cwd(),
      port,
      environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
    });
    const opened = app;
    await run({
      baseUrl: opened.baseUrl,
      fetch(path, init = {}) {
        if (!path.startsWith('/') || path.startsWith('//')) {
          throw new Error('Worker fixture requires an application path.');
        }
        const headers = new Headers(init.headers);
        headers.set('cookie', `qflow_session=${encodeURIComponent(session.token)}`);
        if (!headers.has('origin')) headers.set('origin', opened.baseUrl);
        return fetch(opened.baseUrl + path, { ...init, headers, redirect: 'manual' });
      },
    });
  } finally {
    try {
      await app?.close();
    } finally {
      await db.delete(authSessions).where(eq(authSessions.userId, auth.userId));
      await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, auth.userId));
    }
  }
}
