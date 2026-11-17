import { expect, test as testCase } from 'vitest';

import { requestAssessmentDeliveryPublication } from '../lib/client/delivery_publish.ts';

const PREFLIGHT_ID = 'a'.repeat(64);
const ACKNOWLEDGEMENT = 'b'.repeat(64);

testCase(
  'delivery publish discloses package warnings and retries with exact approval',
  async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const request = new Request(new URL(String(input), 'https://qflow.example'), init);
      requests.push(request);
      if (requests.length === 1) {
        return Promise.resolve(jsonResponse({
          error: 'delivery_export_warnings_not_acknowledged',
          message: 'Review package warnings.',
          preflight: {
            preflightId: PREFLIGHT_ID,
            acknowledgementToken: ACKNOWLEDGEMENT,
            warningCodes: ['qti3_conformance.not_run', 'future.warning-2'],
          },
        }, 409));
      }
      return Promise.resolve(jsonResponse({
        ok: true,
        assessmentId: 'assessment-1',
        assessmentVersionId: 'version-1',
        publishedAt: '2026-10-30T12:00:00.000Z',
        previewUrl: 'https://delivery.example/preview',
      }));
    };
    let confirmation = '';
    let formatterCount = 0;
    let confirmCount = 0;
    const warningCodes = ['qti3_conformance.not_run', 'future.warning-2'];

    const result = await requestAssessmentDeliveryPublication('assessment-1', {
      fetchImpl,
      formatWarnings(codes) {
        formatterCount += 1;
        expect(codes).toStrictEqual(warningCodes);
        return 'Aviso UTF-8 ⚠';
      },
      confirmWarnings(message) {
        confirmCount += 1;
        confirmation = message;
        return true;
      },
    });

    expect(result).toStrictEqual({
      _tag: 'Published',
      payload: {
        previewUrl: 'https://delivery.example/preview',
        assessmentVersionId: 'version-1',
        publishedAt: '2026-10-30T12:00:00.000Z',
      },
    });
    expect(requests.length).toStrictEqual(2);
    expect(requests.map((request) => request.url)).toStrictEqual([
      'https://qflow.example/api/assessments/assessment-1/publish/delivery',
      'https://qflow.example/api/assessments/assessment-1/publish/delivery',
    ]);
    expect(confirmation).toStrictEqual('Aviso UTF-8 ⚠');
    expect(formatterCount).toStrictEqual(1);
    expect(confirmCount).toStrictEqual(1);
    expect(requests[0].method).toStrictEqual('POST');
    expect(await requests[0].text()).toStrictEqual('');
    expect(requests[0].headers.has('content-type')).toStrictEqual(false);
    expect(requests[1].method).toStrictEqual('POST');
    expect(requests[1].headers.get('content-type')).toStrictEqual('application/json');
    expect(await requests[1].json()).toStrictEqual({
      preflightId: PREFLIGHT_ID,
      acknowledgement: ACKNOWLEDGEMENT,
    });
  },
);

testCase('delivery publish stops without a second request when warnings are declined', async () => {
  let requestCount = 0;
  let formatterCount = 0;
  let confirmation = '';
  let confirmCount = 0;
  const result = await requestAssessmentDeliveryPublication('assessment-1', {
    fetchImpl() {
      requestCount += 1;
      return Promise.resolve(jsonResponse({
        error: 'delivery_export_warnings_not_acknowledged',
        preflight: {
          preflightId: PREFLIGHT_ID,
          acknowledgementToken: ACKNOWLEDGEMENT,
          warningCodes: ['qti3_conformance.not_run', 'future.warning-2'],
        },
      }, 409));
    },
    confirmWarnings: (message) => {
      confirmCount += 1;
      confirmation = message;
      return false;
    },
    formatWarnings: (codes) => {
      formatterCount += 1;
      expect(codes).toStrictEqual(['qti3_conformance.not_run', 'future.warning-2']);
      return 'decline this ⚠';
    },
  });

  expect(result).toStrictEqual({ _tag: 'Cancelled' });
  expect(requestCount).toStrictEqual(1);
  expect(formatterCount).toStrictEqual(1);
  expect(confirmCount).toStrictEqual(1);
  expect(confirmation).toStrictEqual('decline this ⚠');
});

testCase(
  'delivery publish returns typed failures without asking for unrelated errors',
  async () => {
    let confirmationCount = 0;
    const result = await requestAssessmentDeliveryPublication('assessment-1', {
      fetchImpl() {
        return Promise.resolve(jsonResponse({
          error: 'delivery_export_preflight_blocked',
          qflowTenantId: 'tenant-123',
          message: 'The target cannot preserve required scoring.',
        }, 422));
      },
      confirmWarnings() {
        confirmationCount += 1;
        return true;
      },
      formatWarnings: () => {
        throw new Error('must not format unrelated errors');
      },
    });

    expect(result).toStrictEqual({
      _tag: 'Failed',
      payload: { error: 'delivery_export_preflight_blocked', qflowTenantId: 'tenant-123' },
      reason: 'publishFailed',
    });
    expect(confirmationCount).toStrictEqual(0);
  },
);

