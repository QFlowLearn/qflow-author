import { expect, test } from 'vitest';
import { createCloudflareTransactionalEmailSender } from '../lib/services/email.ts';

for (const bcc of [undefined, 'notifications@example.test']) {
  test(`signup email copies only the explicitly configured recipient: ${bcc ?? 'none'}`, async () => {
    const messages: { readonly bcc?: string }[] = [];
    const sender = createCloudflareTransactionalEmailSender({
      bindings: {
        QFLOW_EMAIL_FROM: 'QFlow <hello@example.test>',
        ...(bcc ? { QFLOW_SIGNUP_NOTIFY_BCC: bcc } : {}),
        QFLOW_EMAIL: {
          send(message: { readonly bcc?: string }) {
            messages.push(message);
            return Promise.resolve({ messageId: 'test-message' });
          },
        },
      },
    });
    const result = await sender.sendSignupWelcomeEmail({
      email: 'teacher@example.test',
      displayName: 'Example Teacher',
      userId: 'test-user',
      tenantId: 'test-tenant',
      source: 'password_web',
      interfaceLocale: 'en-US',
    });
    expect(result).toEqual({ ok: true, messageId: 'test-message' });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.bcc).toBe(bcc);
  });
}
