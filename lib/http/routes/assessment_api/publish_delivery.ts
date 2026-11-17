import { defineHttpRoute } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import {
  buildDeliveryPublishRequest,
  DeliveryPublishConfigurationError,
  DeliveryPublishRequestError,
  getDeliveryPublishCapability,
  HARBOR_DELIVERY_SETUP_HINT,
  publishAssessmentToDelivery,
} from '../../../delivery_publish.ts';
import {
  createMaterializedAssessmentExport,
  type CreateMaterializedAssessmentExportResult,
} from '../../../export/authorized_assessment_export_service.ts';
import {
  parseAssessmentExportAcknowledgementToken,
  parseAssessmentExportPreflightId,
  unexpectedAssessmentExportResponse,
} from '../../../export/assessment_export_http.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflightId,
} from '../../../export/assessment_export_preflight.ts';
import {
  exportActorIdFromAuthenticatedUser,
  strictAssessmentExportRequirements,
} from '../../../export/assessment_export_requirements.ts';
import { persistMaterializedAssessmentExport } from '../../../export/assessment_export_receipt_store.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import {
  claimDeliveryPublishAttempt,
  completeDeliveryPublishAttempt,
  markDeliveryPublishAttemptRetryable,
  prepareDeliveryPublishAttempt,
} from '../../../services/delivery_publish_attempts.ts';
import {
  type DeliveryPublishAttempt,
  DeliveryPublishAttemptLeaseLostError,
} from '../../../services/delivery_publish_attempt_state.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { DELIVERY_CAPABILITY_FAILURE_CODES } from '../../../delivery_publish_failure.ts';

type DeliveryExportApproval = {
  readonly preflightId: AssessmentExportPreflightId;
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken;
};

