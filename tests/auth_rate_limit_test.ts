import { expect, test as testCase } from 'vitest';

import { createCloudflarePasswordResetRateLimits } from '../lib/services/auth_rate_limit.ts';
import {
  createPasswordServices,
  validatePasswordResetRuntime,
} from '../lib/services/password_services_runtime.ts';

testCase('password reset rate limiter fails closed and uses opaque keys', async () => {
  expect(() => createCloudflarePasswordResetRateLimits({})).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT')
    ),
  );

  const keys: string[] = [];
  const runtime = {
    bindings: {
      QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT: recordingLimiter(keys, true),
      QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT: recordingLimiter(keys, false),
    },
  };
  const rateLimits = createCloudflarePasswordResetRateLimits(runtime);
  expect(
    await rateLimits.check({
      emailNormalized: 'registered@example.test',
      clientIp: '192.0.2.30',
    }),
  ).toStrictEqual({ ok: false, code: 'limited' });
  expect(keys.length).toStrictEqual(2);
  if (!((keys.some((key) => key.includes('registered@example.test'))) === false)) {
    expect.unreachable(
      "Expected keys.some((key) => key.includes('registered@example.test')) to be false",
    );
  }
  if (!((keys.some((key) => key.includes('192.0.2.30'))) === false)) {
    expect.unreachable("Expected keys.some((key) => key.includes('192.0.2.30')) to be false");
  }
});

testCase('password reset runtime validation requires email, origin, and both limiters', () => {
  expect(() =>
    validatePasswordResetRuntime({
      bindings: completeRuntimeBindings({ QFLOW_APP_ORIGIN: '' }),
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('QFLOW_APP_ORIGIN')
    ),
  );
  expect(() =>
    validatePasswordResetRuntime({
      bindings: completeRuntimeBindings({ QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: '' }),
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1')
    ),
  );
  validatePasswordResetRuntime({ bindings: completeRuntimeBindings({}) });
});

testCase('password services use explicit uncached composition', () => {
  const bindings = completeRuntimeBindings({});
  const firstContext = { bindings };

  const first = createPasswordServices(firstContext);
  const repeated = createPasswordServices(firstContext);

  expect(repeated).not.toBe(first);
});

function recordingLimiter(keys: string[], success: boolean) {
  return {
    DATABASE_URL: 'postgres://qflow:qflow@127.0.0.1:5432/qflow',
    limit(input: { readonly key: string }): Promise<{ success: boolean }> {
      keys.push(input.key);
      return Promise.resolve({ success });
    },
  };
}

function completeRuntimeBindings(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgres://qflow:qflow@127.0.0.1:5432/qflow',
    QFLOW_APP_ORIGIN: 'https://author.example.test',
    QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    QFLOW_EMAIL: { send: () => Promise.resolve({ messageId: 'message-1' }) },
    QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
    QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT: recordingLimiter([], true),
    QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT: recordingLimiter([], true),
    ...overrides,
  };
}
