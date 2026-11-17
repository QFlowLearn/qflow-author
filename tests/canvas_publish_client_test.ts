import { expect, test as testCase } from 'vitest';

import {
  createCanvasPublish,
  loadCanvasPublishes,
  resumeCanvasPublish,
} from '../lib/client/canvas_publish.ts';
import type { AssessmentExportPreflightId } from '../lib/export/assessment_export_preflight.ts';

const PUBLISH_ID = 'a505462d-2f72-4d99-ae04-77e10bc783e8';
const CONNECTION_ID = '8fdcd9d7-3cb3-4f7e-8c92-31bd3272fda0';
const CONTENT_ID = 'a'.repeat(64);

testCase(
  'Canvas publish client preserves a recoverable attempt in a non-success HTTP envelope',
  async () => {
    const result = await createCanvasPublish({
      assessmentId: 'assessment-1',
      publishId: PUBLISH_ID,
      connectionId: CONNECTION_ID,
      targetId: 'canvas-classic',
      destination: { type: 'course', courseId: '17' },
      preflightId: CONTENT_ID as AssessmentExportPreflightId,
      acknowledgement: null,
      selection: { scoring: 'automatic', interaction: 'preserve' },
    }, {
      fetchImpl: () => {
        return Promise.resolve(
          Response.json({
            publish: publishView(),
            message: 'ignored legacy prose',
            extra: true,
          }, { status: 502 }),
        );
      },
    });

    expect(result.ok).toStrictEqual(true);
    if (result.ok) {
      expect(result.value.state._tag).toStrictEqual('RetryUpload');
      expect(result.value.artifact.packageUrl.endsWith('/package')).toStrictEqual(true);
    }
  },
);

testCase(
  'Canvas publish client rejects invalid destination values at the browser boundary',
  async () => {
    const invalid = {
      ...publishView(),
      destination: {
        _tag: 'QuestionBank',
        courseId: '17',
        bank: { _tag: 'Existing', questionBankId: '' },
      },
    };
    const result = await loadCanvasPublishes('assessment-1', 'canvas-classic', {
      fetchImpl: () =>
        Promise.resolve(Response.json({
          actionRequired: [invalid],
          terminal: [],
          nextTerminalCursor: null,
        })),
    });
    expect(result.ok).toStrictEqual(false);
  },
);

testCase(
  'Canvas publish client omits server prose while preserving structured error codes',
  async () => {
    const result = await resumeCanvasPublish('assessment-1', PUBLISH_ID, {
      fetchImpl: () =>
        Promise.resolve(Response.json({
          error: 'legacy/provider-code with spaces',
          message: 'HOSTILE_SERVER_MESSAGE',
          setupHint: 'HOSTILE_SETUP_HINT',
          previewUrl: '/preview',
        }, { status: 502 })),
    });
    expect(result).toStrictEqual({
      ok: false,
      error: { code: 'legacy/provider-code with spaces' },
    });
    expect(JSON.stringify(result).includes('HOSTILE')).toStrictEqual(false);
  },
);

function publishView() {
  const remote = {
    contentMigrationId: '42',
    workflowState: 'created',
  };
  return {
    id: PUBLISH_ID,
    connection: {
      id: CONNECTION_ID,
      name: 'Canvas production',
      baseUrl: 'https://canvas.example.edu',
    },
    targetId: 'canvas-classic',
    destination: { _tag: 'Course', courseId: '17' },
    exportReceiptId: CONTENT_ID,
    artifact: {
      filename: 'assessment-canvas-classic.zip',
      mediaType: 'application/zip',
      sha256: CONTENT_ID,
      byteLength: 3,
      packageUrl:
        `https://qflow.example/api/assessments/assessment-1/canvas-publishes/${PUBLISH_ID}/package`,
    },
    attemptCount: 1,
    state: {
      _tag: 'RetryUpload',
      remote,
      failure: { code: 'CanvasUnavailable', message: 'Canvas is unavailable.' },
    },
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:01.000Z',
  };
}
