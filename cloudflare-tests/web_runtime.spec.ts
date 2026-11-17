import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq, or } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  type QflowCloudflareEnv,
  qflowCloudflareWorker,
} from '../deploy/cloudflare/worker.entry.ts';
import { getDb, type QflowDatabase } from '../lib/db.ts';
import {
  auditLogs,
  authIdentities,
  authLoginAttempts,
  authSessions,
  organizationMemberships,
  passwordResetEmailDeliveries,
  passwordResetTokens,
  tenants,
  userPasswords,
  users,
} from '../lib/db/schema.ts';
import { hashAuthToken, hashPassword, verifyPassword } from '../lib/services/auth_crypto.ts';
import { parseSourceIntakeRequest } from '../lib/source_intake/http.ts';
import { MAX_SOURCE_BATCH_BYTES } from '../lib/source_intake/policy.ts';

const TEST_ORIGIN = 'https://qflow.example';
const TEST_CLIENT_IP = '192.0.2.44';

function postAuth(path: string, body: Record<string, unknown>, cookie?: string): Promise<Response> {
  const headers = new Headers({
    'cf-connecting-ip': TEST_CLIENT_IP,
    'content-type': 'application/json',
    origin: TEST_ORIGIN,
    'user-agent': 'qflow-workerd-auth-test',
  });
  if (cookie) headers.set('cookie', cookie);
  return SELF.fetch(`${TEST_ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function requireSessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  const cookie = setCookie?.split(';', 1)[0];
  if (!cookie) throw new Error('Expected the authentication response to set a session cookie.');
  return cookie;
}

function workerBindings(): QflowCloudflareEnv {
  return {
    QFLOW_APP_ORIGIN: Reflect.get(env, 'QFLOW_APP_ORIGIN'),
    QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: Reflect.get(
      env,
      'QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1',
    ),
    QFLOW_DB: Reflect.get(env, 'QFLOW_DB'),
    QFLOW_EMAIL: Reflect.get(env, 'QFLOW_EMAIL'),
    QFLOW_EMAIL_FROM: Reflect.get(env, 'QFLOW_EMAIL_FROM'),
    QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT: Reflect.get(
      env,
      'QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT',
    ),
    QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT: Reflect.get(
      env,
      'QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT',
    ),
  };
}

async function cleanupAuthLifecycle(database: QflowDatabase, emailNormalized: string) {
  const userRows = await database.select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized));
  for (const { id: userId } of userRows) {
    const memberships = await database.select({ tenantId: organizationMemberships.tenantId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId));

    await database.delete(auditLogs).where(or(
      eq(auditLogs.actorUserId, userId),
      eq(auditLogs.targetUserId, userId),
    ));
    await database.delete(passwordResetEmailDeliveries).where(
      eq(passwordResetEmailDeliveries.userId, userId),
    );
    await database.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await database.delete(authSessions).where(eq(authSessions.userId, userId));
    await database.delete(authIdentities).where(eq(authIdentities.userId, userId));
    await database.delete(userPasswords).where(eq(userPasswords.userId, userId));
    await database.delete(organizationMemberships).where(
      eq(organizationMemberships.userId, userId),
    );
    await database.delete(users).where(eq(users.id, userId));

    for (const { tenantId } of memberships) {
      await database.delete(tenants).where(eq(tenants.id, tenantId));
    }
  }
}

describe('Cloudflare web entrypoint', () => {
  it('fails fast on the first request when password-reset delivery bindings are unavailable', () => {
    expect(() =>
      qflowCloudflareWorker.fetch(
        new Request('https://qflow.example/health'),
        {
          QFLOW_APP_ORIGIN: 'https://qflow.example',
          QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
        { waitUntil: () => undefined },
      )
    ).toThrow(
      'Missing required Cloudflare binding QFLOW_EMAIL',
    );
  });

  it('propagates the Hyperdrive binding through Fresh request handling', async () => {
    const response = await SELF.fetch('https://qflow.example/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'ok' },
    });
  });

  it('completes the password authentication lifecycle through local workerd HTTP', async () => {
    const database = getDb({ bindings: env });
    const emailNormalized = `workerd-auth-${crypto.randomUUID()}@example.test`;
    const initialPassword = 'Initial workerd password 2026';
    const changedPassword = 'Changed workerd password 2026';
    const resetPassword = 'Reset workerd password 2026';

    try {
      const signup = await postAuth('/api/auth/signup', {
        email: emailNormalized,
        name: 'Workerd Auth Test',
        password: initialPassword,
      });
      expect(signup.status).toBe(200);
      expect(await signup.json()).toMatchObject({ ok: true });
      requireSessionCookie(signup);

      const userRows = await database.select({ id: users.id })
        .from(users)
        .where(eq(users.emailNormalized, emailNormalized));
      expect(userRows).toHaveLength(1);
      const user = userRows[0];
      if (!user) throw new Error('Signup did not persist its user.');

      const passwordRows = await database.select({ passwordHash: userPasswords.passwordHash })
        .from(userPasswords)
        .where(eq(userPasswords.userId, user.id));
      expect(passwordRows).toHaveLength(1);
      expect(passwordRows[0]?.passwordHash.startsWith('pbkdf2$100000$')).toBe(true);

      const memberships = await database.select({ tenantId: organizationMemberships.tenantId })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, user.id));
      expect(memberships).toHaveLength(1);
      const membership = memberships[0];
      if (!membership) throw new Error('Signup did not persist its membership.');

      const duplicateSignup = await postAuth('/api/auth/signup', {
        email: emailNormalized,
        name: 'Duplicate Workerd Auth Test',
        password: initialPassword,
      });
      expect(duplicateSignup.status).toBe(409);
      expect(
        await database.select({ tenantId: organizationMemberships.tenantId })
          .from(organizationMemberships)
          .where(eq(organizationMemberships.userId, user.id)),
      ).toHaveLength(1);

      const login = await postAuth('/api/auth/login', {
        email: emailNormalized,
        password: initialPassword,
      });
      expect(login.status).toBe(200);
      expect(await login.json()).toMatchObject({ ok: true });
      const loginCookie = requireSessionCookie(login);

      const change = await postAuth('/api/auth/password/change', {
        currentPassword: initialPassword,
        newPassword: changedPassword,
      }, loginCookie);
      expect(change.status).toBe(200);
      expect(await change.json()).toEqual({ ok: true });
      requireSessionCookie(change);

      const changedLogin = await postAuth('/api/auth/login', {
        email: emailNormalized,
        password: changedPassword,
      });
      expect(changedLogin.status).toBe(200);
      expect(await changedLogin.json()).toMatchObject({ ok: true });

      const resetRequest = await postAuth('/api/auth/password/reset/request', {
        email: emailNormalized,
      });
      expect(resetRequest.status).toBe(202);
      expect(await resetRequest.json()).toMatchObject({ ok: true });

      const resetDeliveries = await database.select({ id: passwordResetEmailDeliveries.id })
        .from(passwordResetEmailDeliveries)
        .where(eq(passwordResetEmailDeliveries.userId, user.id));
      expect(resetDeliveries).toHaveLength(1);

      const rawResetToken = `workerd-reset-${crypto.randomUUID()}`;
      const resetTokenId = crypto.randomUUID();
      await database.insert(passwordResetTokens).values({
        id: resetTokenId,
        userId: user.id,
        tokenHash: await hashAuthToken(rawResetToken),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await database.insert(passwordResetEmailDeliveries).values({
        interfaceLocale: 'en-US',
        id: crypto.randomUUID(),
        resetTokenId,
        userId: user.id,
        tenantId: membership.tenantId,
        email: emailNormalized,
        encryptedToken: null,
        deliveredAt: new Date(),
      });

      const reset = await postAuth('/api/auth/password/reset/confirm', {
        token: rawResetToken,
        password: resetPassword,
      });
      expect(reset.status).toBe(200);
      expect(await reset.json()).toEqual({ ok: true });

      const resetLogin = await postAuth('/api/auth/login', {
        email: emailNormalized,
        password: resetPassword,
      });
      expect(resetLogin.status).toBe(200);
      expect(await resetLogin.json()).toMatchObject({ ok: true });
    } finally {
      await cleanupAuthLifecycle(database, emailNormalized);
    }
  }, 30_000);

  it('enforces require_sso inside password login and reset service boundaries', async () => {
    const database = getDb({ bindings: env });
    const emailNormalized = `workerd-sso-${crypto.randomUUID()}@example.test`;
    const password = 'SSO boundary password 2026';
    const replacementPassword = 'Blocked replacement password 2026';

    try {
      const signup = await postAuth('/api/auth/signup', {
        email: emailNormalized,
        name: 'SSO Boundary Test',
        password,
      });
      expect(signup.status).toBe(200);

      const userRows = await database.select({ id: users.id })
        .from(users)
        .where(eq(users.emailNormalized, emailNormalized));
      const user = userRows[0];
      if (!user) throw new Error('SSO boundary signup did not persist its user.');
      const memberships = await database.select({ tenantId: organizationMemberships.tenantId })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, user.id));
      const membership = memberships[0];
      if (!membership) throw new Error('SSO boundary signup did not persist its membership.');

      const rawResetToken = `workerd-sso-reset-${crypto.randomUUID()}`;
      await database.insert(passwordResetTokens).values({
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: await hashAuthToken(rawResetToken),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await database.update(tenants).set({ loginPolicy: 'require_sso' }).where(
        eq(tenants.id, membership.tenantId),
      );

      const login = await postAuth('/api/auth/login', { email: emailNormalized, password });
      expect(login.status).toBe(403);
      expect(await login.json()).toMatchObject({ code: 'sso_required' });

      const resetRequest = await postAuth('/api/auth/password/reset/request', {
        email: emailNormalized,
      });
      expect(resetRequest.status).toBe(202);
      expect(
        await database.select({ id: passwordResetEmailDeliveries.id })
          .from(passwordResetEmailDeliveries)
          .where(eq(passwordResetEmailDeliveries.userId, user.id)),
      ).toHaveLength(0);

      const reset = await postAuth('/api/auth/password/reset/confirm', {
        token: rawResetToken,
        password: replacementPassword,
      });
      expect(reset.status).toBe(400);

      const passwordRows = await database.select({ passwordHash: userPasswords.passwordHash })
        .from(userPasswords)
        .where(eq(userPasswords.userId, user.id));
      const storedPassword = passwordRows[0];
      if (!storedPassword) throw new Error('SSO boundary account lost its local credential.');
      expect(await verifyPassword(password, storedPassword.passwordHash)).toBe(true);
      expect(await verifyPassword(replacementPassword, storedPassword.passwordHash)).toBe(false);
    } finally {
      await cleanupAuthLifecycle(database, emailNormalized);
    }
  }, 30_000);

  it('never turns a federated-only account into a password account through reset', async () => {
    const database = getDb({ bindings: env });
    const emailNormalized = `workerd-federated-${crypto.randomUUID()}@example.test`;
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const rawResetToken = `workerd-federated-reset-${crypto.randomUUID()}`;

    try {
      await database.insert(tenants).values({
        id: tenantId,
        slug: `t-${tenantId.slice(0, 8)}`,
        name: 'Federated-only reset test',
      });
      await database.insert(users).values({
        id: userId,
        email: emailNormalized,
        emailNormalized,
        authProvider: 'google',
        authProviderId: `google|${userId}`,
      });
      await database.insert(authIdentities).values({
        id: crypto.randomUUID(),
        userId,
        provider: 'google',
        providerId: `google|${userId}`,
        email: emailNormalized,
      });
      await database.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      await database.insert(passwordResetTokens).values({
        id: crypto.randomUUID(),
        userId,
        tokenHash: await hashAuthToken(rawResetToken),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const resetRequest = await postAuth('/api/auth/password/reset/request', {
        email: emailNormalized,
      });
      expect(resetRequest.status).toBe(202);
      expect(
        await database.select({ id: passwordResetEmailDeliveries.id })
          .from(passwordResetEmailDeliveries)
          .where(eq(passwordResetEmailDeliveries.userId, userId)),
      ).toHaveLength(0);

      const reset = await postAuth('/api/auth/password/reset/confirm', {
        token: rawResetToken,
        password: 'Federated reset must stay blocked 2026',
      });
      expect(reset.status).toBe(400);
      expect(
        await database.select({ userId: userPasswords.userId })
          .from(userPasswords)
          .where(eq(userPasswords.userId, userId)),
      ).toHaveLength(0);
    } finally {
      await cleanupAuthLifecycle(database, emailNormalized);
    }
  }, 30_000);

  it('keeps Workflow dispatch and auth cleanup on independent schedules', async () => {
    const attemptKey = `scheduled-prune-${crypto.randomUUID()}`;
    const database = getDb({ bindings: env });
    const bindings = workerBindings();
    await database.insert(authLoginAttempts).values({
      attemptKey,
      attempts: 1,
      firstAttemptAt: new Date(0),
      lastAttemptAt: new Date(0),
    });

    try {
      await expect(
        qflowCloudflareWorker.scheduled({ cron: '* * * * *' }, bindings),
      ).rejects.toThrow('Cloudflare Workflow outbox dispatch failed.');
      const retainedRows = await database.select({ attemptKey: authLoginAttempts.attemptKey })
        .from(authLoginAttempts)
        .where(eq(authLoginAttempts.attemptKey, attemptKey));
      expect(retainedRows).toHaveLength(1);

      await expect(
        qflowCloudflareWorker.scheduled({ cron: '0 3 * * *' }, bindings),
      ).resolves.toBe(undefined);
      const prunedRows = await database.select({ attemptKey: authLoginAttempts.attemptKey })
        .from(authLoginAttempts)
        .where(eq(authLoginAttempts.attemptKey, attemptKey));
      expect(prunedRows).toHaveLength(0);
    } finally {
      await database.delete(authLoginAttempts).where(eq(authLoginAttempts.attemptKey, attemptKey));
    }
  });

  it('runs reset-email recovery without requiring Workflow bindings', async () => {
    await expect(
      qflowCloudflareWorker.scheduled({ cron: '*/2 * * * *' }, workerBindings()),
    ).resolves.toBe(undefined);
  });

  it('ignores unrecognized scheduled triggers', async () => {
    await expect(
      qflowCloudflareWorker.scheduled({ cron: '7 4 * * *' }, workerBindings()),
    ).resolves.toBe(undefined);
    await expect(qflowCloudflareWorker.scheduled({}, workerBindings())).resolves.toBe(undefined);
  });

  it('derives the current password hash inside workerd', async () => {
    const hash = await hashPassword('A workerd password phrase');

    expect(hash.startsWith('pbkdf2$100000$')).toBe(true);
  });

  it('parses the largest accepted recovery batch inside workerd', async () => {
    const form = new FormData();
    form.set('purpose', 'recover_existing');
    form.set('destination', 'Assessment');
    form.set(
      'files',
      new File([new Uint8Array(MAX_SOURCE_BATCH_BYTES)], 'largest-supported.txt', {
        type: 'text/plain',
      }),
    );
    const request = new Request('https://qflow.example/api/source-intake/inspect', {
      method: 'POST',
      body: form,
    });

    const parsed = await parseSourceIntakeRequest(request);

    expect(parsed.entries).toHaveLength(1);
    const entry = parsed.entries[0];
    expect(entry?.input._tag).toBe('file');
    expect(entry?.input._tag === 'file' ? entry.input.source.bytes.byteLength : 0).toBe(
      MAX_SOURCE_BATCH_BYTES,
    );
  });
});
