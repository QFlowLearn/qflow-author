import { expect, it } from 'vitest';

import { db, shutdownDb } from '../../lib/db.ts';
import { organizationMemberships, tenants } from '../../lib/db/schema.ts';
import { provisionLocalUser } from '../../lib/services/account_provisioning.ts';
import { createTransactionalEmailSender } from '../../lib/services/email.ts';
import { parseEmailAddress } from '../../lib/services/email_address.ts';
import {
  type PasswordResetRequestDependencies,
  requestPasswordReset,
} from '../../lib/services/password_services_runtime.ts';
import { resetRequestAuthRoute } from '../../lib/http/routes/auth_api/reset_request.ts';
import type { QflowRuntime } from '../../lib/runtime.ts';
import { cleanupAuthTestAccount } from '../auth_test_fixture.ts';
import { apiRequest } from '../helpers/http_request_fixture.ts';
import { requireQaDatabaseUrl } from '../helpers/qa_database.ts';

import type { InterfaceLocale } from '../../lib/i18n/locale.ts';

const assertStringIncludes = (actual: string, expected: string) => {
  if (!(actual.includes(expected))) expect.unreachable('Expected actual.includes(expected)');
};

const TEST_INTERFACE_LOCALE: InterfaceLocale = 'en-US';

type SentEmailMessage = {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly headers?: Record<string, string>;
};

function recordingEmailBinding(messages: SentEmailMessage[]) {
  return {
    send(message: SentEmailMessage): Promise<{ messageId: string }> {
      messages.push(message);
      return Promise.resolve({ messageId: `message-${messages.length}` });
    },
  };
}

function failFirstEmailBinding(messages: SentEmailMessage[]) {
  let attempts = 0;
  return {
    send(message: SentEmailMessage): Promise<{ messageId: string }> {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('simulated provider failure'));
      messages.push(message);
      return Promise.resolve({ messageId: `message-${messages.length}` });
    },
  };
}

function allowingRateLimitBinding(calls: string[]) {
  return {
    limit(input: { readonly key: string }): Promise<{ success: boolean }> {
      calls.push(input.key);
      return Promise.resolve({ success: true });
    },
  };
}

it('Cloudflare reset email contains only the single-use account link', async () => {
  const messages: SentEmailMessage[] = [];
  const sender = createTransactionalEmailSender({
    bindings: {
      QFLOW_EMAIL: recordingEmailBinding(messages),
      QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
    },
  });
  const result = await sender.sendPasswordResetEmail({
    email: 'registered@example.test',
    resetUrl: 'https://author.example.test/password/reset?token=opaque-secret',
    userId: 'user-1',
    tenantId: 'tenant-1',
    interfaceLocale: 'en-US' as const,
  });

  expect(result).toStrictEqual({ ok: true, messageId: 'message-1' });
  expect(messages.length).toStrictEqual(1);
  expect(messages[0].to).toStrictEqual('registered@example.test');
  expect(messages[0].subject).toStrictEqual('Reset your QFlowLearn password');
  expect(messages[0].headers).toStrictEqual({ 'X-QFlow-Email': 'password-reset' });
  assertStringIncludes(messages[0].text ?? '', 'opaque-secret');
  assertStringIncludes(messages[0].html ?? '', 'Set a new password');
});

it('reset request classifies persistence failures without attempting delivery', async () => {
  const email = parseEmailAddress('registered@example.test');
  if (!email) expect.unreachable('Expected email');
  let deliveryCalls = 0;
  const dependencies: PasswordResetRequestDependencies = {
    clock: { now: () => new Date('2026-08-11T12:00:00Z') },
    deliveries: {
      deliver: () => {
        deliveryCalls += 1;
        return Promise.resolve({ ok: true, code: 'delivered' });
      },
    },
    rateLimits: { check: () => Promise.resolve({ ok: true }) },
    records: {
      issue: () => Promise.resolve({ ok: false, code: 'persistence_unavailable' }),
    },
  };

  expect(
    await requestPasswordReset(
      { email, hostTenantId: null, clientIp: null, userAgent: null },
      dependencies,
    ),
  ).toStrictEqual({
    ok: false,
    code: 'persistence_unavailable',
  });
  expect(deliveryCalls).toStrictEqual(0);
});

it('reset request responds generically and emails a registered account at most once', async () => {
  requireQaDatabaseUrl(process.env.DATABASE_URL);
  const tenantId = crypto.randomUUID();
  const email = `reset-request-${tenantId.slice(0, 8)}@example.test`;
  const messages: SentEmailMessage[] = [];
  const rateLimitCalls: string[] = [];
  let userId: string | null = null;

  const runtime = {
    bindings: {
      QFLOW_APP_ORIGIN: 'https://author.example.test',
      QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      QFLOW_EMAIL: failFirstEmailBinding(messages),
      QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
      QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT: allowingRateLimitBinding(rateLimitCalls),
      QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT: allowingRateLimitBinding(rateLimitCalls),
    },
  };

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `t-${tenantId.slice(0, 8)}`,
      name: 'Reset request test',
    });
    const created = await provisionLocalUser({
      email,
      password: 'Registered account password phrase 2026',
      interfaceLocale: TEST_INTERFACE_LOCALE,
    });
    if (!created.ok) throw new Error('Expected reset request test user creation to succeed');
    userId = created.userId;
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });

    const unknownResponse = await requestReset(`missing-${email}`, runtime);
    const failedDeliveryResponse = await requestReset(email.toUpperCase(), runtime);
    const registeredResponse = await requestReset(email, runtime);
    const cooldownResponse = await requestReset(email, runtime);

    expect(unknownResponse.status).toStrictEqual(202);
    expect(failedDeliveryResponse.status).toStrictEqual(202);
    expect(registeredResponse.status).toStrictEqual(202);
    expect(cooldownResponse.status).toStrictEqual(202);
    const unknownBody = await unknownResponse.text();
    assertStringIncludes(unknownBody, 'request another link after 15 minutes');
    expect(await failedDeliveryResponse.text()).toStrictEqual(unknownBody);
    expect(await registeredResponse.text()).toStrictEqual(unknownBody);
    expect(await cooldownResponse.text()).toStrictEqual(unknownBody);
    expect(unknownBody.includes('resetToken')).toStrictEqual(false);
    expect(unknownBody.includes('resetUrl')).toStrictEqual(false);
    expect(messages.length).toStrictEqual(1);
    expect(messages[0].to).toStrictEqual(email);
    assertStringIncludes(
      messages[0].text ?? '',
      'https://author.example.test/password/reset?token=',
    );
    expect(rateLimitCalls.length).toStrictEqual(8);
  } finally {
    await cleanupAuthTestAccount({ tenantId, userId });
    await shutdownDb().catch(() => {});
  }
}, 30000);

function requestReset(email: string, runtime: QflowRuntime): Promise<Response> {
  const req = new Request('https://author.example.test/api/auth/password/reset/request', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '192.0.2.10',
    },
    body: JSON.stringify({ email }),
  });
  return Promise.resolve(
    resetRequestAuthRoute.handle(apiRequest(req, { runtime, clientIp: '192.0.2.10' })),
  );
}