export const publishDeliveryApiRoute = defineHttpRoute(
  '/api/assessments/:id/publish/delivery',
  {
    '*': async (ctx) => {
      if (ctx.req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      const auth = requireAuthContext(ctx.state);
      const parsedApproval = await parseDeliveryExportApproval(ctx.req);
      if (!parsedApproval.ok) return json(parsedApproval.body, 400);
      const assessment = await getAssessment(auth, ctx.params.id);
      if (!assessment) return json({ error: 'not_found', message: 'Assessment not found.' }, 404);
      const capability = await getDeliveryPublishCapability(auth.tenantId);
      if (!capability.enabled) {
        return json(
          {
            error: DELIVERY_CAPABILITY_FAILURE_CODES[capability.status],
            message: capability.message,
            setupHint: capability.setupHint,
            qflowTenantId: auth.tenantId,
          },
          capability.httpStatus && capability.httpStatus >= 400 ? capability.httpStatus : 503,
        );
      }

      const approval = parsedApproval.approval;
      const actorId = exportActorIdFromAuthenticatedUser(auth.userId);
      const storage = resolveStorage(ctx);
      let exportResult: Awaited<ReturnType<typeof createMaterializedAssessmentExport>>;
      try {
        exportResult = await createMaterializedAssessmentExport({
          assessment,
          auth,
          storage,
          readUploadBytes: (upload) => storage.readObject(upload.path),
          targetId: 'qti3-conformant',
          requirements: strictAssessmentExportRequirements(),
          authorizedBy: actorId,
          approvedPreflightId: approval?.preflightId ?? null,
          acknowledgementToken: approval?.acknowledgementToken ?? null,
          createdAt: new Date(),
        });
      } catch (cause: unknown) {
        return unexpectedAssessmentExportResponse(cause, {
          assessmentId: assessment.id,
          operation: 'delivery-publish-preflight',
        });
      }
      if (!exportResult.ok && exportResult._tag === 'BuildFailed') {
        return json({
          error: 'delivery_export_preflight_failed',
          message: exportResult.failure.body.message,
          exportError: exportResult.failure.body.error,
          ...(exportResult.failure.preflight ? { preflight: exportResult.failure.preflight } : {}),
        }, exportResult.failure.status);
      }
      if (!exportResult.ok && exportResult._tag === 'ArtifactFailed') {
        console.error(JSON.stringify({
          event: 'delivery_export_artifact_unavailable',
          assessmentId: assessment.id,
          errorTag: exportResult.error._tag,
        }));
        return json({ error: exportResult.error._tag, message: exportResult.error.message }, 503);
      }
      if (!exportResult.ok) return deliveryAuthorizationFailure(exportResult.decision);
      const receipt = exportResult.value.receipt;
      const persistedExport = await persistMaterializedAssessmentExport(auth, exportResult.value);
      if (!persistedExport.ok) {
        console.error(JSON.stringify({
          event: 'delivery_export_persistence_failed',
          assessmentId: assessment.id,
          errorTag: persistedExport.error._tag,
        }));
        return json(
          { error: persistedExport.error._tag, message: persistedExport.error.message },
          503,
        );
      }

      const packageUrl = new URL(
        `/api/assessments/${encodeURIComponent(assessment.id)}/package`,
        ctx.url.origin,
      );
      packageUrl.searchParams.set('receiptId', receipt.receiptId);

      let claimedAttempt:
        | Extract<DeliveryPublishAttempt, { readonly phase: 'publishing' }>
        | null = null;
      try {
        const proposedAttemptId = crypto.randomUUID();
        const now = new Date();
        const proposedRequest = buildDeliveryPublishRequest(
          auth,
          assessment,
          packageUrl.toString(),
          { publishId: `qflow-${proposedAttemptId}`, now },
        );
        const attempt = await prepareDeliveryPublishAttempt(auth, {
          attemptId: proposedAttemptId,
          assessmentId: assessment.id,
          exportReceiptId: receipt.receiptId,
          preflightId: receipt.preflightId,
          request: proposedRequest,
          now,
        });
        const claim = await claimDeliveryPublishAttempt(auth, assessment.id, attempt.id);
        if (claim._tag === 'Published') return deliveryPublishSuccess(claim.attempt);
        if (claim._tag === 'Busy') {
          return json({
            error: 'delivery_publish_in_progress',
            message: 'This delivery package is already being published.',
          }, 409);
        }
        if (claim._tag === 'NotFound') throw new Error('Prepared delivery publish was not found.');

        claimedAttempt = claim.attempt;
        const result = await publishAssessmentToDelivery(claim.attempt.request);
        const completed = await completeDeliveryPublishAttempt(auth, {
          assessmentId: assessment.id,
          attemptId: claim.attempt.id,
          leaseToken: claim.attempt.leaseToken,
          response: result,
        });
        return deliveryPublishSuccess(completed);
      } catch (cause: unknown) {
        if (cause instanceof DeliveryPublishAttemptLeaseLostError) {
          return json({
            error: 'delivery_publish_in_progress',
            message: 'This delivery package is already being published.',
          }, 409);
        }
        if (claimedAttempt) {
          const failure = deliveryPublishFailure(cause);
          try {
            await markDeliveryPublishAttemptRetryable(auth, {
              assessmentId: assessment.id,
              attemptId: claimedAttempt.id,
              leaseToken: claimedAttempt.leaseToken,
              failure,
            });
          } catch (persistenceCause: unknown) {
            console.error(JSON.stringify({
              event: 'delivery_publish_retry_state_failed',
              assessmentId: assessment.id,
              publishId: claimedAttempt.request.publishId,
              cause: safeErrorSummary(persistenceCause),
            }));
          }
        }
        if (cause instanceof DeliveryPublishConfigurationError) {
          return json(
            {
              error: 'delivery_publish_not_configured',
              message: cause.message,
              setupHint: HARBOR_DELIVERY_SETUP_HINT,
              qflowTenantId: auth.tenantId,
            },
            503,
          );
        }
        if (cause instanceof DeliveryPublishRequestError) {
          return json(
            {
              error: cause.code ?? 'delivery_publish_failed',
              message: cause.message,
              setupHint: HARBOR_DELIVERY_SETUP_HINT,
              qflowTenantId: auth.tenantId,
            },
            cause.status,
          );
        }
        console.error(JSON.stringify({
          event: 'delivery_publish_failed',
          assessmentId: assessment.id,
          cause: safeErrorSummary(cause),
        }));
        return json({ error: 'delivery_publish_failed', message: 'Publish failed.' }, 502);
      }
    },
  },
);

function deliveryPublishSuccess(
  attempt: Extract<DeliveryPublishAttempt, { readonly phase: 'published' }>,
): Response {
  const result = attempt.response;
  return json({
    ok: true,
    ...result,
    assessmentId: result.version.assessmentId,
    assessmentVersionId: result.version.assessmentVersionId,
    previewUrl: result.links?.previewUrl,
    adminUrl: result.links?.adminUrl,
    publishedAt: attempt.publishedAt.toISOString(),
  });
}

function deliveryPublishFailure(
  cause: unknown,
): { readonly code: string; readonly message: string } {
  if (cause instanceof DeliveryPublishRequestError) {
    return {
      code: cause.code ?? 'delivery_publish_failed',
      message: cause.message,
    };
  }
  if (cause instanceof DeliveryPublishConfigurationError) {
    return { code: 'delivery_publish_not_configured', message: cause.message };
  }
  return { code: 'delivery_publish_failed', message: 'Publish failed.' };
}

function deliveryAuthorizationFailure(
  decision: Extract<
    CreateMaterializedAssessmentExportResult,
    { readonly _tag: 'AuthorizationFailed' }
  >['decision'],
): Response {
  switch (decision._tag) {
    case 'PreflightStale':
      return json({
        error: 'delivery_export_preflight_stale',
        message: 'The assessment changed after its delivery export review. Review it again.',
        preflight: decision.preflight,
      }, 409);
    case 'PreflightBlocked':
      return json({
        error: 'delivery_export_preflight_blocked',
        message: 'The assessment cannot be represented by the delivery package contract.',
        preflight: decision.preflight,
      }, 422);
    case 'WarningsNotAcknowledged':
      return json({
        error: 'delivery_export_warnings_not_acknowledged',
        message: 'Review the current QTI 3 delivery package warnings before publishing.',
        preflight: decision.preflight,
      }, 409);
    case 'EvidenceMismatch':
      return json({ error: decision._tag, message: decision.message }, 500);
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function parseDeliveryExportApproval(
  request: Request,
): Promise<
  | { readonly ok: true; readonly approval: DeliveryExportApproval | null }
  | {
    readonly ok: false;
    readonly body: {
      readonly error: 'delivery_export_approval_invalid';
      readonly message: string;
    };
  }
> {
  const body = await request.text();
  if (body.trim().length === 0) return { ok: true, approval: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (_cause: unknown) {
    return invalidDeliveryExportApproval();
  }
  if (!isRecord(parsed)) return invalidDeliveryExportApproval();
  if (
    Object.keys(parsed).some((key) => key !== 'preflightId' && key !== 'acknowledgement')
  ) return invalidDeliveryExportApproval();
  const parsedPreflightId = parseAssessmentExportPreflightId(
    typeof parsed.preflightId === 'string' ? parsed.preflightId : null,
  );
  const parsedAcknowledgement = parseAssessmentExportAcknowledgementToken(
    typeof parsed.acknowledgement === 'string' ? parsed.acknowledgement : null,
  );
  if (
    !parsedPreflightId.ok ||
    !parsedAcknowledgement.ok ||
    parsedAcknowledgement.acknowledgementToken === null
  ) return invalidDeliveryExportApproval();
  return {
    ok: true,
    approval: {
      preflightId: parsedPreflightId.preflightId,
      acknowledgementToken: parsedAcknowledgement.acknowledgementToken,
    },
  };
}

function invalidDeliveryExportApproval() {
  return {
    ok: false,
    body: {
      error: 'delivery_export_approval_invalid' as const,
      message: 'The delivery export approval is invalid.',
    },
  } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