testCase(
  'delivery publish rejects a successful HTTP response without a version identity',
  async () => {
    const result = await requestAssessmentDeliveryPublication('assessment-1', {
      fetchImpl() {
        return Promise.resolve(jsonResponse({}));
      },
      formatWarnings: () => 'unused',
    });

    expect(result).toStrictEqual({
      _tag: 'Failed',
      payload: {},
      reason: 'invalidResponse',
    });
  },
);

testCase('delivery publish rejects malformed warning approvals before confirmation', async () => {
  const cases: readonly unknown[] = [
    { preflightId: 'bad', acknowledgementToken: ACKNOWLEDGEMENT, warningCodes: ['known-code'] },
    { preflightId: PREFLIGHT_ID, acknowledgementToken: 'bad', warningCodes: ['known-code'] },
    {
      preflightId: PREFLIGHT_ID,
      acknowledgementToken: ACKNOWLEDGEMENT,
      warningCodes: 'known-code',
    },
    { preflightId: PREFLIGHT_ID, acknowledgementToken: ACKNOWLEDGEMENT, warningCodes: [1] },
  ];
  for (const preflight of cases) {
    let requests = 0;
    let formatter = 0;
    let confirm = 0;
    const result = await requestAssessmentDeliveryPublication('assessment-1', {
      fetchImpl() {
        requests += 1;
        return Promise.resolve(jsonResponse({
          error: 'delivery_export_warnings_not_acknowledged',
          preflight,
        }, 409));
      },
      formatWarnings: () => {
        formatter += 1;
        return 'unexpected';
      },
      confirmWarnings: () => {
        confirm += 1;
        return true;
      },
    });
    expect(result._tag).toStrictEqual('Failed');
    if (result._tag === 'Failed') {
      expect(result.payload).toStrictEqual({ error: 'delivery_export_warnings_not_acknowledged' });
      expect(result.reason === 'invalidApproval' || result.reason === 'publishFailed')
        .toStrictEqual(true);
    }
    expect(requests).toStrictEqual(1);
    expect(formatter).toStrictEqual(0);
    expect(confirm).toStrictEqual(0);
  }
});

testCase(
  'delivery publish rejects a success without a valid server publication timestamp',
  async () => {
    for (const publishedAt of [undefined, null, '', 'invalid-date', 123]) {
      const result = await requestAssessmentDeliveryPublication('assessment-1', {
        fetchImpl: () =>
          Promise.resolve(jsonResponse({ assessmentVersionId: 'version-1', publishedAt })),
        formatWarnings: () => 'unused',
      });
      expect(result._tag).toBe('Failed');
      if (result._tag !== 'Failed') expect.unreachable('Expected invalid publication response');
      expect(result.reason).toBe('invalidResponse');
    }
  },
);

testCase('delivery publish accepts a direct successful response once', async () => {
  let requests = 0;
  let formatter = 0;
  let confirmation = 0;
  const result = await requestAssessmentDeliveryPublication('assessment-1', {
    async fetchImpl(input, init) {
      requests += 1;
      const request = new Request(new URL(String(input), 'https://qflow.example'), init);
      expect(request.url).toStrictEqual(
        'https://qflow.example/api/assessments/assessment-1/publish/delivery',
      );
      expect(request.method).toStrictEqual('POST');
      expect(await request.text()).toStrictEqual('');
      expect(request.headers.has('content-type')).toStrictEqual(false);
      return Promise.resolve(jsonResponse({
        ok: true,
        assessmentId: 'assessment-1',
        assessmentVersionId: 'version-2',
        publishedAt: '2026-10-30T12:00:00.000Z',
        previewUrl: 'https://delivery.example/preview',
        adminUrl: 'https://delivery.example/admin',
      }));
    },
    formatWarnings: () => {
      formatter += 1;
      return 'unused';
    },
    confirmWarnings: () => {
      confirmation += 1;
      return true;
    },
  });
  expect(result).toStrictEqual({
    _tag: 'Published',
    payload: {
      assessmentVersionId: 'version-2',
      publishedAt: '2026-10-30T12:00:00.000Z',
      previewUrl: 'https://delivery.example/preview',
      adminUrl: 'https://delivery.example/admin',
    },
  });
  expect(requests).toStrictEqual(1);
  expect(formatter).toStrictEqual(0);
  expect(confirmation).toStrictEqual(0);
});

