import { expect, test as testCase } from 'vitest';

import {
  buildDeliverySsoLaunchRedirectUrl,
  DeliveryLaunchConfigurationError,
  fetchDeliveryAssignmentState,
  QFLOW_SSO_LAUNCH_TOKEN_AUDIENCE,
  QFLOW_SSO_LAUNCH_TOKEN_ISSUER,
  signDeliveryLaunchToken,
} from '../lib/delivery_launch.ts';
import { decodeBase64Url } from '../lib/delivery_signature.ts';

const QFLOW_SSO_VECTOR_TOKEN =
  'eyJpc3MiOiJxZmxvd2xlYXJuIiwiYXVkIjoiaGFyYm9yOnFmbG93LXNzby1sYXVuY2giLCJzdWIiOiJ1c2VyLTEiLCJqdGkiOiJsYXVuY2gtMSIsImlhdCI6MTc4MTk1NjgwMCwiZXhwIjoxNzgxOTU3MTAwLCJxZmxvd1RlbmFudElkIjoidGVuYW50LTEiLCJhc3NpZ25tZW50SWQiOiJhc3NpZ25tZW50LTEiLCJsZWFybmVyIjp7InN1YmplY3QiOiJ1c2VyLTEiLCJkaXNwbGF5TmFtZSI6Ik1vcmdhbiBMZWUiLCJlbWFpbCI6Im1vcmdhbkBleGFtcGxlLmVkdSJ9fQ.6c6303995a3c7b2748beb385fa6805749ded5828fc80431cc729e096aba93bd8';

testCase('signDeliveryLaunchToken creates a Harbor-compatible signed launch token', async () => {
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

    const token = await signDeliveryLaunchToken({
      qflowTenantId: 'tenant-1',
      assignmentId: 'assignment-1',
      tokenId: 'launch-1',
      now: new Date('2026-06-20T12:00:00.000Z'),
      learner: {
        subject: 'user-1',
        displayName: 'Morgan Lee',
        email: 'morgan@example.edu',
      },
    });
    const [payload] = token.split('.', 2);

    expect(token).toStrictEqual(QFLOW_SSO_VECTOR_TOKEN);
    expect(JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)))).toStrictEqual({
      iss: QFLOW_SSO_LAUNCH_TOKEN_ISSUER,
      aud: QFLOW_SSO_LAUNCH_TOKEN_AUDIENCE,
      sub: 'user-1',
      jti: 'launch-1',
      iat: 1781956800,
      exp: 1781957100,
      qflowTenantId: 'tenant-1',
      assignmentId: 'assignment-1',
      learner: {
        subject: 'user-1',
        displayName: 'Morgan Lee',
        email: 'morgan@example.edu',
      },
    });
  } finally {
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase('buildDeliverySsoLaunchRedirectUrl requires the dedicated Harbor launch URL', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_SSO_LAUNCH_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    delete process.env['QFLOW_DELIVERY_SSO_LAUNCH_URL'];
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

    await expect(
      Promise.resolve().then(() =>
        buildDeliverySsoLaunchRedirectUrl({
          qflowTenantId: 'tenant-1',
          assignmentId: 'assignment-1',
          learner: { subject: 'user-1', displayName: 'Morgan Lee' },
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof DeliveryLaunchConfigurationError &&
      caught.message.includes('QFLOW_DELIVERY_SSO_LAUNCH_URL must be configured.')
    );
  } finally {
    restoreEnv('QFLOW_DELIVERY_SSO_LAUNCH_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase(
  'buildDeliverySsoLaunchRedirectUrl appends only the signed token to Harbor launch URL',
  async () => {
    const previousUrl = process.env['QFLOW_DELIVERY_SSO_LAUNCH_URL'];
    const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
    try {
      process.env['QFLOW_DELIVERY_SSO_LAUNCH_URL'] = 'https://take.example/api/qflow/sso/launch';
      process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

      const redirectUrl = new URL(
        await buildDeliverySsoLaunchRedirectUrl({
          qflowTenantId: 'tenant-1',
          assignmentId: 'assignment-1',
          tokenId: 'launch-1',
          now: new Date('2026-06-20T12:00:00.000Z'),
          learner: { subject: 'user-1', displayName: 'Morgan Lee' },
        }),
      );

      expect(redirectUrl.origin).toStrictEqual('https://take.example');
      expect(redirectUrl.pathname).toStrictEqual('/api/qflow/sso/launch');
      expect(Boolean(redirectUrl.searchParams.get('token'))).toStrictEqual(true);
      expect(Array.from(redirectUrl.searchParams.keys())).toStrictEqual(['token']);
    } finally {
      restoreEnv('QFLOW_DELIVERY_SSO_LAUNCH_URL', previousUrl);
      restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
    }
  },
);

testCase('fetchDeliveryAssignmentState posts a signed Harbor state request', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_STATE_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  try {
    process.env['QFLOW_DELIVERY_STATE_URL'] = 'https://take.example/internal/qflow/state';
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

    const state = await fetchDeliveryAssignmentState(
      {
        assignmentId: 'assignment-1',
        qflowTenantId: 'tenant-1',
      },
      ((url, init) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(Response.json({
          assignment: {
            assignmentId: 'assignment-1',
            assessmentId: 'assessment-1',
            assessmentVersionId: 'version-1',
            title: 'Delivery assignment',
            status: 'active',
            updatedAt: '2026-06-20T12:00:00.000Z',
          },
          latestResult: null,
          export: null,
          remediation: null,
        }));
      }) as typeof fetch,
    );

    expect(state.assignment.assignmentId).toStrictEqual('assignment-1');
    expect(calls[0].url).toStrictEqual('https://take.example/internal/qflow/state');
    expect(calls[0].init?.method).toStrictEqual('POST');
    expect(calls[0].init?.body).toStrictEqual(
      '{"assignmentId":"assignment-1","qflowTenantId":"tenant-1"}',
    );
    const headers = new Headers(calls[0].init?.headers);
    expect(typeof headers.get('x-harbor-qflow-signature')).toStrictEqual('string');
    expect(headers.get('x-qflow-delivery-signature')).toBeNull();
  } finally {
    restoreEnv('QFLOW_DELIVERY_STATE_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase('fetchDeliveryAssignmentState requires the dedicated Harbor state URL', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_STATE_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    delete process.env['QFLOW_DELIVERY_STATE_URL'];
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

    await expect(
      Promise.resolve().then(() =>
        fetchDeliveryAssignmentState({ assignmentId: 'assignment-1', qflowTenantId: 'tenant-1' })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof DeliveryLaunchConfigurationError &&
      caught.message.includes('QFLOW_DELIVERY_STATE_URL must be configured.')
    );
  } finally {
    restoreEnv('QFLOW_DELIVERY_STATE_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
