import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { encodeBase64Url } from '../lib/base64.ts';
import { decryptCredential, encryptCredential } from '../lib/credential_cipher.ts';
import { db, shutdownDb } from '../lib/db.ts';
import {
  auditLogs,
  canvasConnections,
  canvasOauthStates,
  canvasUserGrants,
  organizationMemberships,
  tenants,
  users,
} from '../lib/db/schema.ts';
import {
  authorizeCanvasConnection,
  beginCanvasAuthorization,
  completeCanvasAuthorization,
  consumeCanvasAuthorizationState,
  createCanvasConnection,
  disconnectCanvasConnection,
  listCanvasConnections,
  listCanvasConnectionSettings,
  resolveCanvasConnection,
  rotateCanvasDeveloperKey,
  setCanvasConnectionLifecycle,
} from '../lib/lms/canvas_connections.ts';
import { createCanvasAuthorizationState } from '../lib/lms/canvas_connection_store.ts';
import { redact, reveal } from '../lib/redacted.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase('credential envelopes are authenticated to their tenant-owned purpose', async () => {
  const runtime = credentialRuntime();
  const context = {
    purpose: 'canvas-client-secret' as const,
    tenantId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
  };
  const encrypted = await encryptCredential(runtime, redact('canvas-secret'), context);
  expect(encrypted.startsWith('v1.')).toStrictEqual(true);
  expect(encrypted.includes('canvas-secret')).toStrictEqual(false);
  expect(reveal(await decryptCredential(runtime, encrypted, context))).toStrictEqual(
    'canvas-secret',
  );
  await expect(
    Promise.resolve().then(() =>
      decryptCredential(runtime, encrypted, { ...context, tenantId: crypto.randomUUID() })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('could not be authenticated')
  );
});

