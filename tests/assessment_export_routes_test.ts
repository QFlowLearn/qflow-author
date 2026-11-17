import { expect, test as testCase } from 'vitest';

import { organizationMemberships } from '../lib/db/principal_schema.ts';

import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';

import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentExportReceipts,
  assessmentParts,
  assessmentPlacements,
  assessments,
  questionRevisions,
  questions,
  tenants,
  uploadsTable,
  users,
} from '../lib/db/schema.ts';
import type { SelectableAssessmentExportTargetId } from '../lib/export/assessment_export_targets.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { canonicalJsonStringify } from '../lib/canonical_json.ts';
import { saveAssessment } from './assessment_fixture.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import type { ObjectStorage } from '../lib/storage_contract.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../lib/tenants.ts';
import { packageApiRoute as packageHandlerEndpoint } from '../lib/http/routes/assessment_api/package.ts';
import { receiptApiRoute as receiptHandlerEndpoint } from '../lib/http/routes/assessment_api/receipt.ts';
import { validateApiRoute as validateHandlerEndpoint } from '../lib/http/routes/assessment_api/validate.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

const packageHandler = packageHandlerEndpoint.handle;
const receiptHandler = receiptHandlerEndpoint.handle;
const validateHandler = validateHandlerEndpoint.handle;

const STRICT_REQUIREMENTS = {
  scoring: 'automatic',
  interaction: 'preserve',
} as const;

const EXPORT_TEST_STORAGE = createMemoryObjectStorage();

type ReleasedTargetRouteCase = {
  readonly targetId: SelectableAssessmentExportTargetId;
  readonly expected:
    | {
      readonly _tag: 'Download';
      readonly targetContractId: string;
      readonly filenameSuffix: string;
      readonly mediaType: string;
    }
    | {
      readonly _tag: 'Blocked';
      readonly diagnosticCode: string;
    };
};

const RELEASED_TARGET_ROUTE_CASES = [
  {
    targetId: 'canvas-new-quizzes',
    expected: {
      _tag: 'Download',
      targetContractId: 'canvas-new-quizzes@1',
      filenameSuffix: 'canvas-new-quizzes.zip',
      mediaType: 'application/zip',
    },
  },
  {
    targetId: 'brightspace-course-import',
    expected: {
      _tag: 'Download',
      targetContractId: 'brightspace-course-import@1',
      filenameSuffix: 'brightspace-course-import.zip',
      mediaType: 'application/zip',
    },
  },
  {
    targetId: 'blackboard-question-banks',
    expected: {
      _tag: 'Blocked',
      diagnosticCode: 'profile.blackboard.response_processing.omitted',
    },
  },
] as const satisfies readonly ReleasedTargetRouteCase[];

