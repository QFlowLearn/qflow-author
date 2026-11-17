import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  authIdentities,
  authSessions,
  organizationMemberships,
  tenants,
  userPasswords,
  users,
} from '../lib/db/schema.ts';
import { createTransactionalEmailSender } from '../lib/services/email.ts';
import { completePasswordSignup } from '../lib/services/password_signup.ts';
import { signupAuthRoute as apiSignupHandlerEndpoint } from '../lib/http/routes/auth_api/signup.ts';
import { signupPageRoute as webSignupHandlerEndpoint } from '../lib/http/routes/auth_pages/signup.tsx';
import {
  type HttpEndpoint,
  invokeHttpMethod,
  invokeHttpRoute,
  makeHttpRequest,
} from './helpers/http_route.ts';

const apiSignupHandler = apiSignupHandlerEndpoint.handle;
const webSignupHandler = webSignupHandlerEndpoint.handle;

type SentEmailMessage = {
  readonly to: string;
  readonly from: string;
  readonly bcc?: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
};

function createRecordingEmailBinding(messages: SentEmailMessage[]) {
  return {
    send(message: SentEmailMessage): Promise<{ messageId: string }> {
      messages.push(message);
      return Promise.resolve({ messageId: `message-${messages.length}` });
    },
  };
}

testCase(
  'signup welcome email sends beta welcome copy with explicitly configured BCC',
  async () => {
    const messages: SentEmailMessage[] = [];

    const sender = createTransactionalEmailSender({
      bindings: {
        QFLOW_EMAIL: createRecordingEmailBinding(messages),
        QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
        QFLOW_SIGNUP_NOTIFY_BCC: 'notifications@example.test',
      },
    });
    const result = await sender.sendSignupWelcomeEmail({
      email: 'teacher@example.com',
      displayName: 'Teacher Example',
      userId: 'user-1',
      tenantId: 'tenant-1',
      source: 'password_web',
      interfaceLocale: 'en-US' as const,
    });

    expect(result).toStrictEqual({ ok: true, messageId: 'message-1' });
    expect(messages.length).toStrictEqual(1);
    const message = messages[0];
    expect(message.to).toStrictEqual('teacher@example.com');
    expect(message.from).toStrictEqual('QFlowLearn <hello@qflowlearn.com>');
    expect(message.bcc).toStrictEqual('notifications@example.test');
    expect(message.subject).toStrictEqual('Welcome to QFlowLearn beta');
    expect(message.text ?? '').toContain('QFlowLearn is still in beta');
    expect(message.html ?? '').toContain('QFlowLearn is still in beta');
  },
);

testCase(
  'local transactional email is disabled only through the explicit adapter flag',
  async () => {
    expect(() =>
      createTransactionalEmailSender({
        bindings: { QFLOW_LOCAL_TRANSACTIONAL_EMAIL_DISABLED: 'false' },
      })
    ).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error &&
        caught.message.includes('Missing required Cloudflare binding QFLOW_EMAIL')
      ),
    );

    const sender = createTransactionalEmailSender({
      bindings: { QFLOW_LOCAL_TRANSACTIONAL_EMAIL_DISABLED: 'true' },
    });
    expect(
      await sender.sendSignupWelcomeEmail({
        email: 'local@example.test',
        displayName: null,
        userId: 'local-user',
        tenantId: 'local-tenant',
        source: 'password_web',
        interfaceLocale: 'en-US' as const,
      }),
    ).toStrictEqual({ ok: false, code: 'disabled_local' });
  },
);

testCase(
  'signup reports account_created_session_failed when provisioning outlives session creation',
  async () => {
    const email = `session-failure-${crypto.randomUUID()}@example.test`;
    const createdUserIds: string[] = [];

    try {
      const result = await completePasswordSignup({
        email,
        password: 'A strong partial signup password 2026',
        displayName: 'Partial Signup Teacher',
        hostTenantId: null,
        userAgent: 'signup-test',
        clientIp: '192.0.2.80',
        replaceToken: null,
        welcomeSource: 'password_api',
        interfaceLocale: 'en-US' as const,
      }, {
        createSession: () => Promise.reject(new Error('session store unavailable')),
        sendWelcomeEmail: () => Promise.resolve({ ok: true, messageId: 'welcome-partial' }),
      });

      expect(result.ok).toStrictEqual(true);
      if (!result.ok) throw new Error('expected account creation to succeed');
      createdUserIds.push(result.userId);
      expect(result.code).toStrictEqual('account_created_session_failed');
      const sessions = await db.select({ id: authSessions.id }).from(authSessions).where(
        eq(authSessions.userId, result.userId),
      );
      expect(sessions).toStrictEqual([]);
    } finally {
      await cleanupUsers(createdUserIds);
      await shutdownDb().catch(() => {});
    }
  },
);

