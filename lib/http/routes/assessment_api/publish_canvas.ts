import { defineHttpRoute, type HttpRequest } from '../../route.ts';

import { createMaterializedAssessmentExport } from '../../../export/authorized_assessment_export_service.ts';
import { assessmentExportRequirementsFromSelection } from '../../../export/assessment_export_http.ts';
import { exportActorIdFromAuthenticatedUser } from '../../../export/assessment_export_requirements.ts';
import { resolveCanvasConnection } from '../../../lms/canvas_connections.ts';
import { createCanvasPublishRequestFingerprint } from '../../../lms/canvas_publish_contract.ts';
import {
  canvasPublishHttpStatus,
  canvasPublishView,
  parseCanvasPublishHttpRequest,
  unexpectedCanvasPublishResponse,
} from '../../../lms/canvas_publish_http.ts';
import {
  advanceCanvasPublish,
  type CanvasPublishServiceOptions,
} from '../../../lms/canvas_publish_service.ts';
import {
  findCanvasPublishAttempt,
  prepareCanvasPublishAttempt,
} from '../../../lms/canvas_publish_store.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Builds the route with an injectable Canvas transport for integration verification. */
export function createCanvasPublishHandler(
  serviceOptions: Pick<CanvasPublishServiceOptions, 'fetchImpl' | 'requestTimeoutMs'> = {},
): (ctx: HttpRequest) => Promise<Response> {
  return async (ctx) => {
    if (ctx.req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const auth = requireAuthContext(ctx.state);
    const parsed = await parseCanvasPublishHttpRequest(ctx.req);
    if (!parsed.ok) return Response.json(parsed.body, { status: parsed.status });
    const assessment = await getAssessment(auth, ctx.params.id);
    if (!assessment) {
      return Response.json(
        { error: 'AssessmentNotFound', message: 'Assessment not found.' },
        { status: 404 },
      );
    }
    const requestFingerprint = await createCanvasPublishRequestFingerprint({
      tenantId: auth.tenantId,
      assessmentId: assessment.id,
      actorId: auth.userId,
      request: parsed.request,
    });

    const existing = await findCanvasPublishAttempt(auth, assessment.id, parsed.publishId, ctx);
    if (existing.ok) {
      if (existing.attempt.requestFingerprint !== requestFingerprint) return idempotencyConflict();
      return existing.attempt.state._tag === 'Prepared'
        ? await advanceAndRespond(ctx, auth, assessment.id, parsed.publishId, serviceOptions)
        : publishResponse(existing.attempt, ctx.url.origin);
    }
    if (existing.error._tag !== 'CanvasPublishNotFound') {
      return persistenceFailure(existing.error, assessment.id);
    }

    const configuredConnection = await resolveCanvasConnection(
      auth,
      parsed.request.connectionId,
      ctx,
    );
    if (!configuredConnection.ok) {
      const status = configuredConnection.error._tag === 'CanvasConnectionNotFound' ||
          configuredConnection.error._tag === 'CanvasAuthorizationRequired'
        ? 400
        : 503;
      return Response.json(
        { error: configuredConnection.error._tag, message: configuredConnection.error.message },
        { status },
      );
    }
    if (!configuredConnection.connection.supportedTargetIds.includes(parsed.request.targetId)) {
      return Response.json(
        {
          error: 'CanvasTargetUnsupported',
          message: 'The selected Canvas connection does not support this export target.',
        },
        { status: 400 },
      );
    }

    const actorId = exportActorIdFromAuthenticatedUser(auth.userId);
    const storage = resolveStorage(ctx);
    try {
      const createdAt = new Date();
      const exported = await createMaterializedAssessmentExport({
        assessment,
        auth,
        storage,
        readUploadBytes: (upload) => storage.readObject(upload.path),
        targetId: parsed.request.targetId,
        requirements: assessmentExportRequirementsFromSelection(parsed.request.selection, actorId),
        authorizedBy: actorId,
        approvedPreflightId: parsed.request.preflightId,
        acknowledgementToken: parsed.request.acknowledgementToken,
        createdAt,
      });
      if (!exported.ok) return authorizedExportFailure(exported, assessment.id);

      const prepared = await prepareCanvasPublishAttempt(auth, {
        publishId: parsed.publishId,
        assessmentId: assessment.id,
        connection: configuredConnection.connection,
        targetId: parsed.request.targetId,
        destination: parsed.request.destination,
        requestFingerprint,
        export: exported.value,
      }, ctx);
      if (!prepared.ok) {
        return prepared.error._tag === 'CanvasPublishIdempotencyConflict'
          ? idempotencyConflict()
          : persistenceFailure(prepared.error, assessment.id);
      }
      return prepared.attempt.state._tag === 'Prepared'
        ? await advanceAndRespond(ctx, auth, assessment.id, parsed.publishId, serviceOptions)
        : publishResponse(prepared.attempt, ctx.url.origin);
    } catch (cause: unknown) {
      return unexpectedCanvasPublishResponse(cause, {
        assessmentId: assessment.id,
        operation: 'canvas-publish-create',
      });
    }
  };
}

export const publishCanvasApiRoute = defineHttpRoute(
  '/api/assessments/:id/publish/canvas',
  { '*': createCanvasPublishHandler() },
);

async function advanceAndRespond(
  ctx: HttpRequest,
  auth: ReturnType<typeof requireAuthContext>,
  assessmentId: string,
  publishId: Parameters<typeof advanceCanvasPublish>[1]['publishId'],
  serviceOptions: Pick<CanvasPublishServiceOptions, 'fetchImpl' | 'requestTimeoutMs'>,
): Promise<Response> {
  const advanced = await advanceCanvasPublish(auth, {
    assessmentId,
    publishId,
    storage: resolveStorage(ctx),
    runtime: ctx,
  }, { ...serviceOptions, signal: ctx.req.signal });
  if (!advanced.ok) {
    if (advanced.error._tag === 'CanvasPublishNotFound') {
      return Response.json(
        { error: advanced.error._tag, message: 'Canvas publish not found.' },
        { status: 404 },
      );
    }
    return persistenceFailure(advanced.error, assessmentId);
  }
  return publishResponse(advanced.attempt, ctx.url.origin);
}

function publishResponse(
  attempt: Parameters<typeof canvasPublishView>[0],
  origin: string,
): Response {
  return Response.json(
    { publish: canvasPublishView(attempt, origin) },
    {
      status: canvasPublishHttpStatus(attempt.state),
      headers: {
        'cache-control': 'private, no-store',
        'x-qflow-canvas-publish-id': attempt.id,
      },
    },
  );
}

function authorizedExportFailure(
  result: Extract<
    Awaited<ReturnType<typeof createMaterializedAssessmentExport>>,
    { readonly ok: false }
  >,
  assessmentId: string,
): Response {
  if (result._tag === 'BuildFailed') {
    return Response.json(
      {
        ...result.failure.body,
        ...(result.failure.preflight ? { preflight: result.failure.preflight } : {}),
      },
      { status: result.failure.status },
    );
  }
  if (result._tag === 'ArtifactFailed') return artifactFailure(result.error, assessmentId);
  const decision = result.decision;
  switch (decision._tag) {
    case 'PreflightStale':
      return Response.json({
        error: 'PreflightStale',
        message: 'The assessment or export requirements changed after preflight.',
        preflight: decision.preflight,
      }, { status: 409 });
    case 'PreflightBlocked':
      return Response.json({
        error: 'PreflightBlocked',
        message: 'Resolve or explicitly accept the listed export consequences before publishing.',
        preflight: decision.preflight,
      }, { status: 422 });
    case 'WarningsNotAcknowledged':
      return Response.json({
        error: 'WarningsNotAcknowledged',
        message: 'Acknowledge the current export warnings before publishing.',
        preflight: decision.preflight,
      }, { status: 409 });
    case 'EvidenceMismatch':
      return Response.json(
        { error: decision._tag, message: decision.message },
        { status: 500 },
      );
  }
}

function idempotencyConflict(): Response {
  return Response.json(
    {
      error: 'CanvasPublishIdempotencyConflict',
      message: 'The Idempotency-Key was already used for another Canvas publish.',
    },
    { status: 409 },
  );
}

function persistenceFailure(error: { readonly _tag: string }, assessmentId: string): Response {
  console.error(JSON.stringify({
    event: 'canvas_publish_persistence_failed',
    assessmentId,
    errorTag: error._tag,
  }));
  return Response.json(
    { error: error._tag, message: 'QFlowLearn could not record direct Canvas publishing.' },
    { status: 503 },
  );
}

function artifactFailure(
  error: { readonly _tag: string; readonly message: string },
  assessmentId: string,
): Response {
  console.error(JSON.stringify({
    event: 'canvas_publish_artifact_failed',
    assessmentId,
    errorTag: error._tag,
  }));
  return Response.json(
    { error: error._tag, message: error.message },
    { status: 503 },
  );
}
