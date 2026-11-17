import { expect } from 'vitest';

import { eq } from 'drizzle-orm';

import { db } from '../lib/db.ts';
import { assessmentCanvasPublishAttempts } from '../lib/db/schema.ts';
import { materializeAssessmentExportArtifact } from '../lib/export/assessment_export_artifact.ts';
import { createMaterializedAssessmentExport } from '../lib/export/authorized_assessment_export_service.ts';
import type { AssessmentExportReceipt } from '../lib/export/assessment_export_final_receipt.ts';
import {
  assessmentExportRequirementsFromSelection,
  parseAssessmentExportAcknowledgementToken,
  parseAssessmentExportPreflightId,
} from '../lib/export/assessment_export_http.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflightId,
} from '../lib/export/assessment_export_preflight.ts';
import { exportActorIdFromAuthenticatedUser } from '../lib/export/assessment_export_requirements.ts';
import { parseCanvasConnectionId } from '../lib/lms/canvas_connections.ts';
import {
  type CanvasPublishAttempt,
  type CanvasPublishDestination,
  type CanvasPublishId,
  parseCanvasPublishDestination,
  parseCanvasPublishId,
} from '../lib/lms/canvas_publish_contract.ts';
import { prepareCanvasPublishAttempt } from '../lib/lms/canvas_publish_store.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import type { ObjectStorage } from '../lib/storage_contract.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { canvasPublishPackageApiRoute as preservedPackageHandlerEndpoint } from '../lib/http/routes/assessment_api/canvas_publish_package.ts';
import { validateApiRoute as validateHandlerEndpoint } from '../lib/http/routes/assessment_api/validate.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const preservedPackageHandler = preservedPackageHandlerEndpoint.handle;
const validateHandler = validateHandlerEndpoint.handle;

/** Builds a typed Canvas export fixture through the same preflight and materialization services. */
export async function exportCanvasPackage(
  auth: RequestContext,
  assessmentId: string,
  storage: ObjectStorage,
  targetId: 'canvas-classic' | 'canvas-new-quizzes' = 'canvas-classic',
): Promise<{
  readonly receipt: AssessmentExportReceipt;
  readonly preflightId: AssessmentExportPreflightId;
  readonly acknowledgement: AssessmentExportAcknowledgementToken | null;
  readonly bytes: Uint8Array;
}> {
  const validateUrl = new URL(`https://qflow.example/api/assessments/${assessmentId}/validate`);
  validateUrl.searchParams.set('target', targetId);
  validateUrl.searchParams.set('scoring', 'automatic');
  validateUrl.searchParams.set('interaction', 'preserve');
  const validated = await invokeHttpRoute(
    validateHandler,
    makeHttpRequest(new Request(validateUrl), {
      params: { id: assessmentId },
      auth,
      state: { storage },
    }),
  );
  expect(validated.status).toStrictEqual(200);
  const preflight = parseValidatedPreflight(await validated.json());
  const assessment = await getAssessment(auth, assessmentId);
  if (!assessment) throw new Error('Expected assessment for Canvas export fixture.');
  const actorId = exportActorIdFromAuthenticatedUser(auth.userId);
  const exported = await createMaterializedAssessmentExport({
    assessment,
    auth,
    storage,
    readUploadBytes: (upload) => storage.readObject(upload.path),
    targetId,
    requirements: assessmentExportRequirementsFromSelection(
      { scoring: 'automatic', interaction: 'preserve' },
      actorId,
    ),
    authorizedBy: actorId,
    approvedPreflightId: preflight.preflightId,
    acknowledgementToken: preflight.acknowledgementToken,
    createdAt: new Date(),
  });
  if (!exported.ok) throw new Error(`Expected Canvas export fixture, received ${exported._tag}.`);
  const { artifact, receipt } = exported.value;
  return {
    receipt,
    preflightId: preflight.preflightId,
    acknowledgement: preflight.acknowledgementToken,
    bytes: await storage.readObject(artifact.storageKey),
  };
}

/** Downloads the immutable package preserved for one Canvas publish attempt. */
export async function readPreservedPackage(
  auth: RequestContext,
  assessmentId: string,
  publishId: NonNullable<ReturnType<typeof parseCanvasPublishId>>,
  storage: ObjectStorage,
): Promise<Uint8Array> {
  const response = await invokeHttpRoute(
    preservedPackageHandler,
    makeHttpRequest(
      new Request(
        `https://qflow.example/api/assessments/${assessmentId}/canvas-publishes/${publishId}/package`,
      ),
      {
        params: { id: assessmentId, publishId },
        auth,
        state: { storage },
      },
    ),
  );
  expect(response.status).toStrictEqual(200);
  return new Uint8Array(await response.arrayBuffer());
}

