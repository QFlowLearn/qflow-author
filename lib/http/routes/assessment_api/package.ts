import { defineHttpRoute } from '../../route.ts';

import {
  type MaterializedAssessmentExportArtifact,
  streamMaterializedAssessmentExportArtifact,
} from '../../../export/assessment_export_artifact.ts';
import {
  createMaterializedAssessmentExport,
  type CreateMaterializedAssessmentExportResult,
} from '../../../export/authorized_assessment_export_service.ts';
import {
  type AssessmentExportRequirementSelection,
  assessmentExportRequirementsFromSelection,
  buildAssessmentExportReceiptUrl,
  parseAssessmentExportAcknowledgementToken,
  parseAssessmentExportFinalReceiptId,
  parseAssessmentExportPreflightId,
  parseAssessmentExportRequirementSelection,
  unexpectedAssessmentExportResponse,
} from '../../../export/assessment_export_http.ts';
import {
  type AssessmentExportRunnerAuthorization,
  findAssessmentExportRunnerAuthorization,
  persistMaterializedAssessmentExport,
} from '../../../export/assessment_export_receipt_store.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflightId,
} from '../../../export/assessment_export_preflight.ts';
import {
  type ExportActorId,
  exportActorIdFromAuthenticatedUser,
} from '../../../export/assessment_export_requirements.ts';
import { attachmentContentDisposition } from '../../attachment_content_disposition.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { resolveStorage } from '../../../storage.ts';
import { type RequestContext, requireAuthContext, SYSTEM_USER_ID } from '../../../tenants.ts';

type InteractivePackageRequest = {
  readonly _tag: 'Interactive';
  readonly actorId: ExportActorId;
  readonly targetId: string | null;
  readonly selection: AssessmentExportRequirementSelection;
  readonly preflightId: AssessmentExportPreflightId;
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
};

type RunnerPackageRequest = {
  readonly _tag: 'Runner';
  readonly authorization: AssessmentExportRunnerAuthorization;
};

export const packageApiRoute = defineHttpRoute('/api/assessments/:id/package', {
  '*': async (ctx) => {
    const auth = requireAuthContext(ctx.state);
    if (auth.userId === SYSTEM_USER_ID) {
      const runnerRequest = await parseRunnerPackageRequest(auth, ctx.url, ctx.params.id);
      if (runnerRequest instanceof Response) return runnerRequest;
      const storage = resolveStorage(ctx);
      return await packageResponse(
        ctx.url,
        ctx.params.id,
        storage,
        runnerRequest.authorization.artifact,
        {
          receiptId: runnerRequest.authorization.receiptId,
          preflightId: runnerRequest.authorization.preflightId,
          targetContractId: runnerRequest.authorization.targetContractId,
          warningCodes: runnerRequest.authorization.warningCodes,
        },
      );
    }

    const assessment = await getAssessment(auth, ctx.params.id);
    if (!assessment) return new Response('Not Found', { status: 404 });
    const parsedRequest = parseInteractivePackageRequest(auth, ctx.url);
    if (parsedRequest instanceof Response) return parsedRequest;
    const storage = resolveStorage(ctx);

    try {
      const exported = await createMaterializedAssessmentExport({
        assessment,
        auth,
        storage,
        readUploadBytes: (upload) => storage.readObject(upload.path),
        targetId: parsedRequest.targetId,
        requirements: assessmentExportRequirementsFromSelection(
          parsedRequest.selection,
          parsedRequest.actorId,
        ),
        authorizedBy: parsedRequest.actorId,
        approvedPreflightId: parsedRequest.preflightId,
        acknowledgementToken: parsedRequest.acknowledgementToken,
        createdAt: new Date(),
      });
      if (!exported.ok && exported._tag === 'BuildFailed') {
        return Response.json(
          {
            ...exported.failure.body,
            ...(exported.failure.preflight ? { preflight: exported.failure.preflight } : {}),
          },
          { status: exported.failure.status },
        );
      }
      if (!exported.ok && exported._tag === 'ArtifactFailed') {
        return artifactFailureResponse(assessment.id, exported.error);
      }
      if (!exported.ok) return authorizationFailureResponse(exported.decision);
      const receipt = exported.value.receipt;
      const persistedExport = await persistMaterializedAssessmentExport(auth, exported.value);
      if (!persistedExport.ok) return exportPersistenceFailure(assessment.id, persistedExport);
      return await packageResponse(ctx.url, assessment.id, storage, exported.value.artifact, {
        receiptId: receipt.receiptId,
        preflightId: receipt.preflightId,
        targetContractId: receipt.target.targetContractId,
        warningCodes: receipt.acknowledgements[0]?.warningCodes ?? [],
      });
    } catch (cause: unknown) {
      return unexpectedAssessmentExportResponse(cause, {
        assessmentId: ctx.params.id,
        operation: 'package',
      });
    }
  },
});

