import { expect, test as testCase } from 'vitest';

import { loadAssessmentExportPreflight } from '../lib/export/assessment_export_preflight_client.ts';
import { downloadAssessmentExportPackage } from '../lib/client/assessment_export_package.ts';
import { parseAssessmentExportPreflightId } from '../lib/export/assessment_export_http.ts';
import type { AssessmentExportSelection } from '../lib/client/assessment_export_workflow.ts';

const selection: AssessmentExportSelection = {
  revisionFingerprint: 'revision-1',
  targetId: 'moodle',
  requirements: { scoring: 'automatic', interaction: 'preserve' },
};
const parsedId = parseAssessmentExportPreflightId('a'.repeat(64));
if (!parsedId.ok) throw new Error('Test preflight ID must be valid.');

function installFetch(response: Response | (() => Promise<Response>)) {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  globalThis.fetch = () => typeof response === 'function' ? response() : Promise.resolve(response);
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://example.test' },
  });
  return () => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    });
  };
}

function preflightPayload(repair: unknown) {
  return {
    preflight: {
      _tag: 'Evaluated',
      preflightId: 'a'.repeat(64),
      destinationId: 'moodle',
      targetContractId: 'moodle-xml@1',
      overallOutcome: 'preserved',
      items: [],
      packageDiagnosticCodes: [],
      warningCodes: [],
      acknowledgementToken: null,
      repairs: [repair],
      artifact: { filename: 'export.xml', mediaType: 'application/xml', byteLength: 1 },
    },
  };
}

testCase('preflight client preserves legacy diagnostic codes without server prose', async () => {
  const codes = [
    'PreflightStale',
    'not_found',
    'future/provider code',
    ' whitespace ',
  ];
  for (const error of codes) {
    const restore = installFetch(
      new Response(JSON.stringify({ error, message: 'UPSTREAM_SECRET' }), { status: 409 }),
    );
    try {
      const result = await loadAssessmentExportPreflight(
        'assessment-1',
        'moodle',
        selection.requirements,
      );
      if (result.ok) expect.unreachable('Expected !result.ok');
      if (!result.ok) {
        expect(result.error.code).toStrictEqual('PreflightFailed');
        if (JSON.stringify(result).includes('UPSTREAM_SECRET')) {
          expect.unreachable("Expected !JSON.stringify(result).includes('UPSTREAM_SECRET')");
        }
        expect(result.error.diagnosticCode).toStrictEqual(error);
      }
    } finally {
      restore();
    }
  }
  const restore = installFetch(() => Promise.reject(new Error('UPSTREAM_SECRET')));
  try {
    expect(await loadAssessmentExportPreflight('assessment-1', 'moodle', selection.requirements))
      .toStrictEqual({ ok: false, error: { code: 'PreflightRequestFailed' } });
  } finally {
    restore();
  }
});

testCase('preflight client rejects crossed repairs and discards legacy repair prose', async () => {
  for (
    const repair of [
      { _tag: 'AcceptManualScoring', id: 'accept-diagnosed-fallbacks', affectedItemIds: [] },
      { _tag: 'AcceptDiagnosedFallbacks', id: 'accept-manual-scoring', affectedItemIds: [] },
    ]
  ) {
    const restore = installFetch(new Response(JSON.stringify(preflightPayload(repair))));
    try {
      const result = await loadAssessmentExportPreflight(
        'assessment-1',
        'moodle',
        selection.requirements,
      );
      expect(result).toStrictEqual({ ok: false, error: { code: 'InvalidPreflightResponse' } });
    } finally {
      restore();
    }
  }
  const restore = installFetch(
    new Response(JSON.stringify(preflightPayload({
      _tag: 'AcceptManualScoring',
      id: 'accept-manual-scoring',
      label: 'UPSTREAM_SECRET',
      consequence: 'UPSTREAM_SECRET',
      affectedItemIds: ['item-1'],
    }))),
  );
  try {
    const result = await loadAssessmentExportPreflight(
      'assessment-1',
      'moodle',
      selection.requirements,
    );
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    if (result.ok) {
      expect(result.preflight.repairs[0]).toStrictEqual({
        _tag: 'AcceptManualScoring',
        id: 'accept-manual-scoring',
        affectedItemIds: ['item-1'],
      });
    }
  } finally {
    restore();
  }
});

testCase('preflight client requires legacy repair labels while discarding them', async () => {
  for (
    const repair of [
      { _tag: 'AcceptManualScoring', id: 'accept-manual-scoring', affectedItemIds: [] },
      {
        _tag: 'AcceptManualScoring',
        id: 'accept-manual-scoring',
        label: 42,
        consequence: 'valid',
        affectedItemIds: [],
      },
      {
        _tag: 'AcceptManualScoring',
        id: 'accept-manual-scoring',
        label: 'valid',
        consequence: false,
        affectedItemIds: [],
      },
    ]
  ) {
    const restore = installFetch(new Response(JSON.stringify(preflightPayload(repair))));
    try {
      const result = await loadAssessmentExportPreflight(
        'assessment-1',
        'moodle',
        selection.requirements,
      );
      expect(result).toStrictEqual({ ok: false, error: { code: 'InvalidPreflightResponse' } });
    } finally {
      restore();
    }
  }
});

testCase('package client separates request failure from rejected responses', async () => {
  const preflight = {
    _tag: 'Evaluated' as const,
    preflightId: parsedId.preflightId,
    destinationId: 'moodle' as const,
    targetContractId: 'moodle-xml@1',
    overallOutcome: 'preserved' as const,
    items: [],
    packageDiagnosticCodes: [],
    warningCodes: [],
    acknowledgementToken: null,
    repairs: [],
    artifact: { filename: 'export.xml', mediaType: 'application/xml', byteLength: 1 },
  };
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://example.test' },
  });
  try {
    globalThis.fetch = () => Promise.reject(new Error('UPSTREAM_SECRET'));
    expect(
      await downloadAssessmentExportPackage({ assessmentId: 'assessment-1', selection, preflight }),
    ).toStrictEqual({
      ok: false,
      failure: { code: 'PackageRequestFailed' },
    });
    for (
      const [error, diagnosticCode] of [
        ['PreflightStale', 'PreflightStale'],
        ['PreflightBlocked', 'PreflightBlocked'],
        ['WarningsNotAcknowledged', 'WarningsNotAcknowledged'],
        ['legacy/provider code', 'legacy/provider code'],
      ] as const
    ) {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ error, message: 'UPSTREAM_SECRET' }), { status: 409 }),
        );
      const result = await downloadAssessmentExportPackage({
        assessmentId: 'assessment-1',
        selection,
        preflight,
      });
      expect(result).toStrictEqual(
        diagnosticCode
          ? { ok: false, failure: { code: 'PackageRejected', diagnosticCode } }
          : { ok: false, failure: { code: 'PackageRejected' } },
      );
      if (JSON.stringify(result).includes('UPSTREAM_SECRET')) {
        expect.unreachable("Expected !JSON.stringify(result).includes('UPSTREAM_SECRET')");
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
  }
});