/** Persists a prepared Canvas attempt around an existing typed export fixture. */
export async function preserveAndPrepare(input: {
  readonly auth: RequestContext;
  readonly assessmentId: string;
  readonly publishId: NonNullable<ReturnType<typeof parseCanvasPublishId>>;
  readonly connectionId: NonNullable<ReturnType<typeof parseCanvasConnectionId>>;
  readonly exportReceipt: AssessmentExportReceipt;
  readonly bytes: Uint8Array;
  readonly storage: ObjectStorage;
  readonly requestFingerprint: string;
}): Promise<CanvasPublishAttempt> {
  const preserved = await materializeAssessmentExportArtifact(input.storage, {
    tenantId: input.auth.tenantId,
    assessmentId: input.assessmentId,
    filename: input.exportReceipt.package.filename,
    mediaType: input.exportReceipt.package.mediaType,
    bytes: input.bytes,
    expectedSha256: input.exportReceipt.package.sha256,
  });
  if (!(preserved.ok)) expect.unreachable('Expected preserved.ok');
  const prepared = await prepareCanvasPublishAttempt(input.auth, {
    publishId: input.publishId,
    assessmentId: input.assessmentId,
    connection: {
      id: input.connectionId,
      name: 'Canvas production',
      baseUrl: 'https://canvas.example.edu',
      supportedTargetIds: ['canvas-classic', 'canvas-new-quizzes'],
    },
    targetId: 'canvas-classic',
    destination: canvasCourseDestination(),
    requestFingerprint: input.requestFingerprint,
    export: { receipt: input.exportReceipt, artifact: preserved.value },
  });
  if (!(prepared.ok)) expect.unreachable('Expected prepared.ok');
  return prepared.attempt;
}

/** Creates terminal Canvas attempts used to exercise bounded history pagination. */
export async function createTerminalHistoryAttempts(input: {
  readonly auth: RequestContext;
  readonly assessmentId: string;
  readonly connectionId: NonNullable<ReturnType<typeof parseCanvasConnectionId>>;
  readonly exportReceipt: AssessmentExportReceipt;
  readonly bytes: Uint8Array;
  readonly storage: ObjectStorage;
  readonly count: number;
}): Promise<CanvasPublishId[]> {
  const publishIds: CanvasPublishId[] = [];
  const createdAt = new Date(input.exportReceipt.createdAt);
  for (let index = 0; index < input.count; index += 1) {
    const publishId = parseCanvasPublishId(crypto.randomUUID());
    if (!publishId) throw new Error('Expected valid terminal publish ID.');
    await preserveAndPrepare({
      auth: input.auth,
      assessmentId: input.assessmentId,
      publishId,
      connectionId: input.connectionId,
      exportReceipt: input.exportReceipt,
      bytes: input.bytes,
      storage: input.storage,
      requestFingerprint: await sha256Hex(new TextEncoder().encode(`terminal-${index}`)),
    });
    const terminalAt = new Date(createdAt.valueOf() + index + 1);
    await db.update(assessmentCanvasPublishAttempts).set({
      phase: 'failed',
      attemptCount: 1,
      failureCode: 'CanvasDestinationNotFound',
      failureMessage: 'Canvas could not find the selected destination.',
      createdAt: terminalAt,
      updatedAt: terminalAt,
    }).where(eq(assessmentCanvasPublishAttempts.id, publishId));
    publishIds.push(publishId);
  }
  return publishIds;
}

/** Returns the canonical Canvas course destination used by integration fixtures. */
export function canvasCourseDestination(): CanvasPublishDestination {
  const destination = parseCanvasPublishDestination({ _tag: 'Course', courseId: '17' });
  if (!destination) throw new Error('Expected valid Canvas course destination.');
  return destination;
}

function parseValidatedPreflight(input: unknown): {
  readonly preflightId: AssessmentExportPreflightId;
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
} {
  if (!isObjectRecord(input)) throw new Error('Expected validation response object.');
  const preflight = Reflect.get(input, 'preflight');
  if (!isObjectRecord(preflight)) throw new Error('Expected validation preflight object.');

  const rawPreflightId = Reflect.get(preflight, 'preflightId');
  const parsedPreflightId = parseAssessmentExportPreflightId(
    typeof rawPreflightId === 'string' ? rawPreflightId : null,
  );
  if (!parsedPreflightId.ok) throw new Error('Expected valid preflight identity.');

  const rawAcknowledgement = Reflect.get(preflight, 'acknowledgementToken');
  if (rawAcknowledgement !== null && typeof rawAcknowledgement !== 'string') {
    throw new Error('Expected nullable acknowledgement token.');
  }
  const parsedAcknowledgement = parseAssessmentExportAcknowledgementToken(rawAcknowledgement);
  if (!parsedAcknowledgement.ok) throw new Error('Expected valid acknowledgement token.');
  return {
    preflightId: parsedPreflightId.preflightId,
    acknowledgementToken: parsedAcknowledgement.acknowledgementToken,
  };
}

function isObjectRecord(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
