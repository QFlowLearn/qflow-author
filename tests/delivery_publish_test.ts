import { expect, test as testCase } from 'vitest';

import {
  buildDeliveryPublishRequest,
  DeliveryPublishConfigurationError,
  DeliveryPublishRequestError,
  getDeliveryPublishCapability,
  getDeliveryPublishUrl,
  mergeDeliveryPublishMetadata,
  publishAssessmentToDelivery,
} from '../lib/delivery_publish.ts';

testCase('delivery handoff uses the QTI format with a frozen receipt URL', () => {
  const request = buildDeliveryPublishRequest(
    { tenantId: 'qflow-tenant-1', userId: 'user-1', role: 'admin' },
    { id: 'assessment-1', title: 'Unit Test #1' },
    'https://qflow.example/api/assessments/assessment-1/package?receiptId=receipt-1',
    {
      publishId: 'qflow-11111111-1111-4111-8111-111111111111',
      now: new Date('2026-04-28T12:00:00.000Z'),
    },
  );

  expect(request.publishId).toStrictEqual('qflow-11111111-1111-4111-8111-111111111111');
  expect(request.qflowTenantId).toStrictEqual('qflow-tenant-1');
  expect(request.qflowAssessmentId).toStrictEqual('assessment-1');
  expect(request.packageName).toStrictEqual('unit-test-1.zip');
  expect(request.exportFormat).toStrictEqual('qti3');
  expect(request.packageUrl).toStrictEqual(
    'https://qflow.example/api/assessments/assessment-1/package?receiptId=receipt-1',
  );
  expect(request.issuedAt).toStrictEqual('2026-04-28T12:00:00.000Z');
});

testCase(
  'publishAssessmentToDelivery posts signed JSON to configured delivery endpoint',
  async () => {
    const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
    const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
    try {
      process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
      process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const response = await publishAssessmentToDelivery(
        {
          publishId: 'publish-1',
          qflowTenantId: 'tenant-1',
          qflowAssessmentId: 'assessment-1',
          packageUrl: 'https://qflow.example/package.zip',
        },
        ((url, init) => {
          calls.push({ url: String(url), init });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                publishId: 'publish-1',
                status: 'published',
                version: {
                  assessmentId: 'delivery-assessment-1',
                  assessmentVersionId: 'version-1',
                },
                links: {
                  previewUrl: 'https://delivery.example/session',
                  adminUrl: 'https://delivery.example/launch',
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }) as typeof fetch,
      );

      expect(response.version.assessmentVersionId).toStrictEqual('version-1');
      expect(calls.length).toStrictEqual(1);
      expect(calls[0].url).toStrictEqual('https://delivery.example/internal/qflow/publish');
      expect((calls[0].init?.headers as Record<string, string>)['content-type']).toStrictEqual(
        'application/json',
      );
      expect((calls[0].init?.headers as Record<string, string>)['x-harbor-qflow-signature'])
        .toStrictEqual('36419d02ff69ab86d4e13ea83792735381ca7564cec3022148091b1a937201bb');
      expect((calls[0].init?.headers as Record<string, string>)['x-qflow-delivery-signature'])
        .toStrictEqual(undefined);
    } finally {
      restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
      restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
    }
  },
);

testCase('publishAssessmentToDelivery requires endpoint and secret together', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
    delete process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
    await expect(
      Promise.resolve().then(() =>
        publishAssessmentToDelivery({
          publishId: 'publish-1',
          qflowTenantId: 'tenant-1',
          qflowAssessmentId: 'assessment-1',
          packageUrl: 'https://qflow.example/package.zip',
        })
      ),
    ).rejects.toBeInstanceOf(DeliveryPublishConfigurationError);
  } finally {
    restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase('publishAssessmentToDelivery rejects a response for another publish request', async () => {
  await withDeliveryPublishConfig(async () => {
    const error = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        publishAssessmentToDelivery(
          deliveryPublishRequest(),
          respondingWith({
            publishId: 'publish-other',
            status: 'published',
            version: validDeliveryVersion(),
          }),
        )
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof DeliveryPublishRequestError)) {
        expect.unreachable('Expected DeliveryPublishRequestError');
      }
      expect(caught.message).toContain('invalid delivery publish response');
      return caught;
    })();

    expect(error.status).toStrictEqual(502);
    expect(error.code).toStrictEqual('delivery_publish_invalid_response');
  });
});