testCase('Canvas OAuth grants are personal, tenant-scoped, encrypted, and refreshable', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const sameTenantUserId = crypto.randomUUID();
  const auth: RequestContext = { tenantId, userId, role: 'owner' };
  const instructorAuth: RequestContext = {
    tenantId,
    userId: sameTenantUserId,
    role: 'instructor',
  };
  const otherAuth: RequestContext = {
    tenantId: otherTenantId,
    userId: otherUserId,
    role: 'owner',
  };
  const runtime = credentialRuntime();

  try {
    await db.insert(tenants).values([
      { id: tenantId, slug: `canvas-${tenantId.slice(0, 8)}`, name: 'Canvas Tenant' },
      {
        id: otherTenantId,
        slug: `canvas-${otherTenantId.slice(0, 8)}`,
        name: 'Other Canvas Tenant',
      },
    ]);
    await db.insert(users).values([
      {
        id: userId,
        email: `canvas-${userId.slice(0, 8)}@example.test`,
        emailNormalized: `canvas-${userId.slice(0, 8)}@example.test`,
      },
      {
        id: otherUserId,
        email: `canvas-${otherUserId.slice(0, 8)}@example.test`,
        emailNormalized: `canvas-${otherUserId.slice(0, 8)}@example.test`,
      },
      {
        id: sameTenantUserId,
        email: `canvas-${sameTenantUserId.slice(0, 8)}@example.test`,
        emailNormalized: `canvas-${sameTenantUserId.slice(0, 8)}@example.test`,
      },
    ]);
    await db.insert(organizationMemberships).values([
      { id: crypto.randomUUID(), tenantId, userId, role: 'owner' },
      { id: crypto.randomUUID(), tenantId: otherTenantId, userId: otherUserId, role: 'owner' },
      { id: crypto.randomUUID(), tenantId, userId: sameTenantUserId, role: 'instructor' },
    ]);

    expect(
      await createCanvasConnection(instructorAuth, {
        name: 'Unauthorized Canvas',
        baseUrl: 'https://unauthorized-canvas.example.edu',
        clientId: 'unauthorized-client',
        clientSecret: redact('unauthorized-secret'),
      }, runtime),
    ).toStrictEqual({
      ok: false,
      error: {
        _tag: 'CanvasAdministrationDenied',
        message: 'Only workspace admins can manage Canvas sites.',
      },
    });

    const createdResult = await createCanvasConnection(auth, {
      name: 'Main Canvas',
      baseUrl: 'https://canvas.example.edu',
      clientId: 'client-id',
      clientSecret: redact('client-secret'),
    }, runtime);
    if (!(createdResult.ok)) expect.unreachable('Expected createdResult.ok');
    const created = createdResult.value;
    expect(created.currentUserAuthorized).toStrictEqual(false);
    expect(created.credentialVersion).toStrictEqual(1);
    const initialConnections = await listCanvasConnections(auth, runtime);
    if (!(initialConnections.ok)) expect.unreachable('Expected initialConnections.ok');
    expect(initialConnections.value).toStrictEqual([]);
    const initialSettings = await listCanvasConnectionSettings(auth, runtime);
    if (!(initialSettings.ok)) expect.unreachable('Expected initialSettings.ok');
    expect(initialSettings.value.length).toStrictEqual(1);
    const otherSettings = await listCanvasConnectionSettings(otherAuth, runtime);
    if (!(otherSettings.ok)) expect.unreachable('Expected otherSettings.ok');
    expect(otherSettings.value).toStrictEqual([]);
    expect((await resolveCanvasConnection(auth, created.id, runtime)).ok).toStrictEqual(false);

    const ownedExpiredStateHash = crypto.randomUUID().replaceAll('-', '').repeat(2);
    const otherUserExpiredStateHash = crypto.randomUUID().replaceAll('-', '').repeat(2);
    await expect(
      Promise.resolve().then(() =>
        db.insert(canvasOauthStates).values({
          stateHash: crypto.randomUUID().replaceAll('-', '').repeat(2),
          connectionId: created.id,
          tenantId,
          userId: otherUserId,
          credentialVersion: 1,
          returnPath: '/imports',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2026-01-01T00:10:00.000Z'),
        })
      ),
    ).rejects.toBeInstanceOf(Error);
    await db.insert(canvasOauthStates).values([
      {
        stateHash: ownedExpiredStateHash,
        connectionId: created.id,
        tenantId,
        userId,
        credentialVersion: 1,
        returnPath: '/imports',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T00:10:00.000Z'),
      },
      {
        stateHash: otherUserExpiredStateHash,
        connectionId: created.id,
        tenantId,
        userId: sameTenantUserId,
        credentialVersion: 1,
        returnPath: '/imports',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T00:10:00.000Z'),
      },
    ]);

    const unavailableRuntime = {
      bindings: { DATABASE_URL: 'postgres://qflow:qflow@127.0.0.1:1/qflow_unavailable' },
    };
    const persistenceFailure = await authorizeCanvasConnection(
      unavailableRuntime,
      auth,
      created.id,
    );
    expect(persistenceFailure.ok).toStrictEqual(false);
    if (persistenceFailure.ok) throw new Error('Expected Canvas persistence failure.');
    expect(persistenceFailure.error._tag).toStrictEqual('CanvasPersistenceUnavailable');
    await shutdownDb(unavailableRuntime);

    const started = await beginCanvasAuthorization(
      auth,
      created.id,
      'https://qflow.example/auth/canvas/callback',
      runtime,
    );
    if (!(started.ok)) expect.unreachable('Expected started.ok');
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.origin).toStrictEqual('https://canvas.example.edu');
    expect(authorizationUrl.pathname).toStrictEqual('/login/oauth2/auth');
    expect(authorizationUrl.searchParams.get('client_id')).toStrictEqual('client-id');
    expect(authorizationUrl.searchParams.get('response_type')).toStrictEqual('code');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toStrictEqual(
      'https://qflow.example/auth/canvas/callback',
    );
    expect(authorizationUrl.searchParams.get('scope')).toStrictEqual([
      'url:POST|/api/v1/courses/:course_id/content_migrations',
      'url:PUT|/api/v1/courses/:course_id/content_migrations/:id',
      'url:GET|/api/v1/courses/:course_id/content_migrations/:id',
      'url:GET|/api/v1/progress/:id',
    ].join(' '));
    const stateToken = authorizationUrl.searchParams.get('state');
    if (!stateToken) expect.unreachable('Expected stateToken');
    expect(
      await db.select({ stateHash: canvasOauthStates.stateHash }).from(canvasOauthStates)
        .where(eq(canvasOauthStates.stateHash, ownedExpiredStateHash)),
    ).toStrictEqual([]);
    expect(
      await db.select({ stateHash: canvasOauthStates.stateHash }).from(canvasOauthStates)
        .where(eq(canvasOauthStates.stateHash, otherUserExpiredStateHash)),
    ).toStrictEqual([{ stateHash: otherUserExpiredStateHash }]);

    const wrongUserState = await consumeCanvasAuthorizationState(otherAuth, stateToken, runtime);
    expect(wrongUserState.ok).toStrictEqual(false);
    const consumedState = await consumeCanvasAuthorizationState(auth, stateToken, runtime);
    if (!(consumedState.ok)) expect.unreachable('Expected consumedState.ok');
    const state = consumedState.value;
    const replayedState = await consumeCanvasAuthorizationState(auth, stateToken, runtime);
    expect(replayedState.ok).toStrictEqual(false);

    let authorizationBody = '';
    const completed = await completeCanvasAuthorization(
      auth,
      state,
      'authorization-code',
      'https://qflow.example/auth/canvas/callback',
      runtime,
      {
        fetchImpl: (_input, init) => {
          authorizationBody = String(init?.body);
          return Promise.resolve(Response.json({
            access_token: 'initial-access-token',
            refresh_token: 'initial-refresh-token',
            user: { id: 42 },
          }));
        },
      },
    );
    expect(completed).toStrictEqual({ ok: true, value: 'authorized' });
    expect(authorizationBody.includes('client_secret=client-secret')).toStrictEqual(true);
    expect(authorizationBody.includes('code=authorization-code')).toStrictEqual(true);

    const listed = await listCanvasConnections(auth, runtime);
    if (!(listed.ok)) expect.unreachable('Expected listed.ok');
    expect(listed.value.length).toStrictEqual(1);
    expect(JSON.stringify(listed.value).includes('secret')).toStrictEqual(false);
    expect((await resolveCanvasConnection(otherAuth, created.id, runtime)).ok).toStrictEqual(false);

    let refreshBody = '';
    const authorized = await authorizeCanvasConnection(runtime, auth, created.id, {
      fetchImpl: (_input, init) => {
        refreshBody = String(init?.body);
        return Promise.resolve(Response.json({
          access_token: 'short-lived-access-token',
        }));
      },
    });
    if (!(authorized.ok)) expect.unreachable('Expected authorized.ok');
    expect(reveal(authorized.connection.accessToken)).toStrictEqual('short-lived-access-token');
    expect(JSON.stringify(authorized.connection).includes('short-lived-access-token'))
      .toStrictEqual(false);
    expect(refreshBody.includes('refresh_token=initial-refresh-token')).toStrictEqual(true);

    await expect(
      Promise.resolve().then(() =>
        authorizeCanvasConnection(runtime, auth, created.id, {
          fetchImpl: () =>
            Promise.reject(new DOMException('Canvas request cancelled.', 'AbortError')),
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof DOMException && caught.message.includes('Canvas request cancelled.')
    );

    const grant = await db.select().from(canvasUserGrants).where(
      eq(canvasUserGrants.connectionId, created.id),
    ).limit(1);
    expect(grant.length).toStrictEqual(1);
    expect(reveal(
      await decryptCredential(runtime, grant[0].encryptedRefreshToken, {
        purpose: 'canvas-refresh-token',
        tenantId,
        connectionId: created.id,
        userId,
      }),
    )).toStrictEqual('initial-refresh-token');
    expect(grant[0].canvasUserId).toStrictEqual('42');

    const configurationFailure = await authorizeCanvasConnection({}, auth, created.id, {
      fetchImpl: () => Promise.reject(new Error('Token request must not run.')),
    });
    expect(configurationFailure.ok).toStrictEqual(false);
    if (configurationFailure.ok) throw new Error('Expected Canvas configuration failure.');
    expect(configurationFailure.error._tag).toStrictEqual('CanvasConfigurationInvalid');

    const staleAuthorization = await beginCanvasAuthorization(
      auth,
      created.id,
      'https://qflow.example/auth/canvas/callback',
      runtime,
    );
    if (!(staleAuthorization.ok)) expect.unreachable('Expected staleAuthorization.ok');
    const staleStateToken = new URL(staleAuthorization.authorizationUrl).searchParams.get(
      'state',
    );
    if (!staleStateToken) expect.unreachable('Expected staleStateToken');
    const staleState = await consumeCanvasAuthorizationState(auth, staleStateToken, runtime);
    if (!(staleState.ok)) expect.unreachable('Expected staleState.ok');
    const exchangeStarted = Promise.withResolvers<void>();
    const releaseExchange = Promise.withResolvers<void>();
    const staleCompletion = completeCanvasAuthorization(
      auth,
      staleState.value,
      'stale-authorization-code',
      'https://qflow.example/auth/canvas/callback',
      runtime,
      {
        fetchImpl: async () => {
          exchangeStarted.resolve();
          await releaseExchange.promise;
          return Response.json({
            access_token: 'stale-access-token',
            refresh_token: 'stale-refresh-token',
          });
        },
      },
    );
    await exchangeStarted.promise;

    const rotated = await rotateCanvasDeveloperKey(auth, created.id, {
      clientId: 'replacement-client-id',
      clientSecret: redact('replacement-client-secret'),
      expectedCredentialVersion: 1,
    }, runtime);
    expect(rotated).toStrictEqual({ ok: true, credentialVersion: 2 });
    expect(
      await rotateCanvasDeveloperKey(instructorAuth, created.id, {
        clientId: 'unauthorized-client',
        clientSecret: redact('unauthorized-secret'),
        expectedCredentialVersion: 2,
      }, runtime),
    ).toStrictEqual({
      ok: false,
      error: {
        _tag: 'CanvasAdministrationDenied',
        message: 'Only workspace admins can manage Canvas sites.',
      },
    });
    releaseExchange.resolve();
    const staleCompletionResult = await staleCompletion;
    expect(staleCompletionResult.ok).toStrictEqual(false);
    if (staleCompletionResult.ok) throw new Error('Expected stale authorization to fail.');
    expect(staleCompletionResult.error._tag).toStrictEqual('CanvasCredentialRotationConflict');
    const grantsAfterRotation = await db.select().from(canvasUserGrants).where(
      eq(canvasUserGrants.connectionId, created.id),
    );
    expect(grantsAfterRotation).toStrictEqual([]);
    expect((await resolveCanvasConnection(auth, created.id, runtime)).ok).toStrictEqual(false);
    const rotatedSettings = await listCanvasConnectionSettings(auth, runtime);
    if (!(rotatedSettings.ok)) expect.unreachable('Expected rotatedSettings.ok');
    expect(rotatedSettings.value[0]?.credentialVersion).toStrictEqual(2);
    expect(rotatedSettings.value[0]?.currentUserAuthorized).toStrictEqual(false);

    const staleRotation = await rotateCanvasDeveloperKey(auth, created.id, {
      clientId: 'stale-client-id',
      clientSecret: redact('stale-client-secret'),
      expectedCredentialVersion: 1,
    }, runtime);
    expect(staleRotation.ok).toStrictEqual(false);
    if (staleRotation.ok) throw new Error('Expected stale Canvas key rotation to fail.');
    expect(staleRotation.error._tag).toStrictEqual('CanvasCredentialRotationConflict');

    const reauthorization = await beginCanvasAuthorization(
      auth,
      created.id,
      'https://qflow.example/auth/canvas/callback',
      runtime,
    );
    if (!(reauthorization.ok)) expect.unreachable('Expected reauthorization.ok');
    const reauthorizationToken = new URL(reauthorization.authorizationUrl).searchParams.get(
      'state',
    );
    if (!reauthorizationToken) expect.unreachable('Expected reauthorizationToken');
    const reauthorizationStateResult = await consumeCanvasAuthorizationState(
      auth,
      reauthorizationToken,
      runtime,
    );
    if (!(reauthorizationStateResult.ok)) {
      expect.unreachable('Expected reauthorizationStateResult.ok');
    }
    const reauthorizationState = reauthorizationStateResult.value;
    let reauthorizationBody = '';
    expect(
      await completeCanvasAuthorization(
        auth,
        reauthorizationState,
        'replacement-code',
        'https://qflow.example/auth/canvas/callback',
        runtime,
        {
          fetchImpl: (_input, init) => {
            reauthorizationBody = String(init?.body);
            return Promise.resolve(Response.json({
              access_token: 'replacement-access-token',
              refresh_token: 'replacement-refresh-token',
            }));
          },
        },
      ),
    ).toStrictEqual({ ok: true, value: 'authorized' });
    expect(reauthorizationBody.includes('client_secret=replacement-client-secret')).toStrictEqual(
      true,
    );

    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) expect.unreachable('Expected databaseUrl');
    const authorizationApplicationName = `qflow_canvas_authorization_${crypto.randomUUID()}`;
    const lockerClient = namedPostgresClient(
      databaseUrl,
      `qflow_canvas_locker_${crypto.randomUUID()}`,
    );
    const authorizationClient = namedPostgresClient(databaseUrl, authorizationApplicationName);
    const observerClient = namedPostgresClient(
      databaseUrl,
      `qflow_canvas_observer_${crypto.randomUUID()}`,
    );
    const lockerDatabase = drizzle(lockerClient);
    const authorizationDatabase = drizzle(authorizationClient);
    const updateLocked = Promise.withResolvers<void>();
    const releaseUpdate = Promise.withResolvers<void>();
    const concurrentCredentialUpdate = lockerDatabase.transaction(async (tx) => {
      await tx.update(canvasConnections).set({
        clientId: 'concurrent-client-id',
        credentialVersion: 3,
      }).where(eq(canvasConnections.id, created.id));
      updateLocked.resolve();
      await releaseUpdate.promise;
    });
    await updateLocked.promise;
    const concurrentStateHash = crypto.randomUUID();
    const concurrentStateCreatedAt = new Date();
    const authorizationDuringUpdate = createCanvasAuthorizationState(
      authorizationDatabase,
      {
        stateHash: concurrentStateHash,
        connectionId: created.id,
        tenantId,
        userId,
        returnPath: '/settings/canvas',
        createdAt: concurrentStateCreatedAt,
        expiresAt: new Date(concurrentStateCreatedAt.getTime() + 60_000),
      },
    );
    try {
      await waitForDatabaseLock(observerClient, authorizationApplicationName);
      releaseUpdate.resolve();
      await concurrentCredentialUpdate;
      const authorizationOutcome = await authorizationDuringUpdate;
      expect(authorizationOutcome).toStrictEqual({
        _tag: 'Stored',
        target: {
          baseUrl: 'https://canvas.example.edu',
          clientId: 'concurrent-client-id',
        },
      });
    } finally {
      releaseUpdate.resolve();
      await Promise.allSettled([concurrentCredentialUpdate, authorizationDuringUpdate]);
      await Promise.all([
        lockerClient.end(),
        authorizationClient.end(),
        observerClient.end(),
      ]);
    }
    const concurrentStates = await db.select({
      credentialVersion: canvasOauthStates.credentialVersion,
    }).from(canvasOauthStates).where(eq(canvasOauthStates.stateHash, concurrentStateHash));
    expect(concurrentStates).toStrictEqual([{ credentialVersion: 3 }]);

    expect(await setCanvasConnectionLifecycle(auth, created.id, 'disabled', runtime)).toStrictEqual(
      { ok: true, value: 'changed' },
    );
    expect(await setCanvasConnectionLifecycle(instructorAuth, created.id, 'active', runtime))
      .toStrictEqual({
        ok: false,
        error: {
          _tag: 'CanvasAdministrationDenied',
          message: 'Only workspace admins can manage Canvas sites.',
        },
      });
    expect(await setCanvasConnectionLifecycle(auth, created.id, 'active', runtime)).toStrictEqual({
      ok: true,
      value: 'changed',
    });
    expect(await disconnectCanvasConnection(auth, created.id, runtime)).toStrictEqual({
      ok: true,
      value: 'disconnected',
    });
    expect((await resolveCanvasConnection(auth, created.id, runtime)).ok).toStrictEqual(false);

    const auditRows = await db.select({
      action: auditLogs.action,
      metadata: auditLogs.metadata,
    }).from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(new Set(auditRows.map((row) => row.action))).toStrictEqual(
      new Set([
        'canvas_connection_created',
        'canvas_user_grant_authorized',
        'canvas_developer_key_rotated',
        'canvas_connection_lifecycle_changed',
        'canvas_user_grant_disconnected',
      ]),
    );
    const auditJson = JSON.stringify(auditRows);
    expect(auditJson.includes('replacement-client-secret')).toStrictEqual(false);
    expect(auditJson.includes('replacement-refresh-token')).toStrictEqual(false);
  } finally {
    await db.delete(canvasOauthStates).where(eq(canvasOauthStates.tenantId, tenantId)).catch(
      () => undefined,
    );
    await db.delete(canvasConnections).where(eq(canvasConnections.tenantId, tenantId)).catch(
      () => undefined,
    );
    await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, otherUserId)).catch(() => undefined);
    await db.delete(users).where(eq(users.id, sameTenantUserId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, otherTenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

function credentialRuntime() {
  return {
    bindings: {
      QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: encodeBase64Url(new Uint8Array(32).fill(11)),
    },
  };
}

function namedPostgresClient(databaseUrl: string, applicationName: string) {
  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connection: { application_name: applicationName },
  });
}

async function waitForDatabaseLock(
  observer: ReturnType<typeof postgres>,
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await observer<{ readonly waitEventType: string | null }[]>`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
    `;
    if (rows.some((row) => row.waitEventType === 'Lock')) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Canvas authorization did not wait on the credential row lock.');
}
