import { expect, test as testCase } from 'vitest';

import { redact } from '../lib/redacted.ts';
import { PasswordResetEmailDeliveries } from '../lib/services/password_reset_delivery.ts';
import { buildPasswordResetEmail } from '../lib/services/email.ts';

testCase('password-reset delivery keeps the snapshotted locale across retries', async () => {
  let currentAccountLocale = 'es-419';
  const snapshottedLocale = 'es-419';
  let attempts = 0;
  let id = 0;
  const sent: Array<{ locale: string; subject: string; text?: string; html?: string }> = [];
  const released: string[] = [];
  const completed: string[] = [];
  const service = new PasswordResetEmailDeliveries({
    appOrigin: new URL('https://app.example.test'),
    clock: { now: () => new Date('2026-09-04T12:00:00Z') },
    decryptToken: () => Promise.resolve(redact('opaque-token')),
    generateId: () => `lease-${++id}`,
    email: {
      sendSignupWelcomeEmail: () => Promise.resolve({ ok: false, code: 'disabled_local' }),
      sendPasswordResetEmail: (input) => {
        const message = buildPasswordResetEmail(input, 'from@example.test');
        sent.push({
          locale: input.interfaceLocale,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        attempts++;
        return Promise.resolve(
          attempts === 1 ? { ok: false, code: 'send_failed' } : { ok: true, messageId: 'sent' },
        );
      },
    },
    records: {
      listPendingDeliveryIds: () => Promise.resolve({ ok: true, deliveryIds: ['delivery'] }),
      claimDelivery: () =>
        Promise.resolve({
          ok: true,
          delivery: {
            id: 'delivery',
            resetTokenId: 'reset',
            userId: 'user',
            tenantId: null,
            email: 'user@example.test',
            encryptedToken: 'encrypted',
            interfaceLocale: snapshottedLocale,
          },
        }),
      releaseDelivery: ({ deliveryId, leaseToken }) => {
        released.push(`${deliveryId}:${leaseToken}`);
        return Promise.resolve({ ok: true });
      },
      completeDelivery: ({ deliveryId, leaseToken }) => {
        completed.push(`${deliveryId}:${leaseToken}`);
        return Promise.resolve({ ok: true });
      },
      invalidateDelivery: () => Promise.resolve({ ok: true }),
    },
  });
  expect((await service.deliver({ deliveryId: 'delivery', onEmailFailure: 'retry' })).code)
    .toStrictEqual('email_delivery_failed');
  currentAccountLocale = 'en-US';
  expect(currentAccountLocale).toStrictEqual('en-US');
  expect((await service.deliver({ deliveryId: 'delivery', onEmailFailure: 'retry' })).code)
    .toStrictEqual('delivered');
  const expected = buildPasswordResetEmail({
    email: 'user@example.test',
    resetUrl: 'https://app.example.test/password/reset?token=opaque-token',
    userId: 'user',
    tenantId: null,
    interfaceLocale: 'es-419',
  }, 'from@example.test');
  expect(sent).toStrictEqual([
    { locale: 'es-419', subject: expected.subject, text: expected.text, html: expected.html },
    { locale: 'es-419', subject: expected.subject, text: expected.text, html: expected.html },
  ]);
  expect(sent.some((message) => message.text?.includes('A password reset was requested')))
    .toStrictEqual(false);
  expect(released).toStrictEqual(['delivery:lease-1']);
  expect(completed).toStrictEqual(['delivery:lease-2']);
});