async function parseRunnerPackageRequest(
  auth: RequestContext,
  url: URL,
  assessmentId: string,
): Promise<RunnerPackageRequest | Response> {
  if ([...url.searchParams.keys()].some((key) => key !== 'receiptId')) {
    return Response.json(
      {
        error: 'RunnerPackageRequestInvalid',
        message: 'Delivery package requests must use only their server-issued receipt ID.',
      },
      { status: 400 },
    );
  }
  const parsedReceiptId = parseAssessmentExportFinalReceiptId(url.searchParams.get('receiptId'));
  if (!parsedReceiptId.ok) return Response.json(parsedReceiptId.body, { status: 400 });
  const found = await findAssessmentExportRunnerAuthorization(
    auth,
    assessmentId,
    parsedReceiptId.receiptId,
  );
  if (!found.ok) {
    if (found.error._tag === 'AuthorizationNotFound') {
      return Response.json(
        {
          error: 'RunnerAuthorizationNotFound',
          message: 'The delivery package authorization was not found.',
        },
        { status: 404 },
      );
    }
    console.error(JSON.stringify({
      event: 'assessment_export_runner_authorization_lookup_failed',
      assessmentId,
      errorTag: found.error._tag,
    }));
    return Response.json(
      { error: found.error._tag, message: found.error.message },
      { status: 503 },
    );
  }
  return { _tag: 'Runner', authorization: found.authorization };
}

function parseInteractivePackageRequest(
  auth: RequestContext,
  url: URL,
): InteractivePackageRequest | Response {
  if (url.searchParams.has('receiptId')) {
    return Response.json(
      {
        error: 'ReceiptAuthorizationNotAllowed',
        message: 'Interactive package requests use the authenticated author.',
      },
      { status: 400 },
    );
  }
  const parsedSelection = parseAssessmentExportRequirementSelection(url.searchParams);
  if (!parsedSelection.ok) return Response.json(parsedSelection.body, { status: 400 });
  const parsedPreflightId = parseAssessmentExportPreflightId(url.searchParams.get('preflightId'));
  if (!parsedPreflightId.ok) return Response.json(parsedPreflightId.body, { status: 400 });
  const parsedAcknowledgement = parseAssessmentExportAcknowledgementToken(
    url.searchParams.get('acknowledgement'),
  );
  if (!parsedAcknowledgement.ok) {
    return Response.json(parsedAcknowledgement.body, { status: 400 });
  }
  return {
    _tag: 'Interactive',
    actorId: exportActorIdFromAuthenticatedUser(auth.userId),
    targetId: url.searchParams.get('target'),
    selection: parsedSelection.selection,
    preflightId: parsedPreflightId.preflightId,
    acknowledgementToken: parsedAcknowledgement.acknowledgementToken,
  };
}

function authorizationFailureResponse(
  decision: Extract<
    CreateMaterializedAssessmentExportResult,
    { readonly _tag: 'AuthorizationFailed' }
  >['decision'],
): Response {
  switch (decision._tag) {
    case 'PreflightStale':
      return Response.json(
        {
          error: 'PreflightStale',
          message: 'The assessment or export requirements changed after preflight.',
          preflight: decision.preflight,
        },
        { status: 409 },
      );
    case 'PreflightBlocked':
      return Response.json(
        {
          error: 'PreflightBlocked',
          message:
            'Resolve or explicitly accept the listed export consequences before downloading.',
          preflight: decision.preflight,
        },
        { status: 422 },
      );
    case 'WarningsNotAcknowledged':
      return Response.json(
        {
          error: 'WarningsNotAcknowledged',
          message: 'Acknowledge the current export warnings before downloading.',
          preflight: decision.preflight,
        },
        { status: 409 },
      );
    case 'EvidenceMismatch':
      return Response.json(
        { error: decision._tag, message: decision.message },
        { status: 500 },
      );
  }
}

function exportPersistenceFailure(
  assessmentId: string,
  result: Exclude<
    Awaited<ReturnType<typeof persistMaterializedAssessmentExport>>,
    { readonly ok: true }
  >,
): Response {
  console.error(JSON.stringify({
    event: 'assessment_export_persistence_failed',
    assessmentId,
    errorTag: result.error._tag,
  }));
  return Response.json(
    { error: result.error._tag, message: result.error.message },
    { status: 503 },
  );
}

async function packageResponse(
  packageUrl: URL,
  assessmentId: string,
  storage: ReturnType<typeof resolveStorage>,
  artifact: MaterializedAssessmentExportArtifact,
  evidence: {
    readonly receiptId: AssessmentExportRunnerAuthorization['receiptId'];
    readonly preflightId: AssessmentExportRunnerAuthorization['preflightId'];
    readonly targetContractId: string;
    readonly warningCodes: readonly string[];
  },
): Promise<Response> {
  const streamed = await streamMaterializedAssessmentExportArtifact(storage, artifact);
  if (!streamed.ok) return artifactFailureResponse(assessmentId, streamed.error);
  const receiptUrl = buildAssessmentExportReceiptUrl(packageUrl, evidence.receiptId);
  return new Response(streamed.value.body, {
    headers: {
      'content-type': artifact.mediaType,
      'content-length': String(artifact.byteLength),
      'content-disposition': attachmentContentDisposition(artifact.filename),
      'link': `<${receiptUrl.toString()}>; rel="describedby"; type="application/json"`,
      'x-qflow-export-receipt-id': evidence.receiptId,
      'x-qflow-export-preflight-id': evidence.preflightId,
      'x-qflow-export-target-contract': evidence.targetContractId,
      'x-qflow-artifact-sha256': artifact.sha256,
      ...(evidence.warningCodes.length
        ? {
          'x-qflow-export-warning-count': String(evidence.warningCodes.length),
          'x-qflow-export-warning-codes': evidence.warningCodes.join(','),
        }
        : {}),
    },
  });
}

function artifactFailureResponse(
  assessmentId: string,
  error: { readonly _tag: string; readonly message: string },
): Response {
  console.error(JSON.stringify({
    event: 'assessment_export_artifact_unavailable',
    assessmentId,
    errorTag: error._tag,
  }));
  return Response.json({ error: error._tag, message: error.message }, { status: 503 });
}
