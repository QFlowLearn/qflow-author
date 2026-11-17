import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { decryptCredential, encryptCredential } from '../lib/credential_cipher.ts';
import { db, shutdownDb } from '../lib/db.ts';
import { auditLogs, organizationMemberships, tenants } from '../lib/db/schema.ts';
import { redact } from '../lib/redacted.ts';
import { authenticateWithPassword } from '../lib/services/auth.ts';
import { createSession, getSessionByToken } from '../lib/services/auth_sessions.ts';
import { provisionLocalUser } from '../lib/services/account_provisioning.ts';
import { generateAuthToken, hashAuthToken } from '../lib/services/auth_crypto.ts';
import type { PasswordResetEmailInput, TransactionalEmailSender } from '../lib/services/email.ts';
import { parseEmailAddress } from '../lib/services/email_address.ts';
import { PasswordResetEmailDeliveries } from '../lib/services/password_reset_delivery.ts';
import { resetPasswordWithToken } from '../lib/services/password_reset_confirmation.ts';
import { createPostgresPasswordResetRecords } from '../lib/services/password_reset_records.ts';
import { createPasswordServices } from '../lib/services/password_services_runtime.ts';
import { cleanupAuthTestAccount } from './auth_test_fixture.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { getUserSettings, saveUserSettings } from '../lib/services/user_settings.ts';

const TEST_INTERFACE_LOCALE: InterfaceLocale = 'es-ES';

const TEST_CIPHER_RUNTIME = {
  bindings: {
    QFLOW_APP_ORIGIN: 'https://author.example.test',
    QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    QFLOW_LOCAL_TRANSACTIONAL_EMAIL_DISABLED: 'true',
  },
};