testCase('publishAssessmentToDelivery rejects incomplete successful responses', async () => {
  await withDeliveryPublishConfig(async () => {
    await expect(
      Promise.resolve().then(() =>
        publishAssessmentToDelivery(
          deliveryPublishRequest(),
          respondingWith({
            publishId: 'publish-1',
            status: 'published',
            version: { assessmentId: 'delivery-assessment-1' },
          }),
        )
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof DeliveryPublishRequestError &&
      caught.message.includes('invalid delivery publish response')
    );
  });
});

testCase(
  'publishAssessmentToDelivery rejects links outside the configured Harbor origin',
  async () => {
    await withDeliveryPublishConfig(async () => {
      await expect(
        Promise.resolve().then(() =>
          publishAssessmentToDelivery(
            deliveryPublishRequest(),
            respondingWith({
              publishId: 'publish-1',
              status: 'published',
              version: validDeliveryVersion(),
              links: { previewUrl: 'https://attacker.example/session' },
            }),
          )
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof DeliveryPublishRequestError &&
        caught.message.includes('invalid delivery publish response')
      );
    });
  },
);

testCase(
  'getDeliveryPublishCapability reports unavailable when Harbor config is absent',
  async () => {
    const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
    const previousCapabilityUrl = process.env['QFLOW_DELIVERY_CAPABILITY_URL'];
    const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
    try {
      delete process.env['QFLOW_DELIVERY_PUBLISH_URL'];
      delete process.env['QFLOW_DELIVERY_CAPABILITY_URL'];
      delete process.env['QFLOW_DELIVERY_SIGNING_SECRET'];

      const capability = await getDeliveryPublishCapability();

      expect(capability.enabled).toStrictEqual(false);
      expect(capability.status).toStrictEqual('not_configured');
    } finally {
      restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
      restoreEnv('QFLOW_DELIVERY_CAPABILITY_URL', previousCapabilityUrl);
      restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
    }
  },
);

testCase(
  'getDeliveryPublishCapability reports available when Harbor config is complete',
  async () => {
    const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
    const previousCapabilityUrl = process.env['QFLOW_DELIVERY_CAPABILITY_URL'];
    const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
    try {
      process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
      process.env['QFLOW_DELIVERY_CAPABILITY_URL'] =
        'https://delivery.example/internal/qflow/capability';
      process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

      const capability = await getDeliveryPublishCapability();

      expect(capability.enabled).toStrictEqual(true);
      expect(capability.status).toStrictEqual('configured');
    } finally {
      restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
      restoreEnv('QFLOW_DELIVERY_CAPABILITY_URL', previousCapabilityUrl);
      restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
    }
  },
);

testCase('getDeliveryPublishCapability checks Harbor tenant linkage', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
  const previousCapabilityUrl = process.env['QFLOW_DELIVERY_CAPABILITY_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
    process.env['QFLOW_DELIVERY_CAPABILITY_URL'] =
      'https://delivery.example/internal/qflow/capability';
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const capability = await getDeliveryPublishCapability(
      'tenant-1',
      ((input, init) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              enabled: true,
              qflowTenantId: 'tenant-1',
              tenantId: 'harbor-tenant-1',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }) as typeof fetch,
    );

    expect(capability.enabled).toStrictEqual(true);
    expect(capability.status).toStrictEqual('configured');
    expect(calls.length).toStrictEqual(1);
    expect(calls[0].url).toStrictEqual('https://delivery.example/internal/qflow/capability');
    expect(
      ((calls[0].init?.headers ?? {}) as Record<string, string>)['x-harbor-qflow-signature']
        ?.length,
    ).toStrictEqual(64);
  } finally {
    restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_CAPABILITY_URL', previousCapabilityUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase('getDeliveryPublishCapability reports missing Harbor tenant link', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
  const previousCapabilityUrl = process.env['QFLOW_DELIVERY_CAPABILITY_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
    process.env['QFLOW_DELIVERY_CAPABILITY_URL'] =
      'https://delivery.example/internal/qflow/capability';
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

    const capability = await getDeliveryPublishCapability(
      'tenant-1',
      (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              enabled: false,
              qflowTenantId: 'tenant-1',
              error: 'qflow_tenant_not_linked',
              message: 'QFlow tenant is not linked to an active QFlowLearn Delivery subscription',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
        )) as typeof fetch,
    );

    expect(capability.enabled).toStrictEqual(false);
    expect(capability.status).toStrictEqual('not_linked');
    expect(capability.httpStatus).toStrictEqual(403);
    expect(capability.qflowTenantId).toStrictEqual('tenant-1');
  } finally {
    restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_CAPABILITY_URL', previousCapabilityUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase('publishAssessmentToDelivery explains missing Harbor tenant link', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';

    const err = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        publishAssessmentToDelivery(
          {
            publishId: 'publish-1',
            qflowTenantId: 'tenant-1',
            qflowAssessmentId: 'assessment-1',
            packageUrl: 'https://qflow.example/package.zip',
          },
          (() =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  error: 'QFlow tenant is not linked to an active QFlowLearn Delivery subscription',
                }),
                { status: 403, headers: { 'content-type': 'application/json' } },
              ),
            )) as typeof fetch,
        )
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof DeliveryPublishRequestError)) {
        expect.unreachable('Expected DeliveryPublishRequestError');
      }
      expect(caught.message).toContain('QFlowLearn Delivery is not connected for this workspace.');
      return caught;
    })();

    expect(err.status).toStrictEqual(403);
    expect(err.code).toStrictEqual('delivery_publish_tenant_not_linked');
  } finally {
    restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase('delivery service access codes survive as actionable publication failures', async () => {
  const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'test-signing-secret';
    for (
      const [error, expectedCode] of [
        ['qflow_tenant_not_linked', 'delivery_publish_tenant_not_linked'],
        ['qflow_publish_not_entitled', 'delivery_publish_not_entitled'],
      ]
    ) {
      const caught: unknown = await publishAssessmentToDelivery({
        publishId: 'publish-1',
        qflowTenantId: 'tenant-1',
        qflowAssessmentId: 'assessment-1',
        packageUrl: 'https://qflow.example/package.zip',
      }, () => Promise.resolve(new Response(JSON.stringify({ error }), { status: 403 }))).then(
        () => expect.unreachable('Expected delivery access rejection'),
        (cause: unknown) => cause,
      );
      if (!(caught instanceof DeliveryPublishRequestError)) {
        expect.unreachable('Expected a typed delivery rejection');
      }
      expect(caught.code).toBe(expectedCode);
    }
  } finally {
    restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
});

testCase('mergeDeliveryPublishMetadata stores latest receipt and bounded history', () => {
  const metadata = mergeDeliveryPublishMetadata(
    { existing: true },
    {
      publishId: 'publish-1',
      status: 'published',
      version: {
        assessmentId: 'delivery-assessment-1',
        assessmentVersionId: 'version-1',
      },
      links: {
        previewUrl: 'https://delivery.example/preview',
      },
    },
    new Date('2026-04-28T12:00:00.000Z'),
  );

  expect(metadata.existing).toStrictEqual(true);
  expect((metadata.delivery as Record<string, unknown>)?.latestPublish).toStrictEqual({
    publishId: 'publish-1',
    status: 'published',
    assessmentId: 'delivery-assessment-1',
    assessmentVersionId: 'version-1',
    previewUrl: 'https://delivery.example/preview',
    adminUrl: undefined,
    sourcePackageSha256: undefined,
    publishedAt: '2026-04-28T12:00:00.000Z',
  });
});

testCase('getDeliveryPublishUrl rejects invalid configured URLs', () => {
  const previous = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
  try {
    process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'delivery.example/internal/qflow/publish';
    expect(() => getDeliveryPublishUrl()).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error &&
        caught.message.includes('QFLOW_DELIVERY_PUBLISH_URL must be an absolute http(s) URL.')
      ),
    );
  } finally {
    restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previous);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function withDeliveryPublishConfig(run: () => Promise<void>): Promise<void> {
  const previousUrl = process.env['QFLOW_DELIVERY_PUBLISH_URL'];
  const previousSecret = process.env['QFLOW_DELIVERY_SIGNING_SECRET'];
  try {
    process.env['QFLOW_DELIVERY_PUBLISH_URL'] = 'https://delivery.example/internal/qflow/publish';
    process.env['QFLOW_DELIVERY_SIGNING_SECRET'] = 'secret';
    await run();
  } finally {
    restoreEnv('QFLOW_DELIVERY_PUBLISH_URL', previousUrl);
    restoreEnv('QFLOW_DELIVERY_SIGNING_SECRET', previousSecret);
  }
}

function deliveryPublishRequest() {
  return {
    publishId: 'publish-1',
    qflowTenantId: 'tenant-1',
    qflowAssessmentId: 'assessment-1',
    packageUrl: 'https://qflow.example/package.zip',
  };
}

function validDeliveryVersion() {
  return {
    assessmentId: 'delivery-assessment-1',
    assessmentVersionId: 'version-1',
  };
}

function respondingWith(payload: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      }),
    )) as typeof fetch;
}
