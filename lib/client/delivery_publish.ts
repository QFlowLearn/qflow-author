type DeliveryPublishFailurePayload = {
  readonly error?: string;
  readonly previewUrl?: string;
  readonly adminUrl?: string;
  readonly assessmentVersionId?: string;
  readonly qflowTenantId?: string;
};

type DeliveryPublishSuccessPayload = {
  readonly assessmentVersionId: string;
  readonly publishedAt: string;
  readonly previewUrl?: string;
  readonly adminUrl?: string;
};

/** Interactive result of publishing through the revision-bound QTI delivery preflight. */
export type DeliveryPublishClientResult =
  | { readonly _tag: 'Published'; readonly payload: DeliveryPublishSuccessPayload }
  | { readonly _tag: 'Cancelled' }
  | {
    readonly _tag: 'Failed';
    readonly payload: DeliveryPublishFailurePayload;
    readonly reason: DeliveryPublishFailureReason;
  };

type DeliveryExportApproval = {
  readonly preflightId: string;
  readonly acknowledgement: string;
  readonly warningCodes: readonly string[];
};

/** Closed delivery-publication failure categories returned to presentation code. */
export type DeliveryPublishFailureReason =
  | 'publishFailed'
  | 'requestFailed'
  | 'invalidResponse'
  | 'invalidApproval';

/** Runs delivery publish, discloses current package warnings, and retries only after acceptance. */
export async function requestAssessmentDeliveryPublication(
  assessmentId: string,
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly confirmWarnings?: (message: string) => boolean;
    readonly formatWarnings: (warningCodes: readonly string[]) => string;
  },
): Promise<DeliveryPublishClientResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const first = await sendDeliveryPublishRequest(assessmentId, null, fetchImpl);
  if (!first.response) {
    return { _tag: 'Failed', payload: first.payload, reason: 'requestFailed' };
  }
  if (first.response.ok) return publishedOrInvalid(first);
  if (
    first.response.status !== 409 ||
    first.payload.error !== 'delivery_export_warnings_not_acknowledged'
  ) {
    return {
      _tag: 'Failed',
      payload: first.payload,
      reason: 'publishFailed',
    };
  }
  const approval = parseDeliveryExportApproval(first.rawPayload);
  if (approval === null) {
    return {
      _tag: 'Failed',
      payload: first.payload,
      reason: 'invalidApproval',
    };
  }
  const confirmWarnings = options.confirmWarnings ?? globalThis.confirm;
  const warningMessage = options.formatWarnings(approval.warningCodes);
  if (!confirmWarnings(warningMessage)) {
    return { _tag: 'Cancelled' };
  }
  const accepted = await sendDeliveryPublishRequest(assessmentId, approval, fetchImpl);
  if (!accepted.response) {
    return { _tag: 'Failed', payload: accepted.payload, reason: 'requestFailed' };
  }
  return accepted.response.ok ? publishedOrInvalid(accepted) : {
    _tag: 'Failed',
    payload: accepted.payload,
    reason: 'publishFailed',
  };
}

async function sendDeliveryPublishRequest(
  assessmentId: string,
  approval: DeliveryExportApproval | null,
  fetchImpl: typeof fetch,
) {
  let response: Response | null;
  try {
    response = await fetchImpl(`/api/assessments/${assessmentId}/publish/delivery`, {
      method: 'POST',
      ...(approval
        ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            preflightId: approval.preflightId,
            acknowledgement: approval.acknowledgement,
          }),
        }
        : {}),
    });
  } catch (_cause: unknown) {
    return { response: null, rawPayload: null, payload: {}, successPayload: null };
  }
  const rawPayload: unknown = await response.json().catch(() => null);
  return {
    response,
    rawPayload,
    payload: parseDeliveryPublishFailurePayload(rawPayload),
    successPayload: parseDeliveryPublishSuccessPayload(rawPayload),
  };
}

function publishedOrInvalid(
  result: Awaited<ReturnType<typeof sendDeliveryPublishRequest>>,
): DeliveryPublishClientResult {
  return result.successPayload
    ? {
      _tag: 'Published',
      payload: {
        assessmentVersionId: result.successPayload.assessmentVersionId,
        publishedAt: result.successPayload.publishedAt,
        ...(result.successPayload.previewUrl === undefined
          ? {}
          : { previewUrl: result.successPayload.previewUrl }),
        ...(result.successPayload.adminUrl === undefined
          ? {}
          : { adminUrl: result.successPayload.adminUrl }),
      },
    }
    : {
      _tag: 'Failed',
      payload: result.payload,
      reason: 'invalidResponse',
    };
}

function parseDeliveryPublishFailurePayload(input: unknown): DeliveryPublishFailurePayload {
  const record = asRecord(input);
  if (!record) return {};
  return {
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(typeof record.previewUrl === 'string' ? { previewUrl: record.previewUrl } : {}),
    ...(typeof record.adminUrl === 'string' ? { adminUrl: record.adminUrl } : {}),
    ...(typeof record.assessmentVersionId === 'string'
      ? { assessmentVersionId: record.assessmentVersionId }
      : {}),
    ...(typeof record.qflowTenantId === 'string' ? { qflowTenantId: record.qflowTenantId } : {}),
  };
}

function parseDeliveryPublishSuccessPayload(input: unknown): DeliveryPublishSuccessPayload | null {
  const record = asRecord(input);
  if (
    !record ||
    typeof record.assessmentVersionId !== 'string' ||
    record.assessmentVersionId.trim().length === 0 ||
    typeof record.publishedAt !== 'string' || !Number.isFinite(Date.parse(record.publishedAt))
  ) return null;
  return {
    assessmentVersionId: record.assessmentVersionId,
    publishedAt: record.publishedAt,
    ...(typeof record.previewUrl === 'string' ? { previewUrl: record.previewUrl } : {}),
    ...(typeof record.adminUrl === 'string' ? { adminUrl: record.adminUrl } : {}),
  };
}

function parseDeliveryExportApproval(input: unknown): DeliveryExportApproval | null {
  const root = asRecord(input);
  if (!root) return null;
  const preflight = asRecord(root?.preflight);
  if (!preflight) return null;
  const warningCodes = Array.isArray(preflight.warningCodes) &&
      preflight.warningCodes.every((code) => typeof code === 'string')
    ? preflight.warningCodes
    : null;
  if (
    typeof preflight.preflightId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(preflight.preflightId) ||
    typeof preflight.acknowledgementToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(preflight.acknowledgementToken) ||
    warningCodes === null
  ) return null;
  return {
    preflightId: preflight.preflightId,
    acknowledgement: preflight.acknowledgementToken,
    warningCodes,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  // SAFETY: The value is now known to be a non-null, non-array object.
  return value as Record<string, unknown>;
}