testCase(
  'assessment export routes require fresh preflight, warning acceptance, and durable receipt',
  async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const auth: RequestContext = { tenantId, userId, role: 'owner' };
    let assessmentId: string | null = null;
    let questionId: string | null = null;
    let uploadId: string | null = null;

    try {
      const email = `export-${tenantId.slice(0, 8)}@example.com`;
      const displayName = `Export provenance sentinel ${tenantId}`;
      await db.insert(tenants).values({
        id: tenantId,
        slug: `export-${tenantId.slice(0, 8)}`,
        name: 'Export Route Tenant',
      });
      await db.insert(users).values({
        id: userId,
        email,
        emailNormalized: email,
        displayName,
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });

      const question = await saveQuestionRevisionFixture(auth, {
        title: 'Select One',
        body: { ...singleSelectDraft('One'), tags: ['DNA & heredity', 'Årskurs 7'] },
        tags: ['DNA & heredity', 'Årskurs 7'],
        qtiXml: singleSelectXml('One'),
        draftState: 'published',
        provenance: { _tag: 'Authored' },
      });
      questionId = question.questionId;
      const assessment = await saveAssessment(auth, {
        blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
        title: 'Export route assessment',
        parts: [{
          title: 'Part 1',
          placements: [{ itemId: questionId }],
        }],
      });
      assessmentId = assessment.id;

      for (const routeCase of RELEASED_TARGET_ROUTE_CASES) {
        const preflight = await runPreflight(auth, assessmentId, routeCase.targetId);
        expect(preflight.destinationId).toStrictEqual(routeCase.targetId);
        expect(requireString(preflight.preflightId)).toMatch(/^[a-f0-9]{64}$/);
        if (routeCase.expected._tag === 'Blocked') {
          expect(preflight.overallOutcome).toStrictEqual('blocked');
          expect(preflight.acknowledgementToken).toStrictEqual(null);
          if (
            !(requireArray(preflight.packageDiagnosticCodes).includes(
              routeCase.expected.diagnosticCode,
            ))
          ) {
            expect.unreachable(
              'Expected requireArray(preflight.packageDiagnosticCodes).includes( routeCase.expected.diagnosticCode',
            );
          }
          const blockedPackage = await runPackage(
            auth,
            assessmentId,
            routeCase.targetId,
            preflight,
          );
          expect(blockedPackage.status).toStrictEqual(422);
          expect((await responseObject(blockedPackage)).error).toStrictEqual('PreflightBlocked');
          continue;
        }

        if (!(['preserved', 'transformed', 'warning'].includes(String(preflight.overallOutcome)))) {
          expect.unreachable(
            "Expected ['preserved', 'transformed', 'warning'].includes(String(preflight.overallOutcome))",
          );
        }
        if (preflight.overallOutcome === 'warning') {
          expect(requireString(preflight.acknowledgementToken)).toMatch(/^[a-f0-9]{64}$/);
        } else expect(preflight.acknowledgementToken).toStrictEqual(null);
        const packaged = await runPackage(auth, assessmentId, routeCase.targetId, preflight);
        expect(packaged.status).toStrictEqual(200);
        expect(packaged.headers.get('content-type')).toStrictEqual(routeCase.expected.mediaType);
        expect(packaged.headers.get('content-disposition') ?? '').toContain(
          `assessment-${assessmentId}-${routeCase.expected.filenameSuffix}`,
        );
        expect(packaged.headers.get('x-qflow-export-target-contract')).toStrictEqual(
          routeCase.expected.targetContractId,
        );
        const receiptId = packaged.headers.get('x-qflow-export-receipt-id');
        if (!receiptId) expect.unreachable('Expected receiptId');
        const receiptResponse = await invokeHttpRoute(
          receiptHandler,
          makeHttpRequest(new Request(describedByUrl(packaged)), {
            params: { id: assessmentId, receiptId },
            auth,
          }),
        );
        expect(receiptResponse.status).toStrictEqual(200);
        const receipt = await responseObject(receiptResponse);
        const receiptTarget = requireObject(receipt.target);
        expect(receiptTarget.destinationId).toStrictEqual(routeCase.targetId);
        expect(receiptTarget.targetContractId).toStrictEqual(routeCase.expected.targetContractId);
        if (!((await packaged.arrayBuffer()).byteLength > 0)) {
          expect.unreachable('Expected (await packaged.arrayBuffer()).byteLength > 0');
        }
      }

      const canvasPreflight = await runPreflight(auth, assessmentId, 'canvas-classic');
      const canvas = await runPackage(auth, assessmentId, 'canvas-classic', canvasPreflight);
      expect(canvas.status).toStrictEqual(200);
      expect(canvas.headers.get('content-type')).toStrictEqual('application/zip');
      expect(canvas.headers.get('content-disposition') ?? '').toContain(
        `assessment-${assessmentId}-canvas-classic.zip`,
      );
      expect(canvas.headers.get('x-qflow-export-target-contract')).toStrictEqual(
        'canvas-classic-quizzes@1',
      );
      expect(canvas.headers.get('x-qflow-export-warning-count')).toStrictEqual(null);
      expect(canvas.headers.get('x-qflow-export-warning-codes')).toStrictEqual(null);

      const moodlePreflight = await runPreflight(auth, assessmentId, 'moodle');
      const moodle = await runPackage(auth, assessmentId, 'moodle', moodlePreflight);
      expect(moodle.status).toStrictEqual(200);
      expect(moodle.headers.get('content-type')).toStrictEqual('application/xml');
      expect(moodle.headers.get('content-disposition') ?? '').toContain(
        `assessment-${assessmentId}-moodle.xml`,
      );
      expect(await moodle.text()).toContain('<quiz>');

      const qti3Preflight = await runPreflight(auth, assessmentId, 'qti3-conformant');
      const qti3 = await runPackage(auth, assessmentId, 'qti3-conformant', qti3Preflight);
      expect(qti3.status).toStrictEqual(200);
      expect(qti3.headers.get('content-type')).toStrictEqual('application/zip');
      expect(qti3.headers.get('x-qflow-export-warning-count')).toStrictEqual(null);
      expect(qti3.headers.get('x-qflow-export-warning-codes')).toStrictEqual(null);
      expect(qti3.headers.get('x-qflow-export-preflight-id')).toStrictEqual(
        qti3Preflight.preflightId,
      );

      const qti3ReceiptId = qti3.headers.get('x-qflow-export-receipt-id');
      if (!qti3ReceiptId) expect.unreachable('Expected qti3ReceiptId');
      expect(qti3ReceiptId).toMatch(/^[a-f0-9]{64}$/);
      const qti3ReceiptUrl = describedByUrl(qti3);
      expect(qti3ReceiptUrl.pathname).toStrictEqual(
        `/api/assessments/${assessmentId}/receipts/${qti3ReceiptId}`,
      );
      expect(qti3ReceiptUrl.search).toStrictEqual('');
      const packageBytes = new Uint8Array(await qti3.arrayBuffer());
      const reimported = await parseQtiPackage(packageBytes);
      expect(reimported.items[0].draft.tags).toStrictEqual([
        'imported',
        'DNA & heredity',
        'Årskurs 7',
      ]);
      const packageText = Object.values(unzipSync(packageBytes))
        .map((entry) => new TextDecoder().decode(entry))
        .join('\n');
      expect(packageText.includes(email)).toStrictEqual(false);
      expect(packageText.includes(displayName)).toStrictEqual(false);

      const receiptResponse = await invokeHttpRoute(
        receiptHandler,
        makeHttpRequest(new Request(qti3ReceiptUrl), {
          params: { id: assessmentId, receiptId: qti3ReceiptId },
          auth,
        }),
      );
      expect(receiptResponse.status).toStrictEqual(200);
      expect(receiptResponse.headers.get('cache-control')).toStrictEqual('private, immutable');
      const receipt = await responseObject(receiptResponse);
      expect(JSON.stringify(receipt).includes(email)).toStrictEqual(false);
      expect(JSON.stringify(receipt).includes(displayName)).toStrictEqual(false);
      expect(receipt.schema).toStrictEqual('qflow.export-receipt.v1');
      expect(receipt.receiptId).toStrictEqual(qti3ReceiptId);
      expect(receipt.preflightId).toStrictEqual(qti3Preflight.preflightId);
      expect(receipt.authorizedBy).toStrictEqual(userId);
      expect(receipt.overallOutcome).toStrictEqual('preserved');
      const acknowledgements = requireArray(receipt.acknowledgements);
      expect(acknowledgements.length).toStrictEqual(0);
      expect(requireObject(receipt.package).sha256).toStrictEqual(await sha256Hex(packageBytes));

      const runnerAuth: RequestContext = { ...auth, userId: SYSTEM_USER_ID };
      const runnerPackageUrl = new URL(
        `http://local/api/assessments/${assessmentId}/package?receiptId=${qti3ReceiptId}`,
      );
      const runnerPackage = await invokeHttpRoute(
        packageHandler,
        makeHttpRequest(new Request(runnerPackageUrl), {
          params: { id: assessmentId },
          auth: runnerAuth,
          state: { storage: EXPORT_TEST_STORAGE },
        }),
      );
      expect(runnerPackage.status).toStrictEqual(200);
      expect(runnerPackage.headers.get('x-qflow-export-receipt-id')).toStrictEqual(qti3ReceiptId);
      expect(runnerPackage.headers.get('content-length')).toStrictEqual(
        String(packageBytes.byteLength),
      );
      expect(new Uint8Array(await runnerPackage.arrayBuffer())).toStrictEqual(packageBytes);

      // Seed an immutable receipt from the preceding release, with its own content identity.
      const { receiptId: currentReceiptId, ...historicalPayload } = receipt;
      expect(currentReceiptId).toStrictEqual(qti3ReceiptId);
      historicalPayload.validation = {
        ...requireObject(receipt.validation),
        accessibility: {
          ...requireObject(requireObject(receipt.validation).accessibility),
          qti3CoreVersion: '0.13.0',
        },
      };
      historicalPayload.target = {
        ...requireObject(receipt.target),
        qti3Packages: { core: '0.13.0', writer: '0.13.0', conformance: null, transcoder: null },
      };
      const historicalId = await sha256Hex(
        new TextEncoder().encode(canonicalJsonStringify(historicalPayload)),
      );
      const historicalDocument = JSON.stringify({ ...historicalPayload, receiptId: historicalId });
      const [currentReceiptRow] = await db.select().from(assessmentExportReceipts).where(
        eq(assessmentExportReceipts.id, qti3ReceiptId),
      );
      if (!currentReceiptRow) expect.unreachable('Expected currentReceiptRow');
      await db.insert(assessmentExportReceipts).values({
        ...currentReceiptRow,
        id: historicalId,
        receipt: historicalDocument,
      });
      const historicalResponse = await invokeHttpRoute(
        receiptHandler,
        makeHttpRequest(
          new Request(`http://local/api/assessments/${assessmentId}/receipts/${historicalId}`),
          { params: { id: assessmentId, receiptId: historicalId }, auth },
        ),
      );
      expect(historicalResponse.status).toStrictEqual(200);
      expect(await historicalResponse.text()).toStrictEqual(historicalDocument);
      const historicalPackage = await invokeHttpRoute(
        packageHandler,
        makeHttpRequest(
          new Request(
            `http://local/api/assessments/${assessmentId}/package?receiptId=${historicalId}`,
          ),
          {
            params: { id: assessmentId },
            auth: runnerAuth,
            state: { storage: EXPORT_TEST_STORAGE },
          },
        ),
      );
      expect(historicalPackage.status).toStrictEqual(200);
      expect(new Uint8Array(await historicalPackage.arrayBuffer())).toStrictEqual(packageBytes);
      const [unchangedHistoricalRow] = await db.select().from(assessmentExportReceipts).where(
        eq(assessmentExportReceipts.id, historicalId),
      );
      expect(unchangedHistoricalRow?.receipt).toStrictEqual(historicalDocument);

      runnerPackageUrl.searchParams.set('acceptedBy', crypto.randomUUID());
      const spoofedRunner = await invokeHttpRoute(
        packageHandler,
        makeHttpRequest(new Request(runnerPackageUrl), {
          params: { id: assessmentId },
          auth: runnerAuth,
          state: { storage: EXPORT_TEST_STORAGE },
        }),
      );
      expect(spoofedRunner.status).toStrictEqual(400);
      expect((await responseObject(spoofedRunner)).error).toStrictEqual(
        'RunnerPackageRequestInvalid',
      );

      const directPackage = await callExportRoute(
        packageHandler,
        auth,
        assessmentId,
        'qti3-conformant',
      );
      expect(directPackage.status).toStrictEqual(400);
      expect((await responseObject(directPackage)).error).toStrictEqual('PreflightRequired');

      const informationalExport = await callExportRoute(
        packageHandler,
        auth,
        assessmentId,
        'qti3-conformant',
        undefined,
        { preflightId: requireString(qti3Preflight.preflightId) },
      );
      expect(informationalExport.status).toStrictEqual(200);
      expect(qti3Preflight.acknowledgementToken).toStrictEqual(null);

      for (const target of [null, 'qti3', 'not-a-target']) {
        const response = await callExportRoute(
          validateHandler,
          auth,
          assessmentId,
          target,
        );
        expect(response.status).toStrictEqual(400);
        const body = await responseObject(response);
        expect(body.error).toStrictEqual('DestinationNotRegistered');
      }

      const missingRequirementsUrl = new URL(
        `http://local/api/assessments/${assessmentId}/validate?target=moodle`,
      );
      const missingRequirements = await invokeHttpRoute(
        validateHandler,
        makeHttpRequest(new Request(missingRequirementsUrl), {
          params: { id: assessmentId },
          auth,
        }),
      );
      expect(missingRequirements.status).toStrictEqual(400);
      expect((await responseObject(missingRequirements)).error).toStrictEqual(
        'ExportRequirementsInvalid',
      );

      for (
        const invalid of [
          { key: 'preflightId', value: 'bad', error: 'InvalidPreflightId' },
          {
            key: 'acknowledgement',
            value: 'bad',
            error: 'InvalidAcknowledgementToken',
          },
        ]
      ) {
        const response = await callExportRoute(
          packageHandler,
          auth,
          assessmentId,
          'moodle',
          undefined,
          {
            preflightId: requireString(moodlePreflight.preflightId),
            acknowledgement: 'b'.repeat(64),
            [invalid.key]: invalid.value,
          },
        );
        expect(response.status).toStrictEqual(400);
        expect((await responseObject(response)).error).toStrictEqual(invalid.error);
      }

      await saveQuestionRevisionFixture(auth, {
        questionId,
        title: 'Select Changed',
        body: singleSelectDraft('Changed'),
        qtiXml: singleSelectXml('Changed'),
        draftState: 'published',
        provenance: {
          _tag: 'Revision',
          operation: 'revised',
          expectedParentRevision: 1,
        },
      });
      const staleResponse = await runPackage(
        auth,
        assessmentId,
        'qti3-conformant',
        qti3Preflight,
      );
      expect(staleResponse.status).toStrictEqual(409);
      const staleBody = await responseObject(staleResponse);
      expect(staleBody.error).toStrictEqual('PreflightStale');
      if (
        !(requireString(requireObject(staleBody.preflight).preflightId) !==
          requireString(qti3Preflight.preflightId))
      ) {
        expect.unreachable(
          'Expected requireString(requireObject(staleBody.preflight).preflightId) !== requireString(qti3Prefli',
        );
      }

      const immutableRunnerPackage = await invokeHttpRoute(
        packageHandler,
        makeHttpRequest(
          new Request(
            `http://local/api/assessments/${assessmentId}/package?receiptId=${qti3ReceiptId}`,
          ),
          {
            params: { id: assessmentId },
            auth: runnerAuth,
            state: { storage: EXPORT_TEST_STORAGE },
          },
        ),
      );
      expect(immutableRunnerPackage.status).toStrictEqual(200);
      expect(new Uint8Array(await immutableRunnerPackage.arrayBuffer())).toStrictEqual(
        packageBytes,
      );

      uploadId = crypto.randomUUID();
      await db.insert(uploadsTable).values({
        id: uploadId,
        tenantId,
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 4,
        path: `exports/${uploadId}`,
        url: `/uploads/${uploadId}`,
        createdAt: new Date(),
      });
      await saveQuestionRevisionFixture(auth, {
        questionId,
        title: 'Select Asset',
        body: singleSelectDraft('Asset'),
        qtiXml: singleSelectXml('Asset', `/uploads/${uploadId}`),
        draftState: 'published',
        provenance: {
          _tag: 'Revision',
          operation: 'revised',
          expectedParentRevision: 2,
        },
      });

      const secretMessage = 'storage-secret-that-must-not-leak';
      const failingStorage: ObjectStorage = {
        putObject() {
          return Promise.reject(new Error('Unexpected storage write.'));
        },
        readObject() {
          return Promise.reject(new Error(secretMessage));
        },
        readObjectStream() {
          return Promise.reject(new Error(secretMessage));
        },
        readObjectRange() {
          return Promise.reject(new Error(secretMessage));
        },
        deleteObject() {
          return Promise.reject(new Error('Unexpected storage delete.'));
        },
      };
      const failedPreflight = await callExportRoute(
        validateHandler,
        auth,
        assessmentId,
        'moodle',
        failingStorage,
      );
      expect(failedPreflight.status).toStrictEqual(200);
      const failedBody = await responseObject(failedPreflight);
      const failedPreflightDocument = requireObject(failedBody.preflight);
      expect(failedPreflightDocument._tag).toStrictEqual('BuildBlocked');
      expect(failedPreflightDocument.overallOutcome).toStrictEqual('blocked');
      expect(failedPreflightDocument.artifact).toStrictEqual(null);
      if (JSON.stringify(failedBody).includes(secretMessage)) {
        expect.unreachable('Expected !JSON.stringify(failedBody).includes(secretMessage)');
      }

      await saveQuestionRevisionFixture(auth, {
        questionId,
        title: 'Select Missing',
        body: singleSelectDraft('Missing'),
        qtiXml: singleSelectXml('Missing', `/uploads/${crypto.randomUUID()}`),
        draftState: 'published',
        provenance: {
          _tag: 'Revision',
          operation: 'revised',
          expectedParentRevision: 3,
        },
      });
      const missingAsset = await callExportRoute(
        validateHandler,
        auth,
        assessmentId,
        'moodle',
      );
      expect(missingAsset.status).toStrictEqual(200);
      const missingAssetPreflight = requireObject(
        (await responseObject(missingAsset)).preflight,
      );
      expect(missingAssetPreflight._tag).toStrictEqual('BuildBlocked');
      expect(missingAssetPreflight.overallOutcome).toStrictEqual('blocked');
      expect(missingAssetPreflight.artifact).toStrictEqual(null);
    } finally {
      await cleanup({
        assessmentId,
        questionId,
        tenantId,
        uploadId,
        userId,
      });
      await shutdownDb().catch(() => {});
    }
  },
);