testCase('delivery publish preserves exactly both validated failure identifiers', async () => {
  const result = await requestAssessmentDeliveryPublication('assessment-1', {
    fetchImpl() {
      return Promise.resolve(jsonResponse({
        error: 'delivery_publish_failed',
        qflowTenantId: 'tenant-ok',
        message: 'HOSTILE_MESSAGE',
        setupHint: 'HOSTILE_HINT',
        previewUrl: 'https://hostile.example',
        adminUrl: 'https://hostile.example/admin',
        assessmentVersionId: 'HOSTILE_VERSION',
        unexpected: 'HOSTILE_EXTRA',
      }, 422));
    },
    formatWarnings: () => {
      throw new Error('unexpected formatter call');
    },
  });
  expect(result).toStrictEqual({
    _tag: 'Failed',
    payload: {
      error: 'delivery_publish_failed',
      qflowTenantId: 'tenant-ok',
      previewUrl: 'https://hostile.example',
      adminUrl: 'https://hostile.example/admin',
      assessmentVersionId: 'HOSTILE_VERSION',
    },
    reason: 'publishFailed',
  });
});

testCase(
  'delivery publish preserves tenant identity only for not-configured responses',
  async () => {
    for (
      const error of [
        'delivery_publish_failed',
        'delivery_export_preflight_blocked',
        'not_found',
      ]
    ) {
      const result = await requestAssessmentDeliveryPublication('assessment-1', {
        fetchImpl: () =>
          Promise.resolve(jsonResponse({ error, qflowTenantId: 'tenant-hostile' }, 422)),
        formatWarnings: () => 'unused',
      });
      expect(result._tag).toStrictEqual('Failed');
      if (result._tag === 'Failed') {
        expect(result.payload.qflowTenantId).toStrictEqual('tenant-hostile');
      }
    }
    const result = await requestAssessmentDeliveryPublication('assessment-1', {
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse(
            { error: 'delivery_publish_not_configured', qflowTenantId: 'tenant-ok' },
            503,
          ),
        ),
      formatWarnings: () => 'unused',
    });
    expect(result._tag).toStrictEqual('Failed');
    if (result._tag === 'Failed') {
      expect(result.payload).toStrictEqual({
        error: 'delivery_publish_not_configured',
        qflowTenantId: 'tenant-ok',
      });
    }
  },
);

testCase(
  'delivery publish reports fetch rejection without synthetic HTTP status control flow',
  async () => {
    const result = await requestAssessmentDeliveryPublication('assessment-1', {
      fetchImpl: () => Promise.reject(new Error('network secret')),
      formatWarnings: () => 'unused',
    });
    expect(result).toStrictEqual({
      _tag: 'Failed',
      payload: {},
      reason: 'requestFailed',
    });
    expect(JSON.stringify(result).includes('network secret')).toStrictEqual(false);
  },
);

testCase('delivery publish rejects malformed JSON for error and success responses', async () => {
  const errorResult = await requestAssessmentDeliveryPublication('assessment-1', {
    fetchImpl: () => Promise.resolve(new Response('{', { status: 422 })),
    formatWarnings: () => 'unused',
  });
  expect(errorResult).toStrictEqual({
    _tag: 'Failed',
    payload: {},
    reason: 'publishFailed',
  });
  const successResult = await requestAssessmentDeliveryPublication('assessment-1', {
    fetchImpl: () => Promise.resolve(new Response('{', { status: 200 })),
    formatWarnings: () => 'unused',
  });
  expect(successResult).toStrictEqual({
    _tag: 'Failed',
    payload: {},
    reason: 'invalidResponse',
  });
});

testCase('delivery publish omits invalid failure identifiers and all server prose', async () => {
  const cases = [
    { error: '9invalid', qflowTenantId: 'tenant-ok' },
    { error: 'A'.repeat(81), qflowTenantId: 'tenant-ok' },
    { error: 'delivery_publish_failed', qflowTenantId: 'bad tenant' },
    { error: 'delivery_publish_failed', qflowTenantId: 'A'.repeat(81) },
  ];
  for (const candidate of cases) {
    const result = await requestAssessmentDeliveryPublication('assessment-1', {
      fetchImpl() {
        return Promise.resolve(jsonResponse({
          ...candidate,
          message: 'HOSTILE_MESSAGE',
          setupHint: 'HOSTILE_HINT',
          previewUrl: 'https://hostile.example',
          adminUrl: 'https://hostile.example/admin',
          assessmentVersionId: 'HOSTILE_VERSION',
        }, 422));
      },
      formatWarnings: () => {
        throw new Error('unexpected warning formatting');
      },
    });
    expect(result._tag).toStrictEqual('Failed');
    if (result._tag === 'Failed') {
      expect('message' in result.payload).toStrictEqual(false);
      expect('setupHint' in result.payload).toStrictEqual(false);
      expect('previewUrl' in result.payload).toStrictEqual(true);
      expect('adminUrl' in result.payload).toStrictEqual(true);
      expect('assessmentVersionId' in result.payload).toStrictEqual(true);
      expect(JSON.stringify(result).includes('HOSTILE_MESSAGE')).toStrictEqual(false);
      expect(result.payload.qflowTenantId).toStrictEqual(candidate.qflowTenantId);
      expect(result.payload.error).toStrictEqual(candidate.error);
    }
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}