testCase('api signup sends welcome email and still succeeds if email send fails', async () => {
  const successEmail = `api-${crypto.randomUUID()}@example.test`;
  const failureEmail = `api-failure-${crypto.randomUUID()}@example.test`;
  const messages: SentEmailMessage[] = [];
  const createdUserIds: string[] = [];

  try {
    const successReq = new Request('https://qflowlearn.com/api/auth/signup', {
      ...{ duplex: 'half' },
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: successEmail,
        password: 'A strong API signup password 2026',
        name: 'API Teacher',
      }),
    });
    const successRes = await invokeHttpRoute(
      apiSignupHandler,
      makeHttpRequest(successReq, {
        omitAuth: true,
        state: {
          interfaceLocale: 'en-US' as const,
          runtime: {
            bindings: {
              QFLOW_EMAIL: createRecordingEmailBinding(messages),
              QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
            },
          },
        },
      }),
    );
    expect(successRes.status).toStrictEqual(200);
    const successBody = await successRes.json() as {
      code?: string;
      userId?: string;
      tenantId?: string;
    };
    if (successBody.userId) createdUserIds.push(successBody.userId);
    expect(successBody.code).toStrictEqual('account_created');
    expect(messages.length).toStrictEqual(1);
    expect(messages[0].to).toStrictEqual(successEmail);

    const failureReq = new Request('https://qflowlearn.com/api/auth/signup', {
      ...{ duplex: 'half' },
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: failureEmail,
        password: 'A strong failure signup password 2026',
        name: 'Failure Teacher',
      }),
    });
    const failureRes = await invokeHttpRoute(
      apiSignupHandler,
      makeHttpRequest(failureReq, {
        omitAuth: true,
        state: {
          interfaceLocale: 'en-US' as const,
          runtime: {
            bindings: {
              QFLOW_EMAIL: {
                send(): Promise<{ messageId: string }> {
                  return Promise.reject(new Error('provider unavailable'));
                },
              },
              QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
            },
          },
        },
      }),
    );
    expect(failureRes.status).toStrictEqual(200);
    const failureBody = await failureRes.json() as {
      code?: string;
      userId?: string;
      tenantId?: string;
    };
    if (failureBody.userId) createdUserIds.push(failureBody.userId);
    expect(failureBody.code).toStrictEqual('account_created');
  } finally {
    await cleanupUsers(createdUserIds);
    await shutdownDb().catch(() => {});
  }
});

testCase('web signup sends welcome email before returning to the requested workflow', async () => {
  const email = `web-${crypto.randomUUID()}@example.test`;
  const messages: SentEmailMessage[] = [];
  const createdUserIds: string[] = [];

  try {
    const form = new FormData();
    form.set('name', 'Web Teacher');
    form.set('email', email);
    form.set('password', 'A strong web signup password 2026');
    form.set('next', '/assessments/new?intent=recover&source=respondus');

    const req = new Request('https://qflowlearn.com/signup', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: form,
    });
    const res = await invokeHttpMethod(
      webSignupHandler as HttpEndpoint,
      'POST',
      makeHttpRequest(req, {
        omitAuth: true,
        state: {
          interfaceLocale: 'en-US' as const,
          runtime: {
            bindings: {
              QFLOW_EMAIL: createRecordingEmailBinding(messages),
              QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
            },
          },
        },
      }),
    );
    expect(res.status).toStrictEqual(302);
    expect(res.headers.get('location')).toStrictEqual(
      '/assessments/new?intent=recover&source=respondus',
    );
    expect(messages.length).toStrictEqual(1);
    expect(messages[0].to).toStrictEqual(email);

    const row = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
      .limit(1);
    if (row[0]?.id) createdUserIds.push(row[0].id);
  } finally {
    await cleanupUsers(createdUserIds);
    await shutdownDb().catch(() => {});
  }
});

async function cleanupUsers(userIds: ReadonlyArray<string>) {
  for (const userId of userIds) {
    await db.delete(authSessions).where(eq(authSessions.userId, userId));
    await db.delete(authIdentities).where(eq(authIdentities.userId, userId));
    await db.delete(userPasswords).where(eq(userPasswords.userId, userId));
    const memberships = await db.select({ tenantId: organizationMemberships.tenantId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    for (const membership of memberships) {
      await db.delete(tenants).where(eq(tenants.id, membership.tenantId));
    }
  }
}