async function runPreflight(
  auth: RequestContext,
  assessmentId: string,
  target: string,
): Promise<Record<string, unknown>> {
  const response = await callExportRoute(
    validateHandler,
    auth,
    assessmentId,
    target,
  );
  expect(response.status).toStrictEqual(200);
  return requireObject((await responseObject(response)).preflight);
}

function runPackage(
  auth: RequestContext,
  assessmentId: string,
  target: string,
  preflight: Record<string, unknown>,
): Promise<Response> {
  const query: Record<string, string> = {
    preflightId: requireString(preflight.preflightId),
  };
  if (typeof preflight.acknowledgementToken === 'string') {
    query.acknowledgement = preflight.acknowledgementToken;
  }
  return callExportRoute(packageHandler, auth, assessmentId, target, undefined, query);
}

async function callExportRoute(
  handler: typeof packageHandler | typeof validateHandler,
  auth: RequestContext,
  assessmentId: string,
  target: string | null,
  storage?: ObjectStorage,
  query: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const routeName = handler === packageHandler ? 'package' : 'validate';
  const url = new URL(`http://local/api/assessments/${assessmentId}/${routeName}`);
  if (target !== null) url.searchParams.set('target', target);
  url.searchParams.set('scoring', STRICT_REQUIREMENTS.scoring);
  url.searchParams.set('interaction', STRICT_REQUIREMENTS.interaction);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return await invokeHttpRoute(
    handler,
    makeHttpRequest(new Request(url), {
      params: { id: assessmentId },
      auth,
      state: { storage: storage ?? EXPORT_TEST_STORAGE },
    }),
  );
}