testCase('password reset issuance and consumption preserve single-use account invariants', {
  skip: !process.env['DATABASE_URL'],
}, async function () {
  const tenantId = crypto.randomUUID();
  const secondTenantId = crypto.randomUUID();
  const email = `password-reset-${tenantId.slice(0, 8)}@example.test`;
  const sentResetEmails: PasswordResetEmailInput[] = [];
  let currentTime = new Date();
  let userId: string | null = null;
  const passwords = createPasswordServices(TEST_CIPHER_RUNTIME);

  const records = createPostgresPasswordResetRecords({
    database: db,
    generateId: () => crypto.randomUUID(),
    generateToken: generateAuthToken,
    hashToken: hashAuthToken,
    encryptToken: async ({ token, resetTokenId, userId }) =>
      await encryptCredential(TEST_CIPHER_RUNTIME, redact(token), {
        purpose: 'password-reset-token',
        resetTokenId,
        userId,
      }),
  });
  const deliveries = new PasswordResetEmailDeliveries({
    appOrigin: new URL('https://author.example.test'),
    clock: { now: () => currentTime },
    decryptToken: ({ encryptedToken, resetTokenId, userId }) =>
      decryptCredential(TEST_CIPHER_RUNTIME, encryptedToken, {
        purpose: 'password-reset-token',
        resetTokenId,
        userId,
      }),
    email: recordingEmailSender(sentResetEmails),
    generateId: () => crypto.randomUUID(),
    records,
  });

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Password reset test',
    });
    const created = await provisionLocalUser({
      email,
      password: 'Original account password phrase 2026',
      interfaceLocale: TEST_INTERFACE_LOCALE,
    });
    if (!(created.ok)) expect.unreachable('Expected created.ok');
    userId = created.userId;
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    await db.insert(tenants).values({
      id: secondTenantId,
      slug: `t-${secondTenantId.slice(0, 8)}`,
      name: 'Second password reset test tenant',
    });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId: secondTenantId,
      userId,
      role: 'instructor',
    });
    const session = await createSession({ userId, tenantId });

    const missingEmail = parseEmailAddress(`missing-${email}`);
    if (!missingEmail) expect.unreachable('Expected missingEmail');
    expect(
      await records.issue({
        email: missingEmail,
        hostTenantId: tenantId,
        ipAddress: null,
        userAgent: null,
        now: currentTime,
      }),
    ).toStrictEqual({
      ok: false,
      code: 'account_not_found',
    });
    const registeredEmail = parseEmailAddress(email);
    if (!registeredEmail) expect.unreachable('Expected registeredEmail');
    expect(
      await records.issue({
        email: registeredEmail,
        hostTenantId: null,
        ipAddress: null,
        userAgent: null,
        now: currentTime,
      }),
    ).toStrictEqual({ ok: false, code: 'account_not_found' });
    const issued = await records.issue({
      email: registeredEmail,
      hostTenantId: tenantId,
      ipAddress: null,
      userAgent: null,
      now: currentTime,
    });
    if (!(issued.ok)) expect.unreachable('Expected issued.ok');
    const issuedSettings = await getUserSettings(userId);
    await saveUserSettings(userId, { ...issuedSettings, interfaceLocale: 'en-US' });
    expect(
      await records.issue({
        email: registeredEmail,
        hostTenantId: tenantId,
        ipAddress: null,
        userAgent: null,
        now: currentTime,
      }),
    ).toStrictEqual({
      ok: false,
      code: 'cooldown_active',
    });
    expect(
      await deliveries.deliver({
        deliveryId: issued.value.deliveryId,
        onEmailFailure: 'invalidate',
      }),
    ).toStrictEqual({ ok: true, code: 'delivered' });
    const token = new URL(sentResetEmails[0].resetUrl).searchParams.get('token');
    if (!token) expect.unreachable('Expected token');
    expect(sentResetEmails[0].interfaceLocale).toStrictEqual('es-ES');

    const firstPassword = 'First replacement password phrase 2026';
    const secondPassword = 'Second replacement password phrase 2026';
    const results = await Promise.all([
      passwords.confirmReset({ token, password: firstPassword }),
      passwords.confirmReset({ token, password: secondPassword }),
    ]);
    expect(results.filter((result) => result.ok).length).toStrictEqual(1);
    expect(results.filter((result) => !result.ok && result.code === 'invalid_or_expired').length)
      .toStrictEqual(1);

    const firstLogin = await authenticateWithPassword({
      email,
      password: firstPassword,
      attemptOrigin: 'password-reset-service-test',
      hostTenantId: tenantId,
    });
    const secondLogin = await authenticateWithPassword({
      email,
      password: secondPassword,
      attemptOrigin: 'password-reset-service-test',
      hostTenantId: tenantId,
    });
    const firstWon = firstLogin.ok;
    const secondWon = secondLogin.ok;
    expect(Number(firstWon) + Number(secondWon)).toStrictEqual(1);
    expect(await getSessionByToken(session.token)).toStrictEqual(null);

    const currentPassword = firstWon ? firstPassword : secondPassword;
    const activeSession = await createSession({ userId, tenantId });
    const changed = await passwords.changePassword({
      userId,
      tenantId,
      currentPassword,
      newPassword: 'Final account password phrase 2026',
    });
    if (!(changed.ok)) expect.unreachable('Expected changed.ok');
    expect(await getSessionByToken(activeSession.token)).toStrictEqual(null);
    if (!(await getSessionByToken(changed.token))) {
      expect.unreachable('Expected await getSessionByToken(changed.token)');
    }
    const finalLogin = await authenticateWithPassword({
      email,
      password: 'Final account password phrase 2026',
      attemptOrigin: 'password-reset-service-test',
      hostTenantId: tenantId,
    });
    if (!(finalLogin.ok)) expect.unreachable('Expected finalLogin.ok');

    currentTime = new Date(currentTime.getTime() + 16 * 60 * 1000);
    const pending = await records.issue({
      email: registeredEmail,
      hostTenantId: tenantId,
      ipAddress: null,
      userAgent: null,
      now: currentTime,
    });
    if (!(pending.ok)) expect.unreachable('Expected pending.ok');
    const pendingSettings = await getUserSettings(userId);
    await saveUserSettings(userId, { ...pendingSettings, interfaceLocale: 'es-419' });
    expect(await deliveries.deliverPending()).toStrictEqual({
      ok: true,
      attempted: 1,
      delivered: 1,
    });
    expect(sentResetEmails.length).toStrictEqual(2);
    expect(sentResetEmails[1].interfaceLocale).toStrictEqual('en-US');

    const auditRows = await db.select({
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      targetUserId: auditLogs.targetUserId,
    })
      .from(auditLogs)
      .where(eq(auditLogs.targetUserId, userId));
    const requestedRows = auditRows.filter((row) => row.action === 'password_reset_requested');
    expect(requestedRows.length).toStrictEqual(2);
    expect(requestedRows.every((row) => row.actorUserId === null)).toStrictEqual(true);
    expect(requestedRows.every((row) => row.targetUserId === userId)).toStrictEqual(true);
    expect(auditRows.some((row) => row.action === 'password_reset_completed')).toStrictEqual(true);
    expect(auditRows.some((row) => row.action === 'password_changed')).toStrictEqual(true);
  } finally {
    await cleanupAuthTestAccount({ tenantId, userId });
    await db.delete(tenants).where(eq(tenants.id, secondTenantId)).catch(() => {});
    await shutdownDb().catch(() => {});
  }
});

testCase('invalid reset tokens never invoke the expensive password hasher', async () => {
  let passwordHashCalls = 0;
  const dependencies = {
    clock: { now: () => new Date('2026-08-11T12:00:00Z') },
    hashPassword: (_password: string) => {
      passwordHashCalls += 1;
      return Promise.resolve('password-hash');
    },
    hashToken: (_token: string) => Promise.resolve('token-hash'),
    records: {
      isTokenEligibleForPasswordHash: () => Promise.resolve(false),
      consumeAndReplace: () => {
        throw new Error('Invalid tokens must not reach final consumption.');
      },
    },
  };

  expect(
    await resetPasswordWithToken({
      token: 'invalid-token',
      password: 'Long enough password',
    }, dependencies),
  ).toStrictEqual({ ok: false, code: 'invalid_or_expired' });
  expect(passwordHashCalls).toStrictEqual(0);
});

function recordingEmailSender(messages: PasswordResetEmailInput[]): TransactionalEmailSender {
  return {
    sendSignupWelcomeEmail: () => Promise.resolve({ ok: false, code: 'disabled_local' }),
    sendPasswordResetEmail(input) {
      messages.push(input);
      return Promise.resolve({ ok: true, messageId: `message-${messages.length}` });
    },
  };
}