function describedByUrl(response: Response): URL {
  const link = response.headers.get('link');
  if (!link) expect.unreachable('Expected link');
  const match = /^<([^>]+)>; rel="describedby"; type="application\/json"$/.exec(link);
  if (!match) expect.unreachable('Expected match');
  return new URL(match[1]);
}

function singleSelectDraft(choice: string): Record<string, unknown> {
  return {
    type: 'single_select',
    title: `Select ${choice}`,
    bodyHtml: `<p>Select ${choice}.</p>`,
    choices: [{ id: 'A', text: choice }, { id: 'B', text: 'Other' }],
    correctId: 'A',
  };
}

function singleSelectXml(choice: string, assetUrl?: string): string {
  const draft = singleSelectDraft(choice);
  const bodyHtml = typeof draft.bodyHtml === 'string' ? draft.bodyHtml : '';
  return exportQti3TestItemXml(
    'single_select',
    {
      ...draft,
      bodyHtml: assetUrl ? `${bodyHtml}<img src="${assetUrl}" alt="Diagram">` : bodyHtml,
    },
    { identifier: 'route-question' },
  );
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  return requireObject(await response.json());
}

function requireString(value: unknown): string {
  if (!(typeof value === 'string')) expect.unreachable("Expected typeof value === 'string'");
  return value;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!(Array.isArray(value))) expect.unreachable('Expected Array.isArray(value)');
  return value;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!(isRecord(value))) expect.unreachable('Expected isRecord(value)');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function cleanup(input: {
  readonly assessmentId: string | null;
  readonly questionId: string | null;
  readonly tenantId: string;
  readonly uploadId: string | null;
  readonly userId: string;
}): Promise<void> {
  try {
    if (input.assessmentId) {
      await db.delete(assessmentExportReceipts).where(
        eq(assessmentExportReceipts.assessmentId, input.assessmentId),
      );
      const parts = await db.select({ id: assessmentParts.id })
        .from(assessmentParts)
        .where(eq(assessmentParts.assessmentId, input.assessmentId));
      for (const part of parts) {
        await db.delete(assessmentPlacements).where(
          eq(assessmentPlacements.assessmentPartId, part.id),
        );
      }
      await db.delete(assessmentParts).where(
        eq(assessmentParts.assessmentId, input.assessmentId),
      );
      await db.delete(assessments).where(eq(assessments.id, input.assessmentId));
    }
    if (input.questionId) {
      await db.delete(questionRevisions).where(
        eq(questionRevisions.questionId, input.questionId),
      );
      await db.delete(questions).where(eq(questions.id, input.questionId));
    }
    if (input.uploadId) {
      await db.delete(uploadsTable).where(eq(uploadsTable.id, input.uploadId));
    }
    await db.delete(users).where(eq(users.id, input.userId));
    await db.delete(tenants).where(eq(tenants.id, input.tenantId));
  } catch (_) {
    // Ignore cleanup failures after the test has already reported its primary result.
  }
}
