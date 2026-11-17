import type { DeliveryPublishUnavailableStatus } from './delivery_publish_failure.ts';
import { getEnv } from './config.ts';
import { signDeliveryValue } from './delivery_signature.ts';
import { isSafeHttpsUrl, isSafeHttpUrl } from './http_url.ts';
import type { AssessmentRecord } from './services/assessment_records.ts';
import type { RequestContext } from './tenants.ts';

export type DeliveryPublishRequest = {
  publishId: string;
  qflowTenantId: string;
  qflowAssessmentId: string;
  packageUrl: string;
  assessmentSlug?: string;
  packageName?: string;
  exportFormat?: string;
  actorId?: string;
  issuedAt?: string;
};

export type DeliveryPublishResponse = {
  publishId: string;
  status: 'published';
  version: {
    assessmentId: string;
    assessmentVersionId: string;
    sourcePackageSha256?: string;
  };
  links?: {
    previewUrl?: string;
    adminUrl?: string;
  };
  warnings?: Array<{ code: string; message: string; severity?: string }>;
};

export type DeliveryPublishReceipt = {
  publishId: string;
  status: DeliveryPublishResponse['status'];
  assessmentId: string;
  assessmentVersionId: string;
  assignmentId?: string;
  previewUrl?: string;
  adminUrl?: string;
  sourcePackageSha256?: string;
  publishedAt: string;
};

export type DeliveryMetadata = {
  latestPublish?: DeliveryPublishReceipt;
  history?: DeliveryPublishReceipt[];
};

type DeliveryPublishCapabilityContext = {
  readonly message: string;
  readonly setupHint?: string;
  readonly qflowTenantId?: string;
  readonly httpStatus?: number;
};

/** Whether hosted assessment delivery is configured and available for one workspace. */
export type DeliveryPublishCapability =
  & DeliveryPublishCapabilityContext
  & (
    | { readonly enabled: true; readonly status: 'configured' }
    | { readonly enabled: false; readonly status: DeliveryPublishUnavailableStatus }
  );

type DeliveryPublishConfig = {
  url: string;
  secret: string;
};

type DeliveryCapabilityConfig = DeliveryPublishConfig;

type HarborDeliveryCapabilityResponse = {
  ok?: boolean;
  enabled?: boolean;
  qflowTenantId?: string;
  tenantId?: string;
  error?: string;
  message?: string;
};

const HARBOR_DELIVERY_SETUP_MESSAGE =
  'QFlowLearn Delivery is not connected for this workspace. Ask an administrator to connect the workspace before publishing.';

export const HARBOR_DELIVERY_SETUP_HINT =
  'An administrator must configure QFLOW_DELIVERY_PUBLISH_URL, QFLOW_DELIVERY_CAPABILITY_URL, QFLOW_DELIVERY_STATE_URL, QFLOW_DELIVERY_SSO_LAUNCH_URL, QFLOW_DELIVERY_SIGNING_SECRET, and a matching QFLOW_RUNNER_KEY in QFlow, then link this QFlow tenant to an active QFlowLearn Delivery tenant with QFlow publish entitlement.';

export class DeliveryPublishConfigurationError extends Error {
  constructor(message = 'Delivery publishing is not configured.') {
    super(message);
    this.name = 'DeliveryPublishConfigurationError';
  }
}

export class DeliveryPublishRequestError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'DeliveryPublishRequestError';
    this.status = status;
    this.code = code;
  }
}

export function getDeliveryPublishUrl(): string | null {
  return readHttpUrlEnv('QFLOW_DELIVERY_PUBLISH_URL');
}

function getDeliveryCapabilityUrl(): string | null {
  return readHttpUrlEnv('QFLOW_DELIVERY_CAPABILITY_URL');
}

function getDeliveryPublishConfig(): DeliveryPublishConfig | null {
  const url = getDeliveryPublishUrl();
  const secret = String(getEnv('QFLOW_DELIVERY_SIGNING_SECRET') ?? '').trim();
  if (!url && !secret) return null;
  if (!url || !secret) {
    throw new DeliveryPublishConfigurationError(
      'QFLOW_DELIVERY_PUBLISH_URL and QFLOW_DELIVERY_SIGNING_SECRET must both be configured.',
    );
  }
  return { url, secret };
}

function getDeliveryCapabilityConfig(): DeliveryCapabilityConfig | null {
  const url = getDeliveryCapabilityUrl();
  const secret = String(getEnv('QFLOW_DELIVERY_SIGNING_SECRET') ?? '').trim();
  if (!url && !secret) return null;
  if (!url || !secret) {
    throw new DeliveryPublishConfigurationError(
      'QFLOW_DELIVERY_CAPABILITY_URL and QFLOW_DELIVERY_SIGNING_SECRET must both be configured.',
    );
  }
  return { url, secret };
}

function getDeliveryPublishConfigurationCapability(): DeliveryPublishCapability {
  try {
    const publishConfig = getDeliveryPublishConfig();
    const capabilityConfig = getDeliveryCapabilityConfig();
    if (!publishConfig && !capabilityConfig) {
      return {
        enabled: false,
        status: 'not_configured',
        message: HARBOR_DELIVERY_SETUP_MESSAGE,
        setupHint: HARBOR_DELIVERY_SETUP_HINT,
      };
    }
    if (!publishConfig || !capabilityConfig) {
      throw new DeliveryPublishConfigurationError(
        'QFLOW_DELIVERY_PUBLISH_URL, QFLOW_DELIVERY_CAPABILITY_URL, and QFLOW_DELIVERY_SIGNING_SECRET must all be configured.',
      );
    }
    return {
      enabled: true,
      status: 'configured',
      message: 'QFlowLearn Delivery is configured.',
    };
  } catch (err) {
    return {
      enabled: false,
      status: 'invalid_config',
      message: (err as Error).message || 'QFlowLearn Delivery configuration is invalid.',
      setupHint: HARBOR_DELIVERY_SETUP_HINT,
    };
  }
}

export async function getDeliveryPublishCapability(
  qflowTenantId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryPublishCapability> {
  const configuration = getDeliveryPublishConfigurationCapability();
  if (!configuration.enabled || !qflowTenantId) return configuration;

  try {
    return await fetchDeliveryCapability(qflowTenantId, fetchImpl);
  } catch (err) {
    if (err instanceof DeliveryPublishConfigurationError) {
      return {
        enabled: false,
        status: 'invalid_config',
        message: err.message,
        setupHint: HARBOR_DELIVERY_SETUP_HINT,
        qflowTenantId,
        httpStatus: 503,
      };
    }

    return {
      enabled: false,
      status: 'unavailable',
      message:
        'QFlowLearn Delivery status could not be verified. Ask an administrator to confirm the workspace connection before publishing.',
      setupHint: `${HARBOR_DELIVERY_SETUP_HINT} ${((err as Error).message || '').trim()}`.trim(),
      qflowTenantId,
      httpStatus: 503,
    };
  }
}

export function buildDeliveryPublishRequest(
  auth: RequestContext,
  assessment: Pick<AssessmentRecord, 'id' | 'title'>,
  packageUrl: string,
  options: {
    readonly publishId: string;
    readonly now?: Date;
  },
): DeliveryPublishRequest {
  const publishId = parseNonEmptyString(options.publishId);
  if (!publishId) throw new Error('Delivery publish ID is required.');
  return {
    publishId,
    qflowTenantId: auth.tenantId,
    qflowAssessmentId: assessment.id,
    packageUrl,
    assessmentSlug: slugify(assessment.title || assessment.id),
    packageName: `${slugify(assessment.title || assessment.id) || 'assessment'}.zip`,
    exportFormat: 'qti3',
    actorId: auth.userId,
    issuedAt: (options.now ?? new Date()).toISOString(),
  };
}

export async function publishAssessmentToDelivery(
  request: DeliveryPublishRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryPublishResponse> {
  const config = getDeliveryPublishConfig();
  if (!config) throw new DeliveryPublishConfigurationError();

  const body = JSON.stringify(request);
  const signature = await signDeliveryValue(body, config.secret);
  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-harbor-qflow-signature': signature,
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const rawError = typeof error.error === 'string' ? error.error.trim() : undefined;
    const message = typeof error.message === 'string' && error.message.trim().length > 0
      ? error.message.trim()
      : getDeliveryPublishFailureMessage(response.status, rawError);
    const code = typeof error.code === 'string' && error.code.trim().length > 0
      ? error.code.trim()
      : getDeliveryPublishFailureCode(response.status, rawError);
    throw new DeliveryPublishRequestError(response.status, message, code);
  }

  const parsed = parseDeliveryPublishResponsePayload(
    payload,
    request.publishId,
    new URL(config.url).origin,
  );
  if (!parsed) throw invalidDeliveryPublishResponse();
  return parsed;
}

export function mergeDeliveryPublishMetadata(
  metadata: Record<string, unknown>,
  response: DeliveryPublishResponse,
  now = new Date(),
): Record<string, unknown> {
  const existingDelivery = isRecord(metadata.delivery) ? metadata.delivery : {};
  const history: DeliveryPublishReceipt[] = Array.isArray(existingDelivery.history)
    ? existingDelivery.history.filter(isDeliveryPublishReceipt).slice(0, 9)
    : [];
  const receipt: DeliveryPublishReceipt = {
    publishId: response.publishId,
    status: response.status,
    assessmentId: response.version.assessmentId,
    assessmentVersionId: response.version.assessmentVersionId,
    previewUrl: response.links?.previewUrl,
    adminUrl: response.links?.adminUrl,
    sourcePackageSha256: response.version.sourcePackageSha256,
    publishedAt: now.toISOString(),
  };

  return {
    ...metadata,
    delivery: {
      latestPublish: receipt,
      history: [receipt, ...history],
    } satisfies DeliveryMetadata,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function fetchDeliveryCapability(
  qflowTenantId: string,
  fetchImpl: typeof fetch,
): Promise<DeliveryPublishCapability> {
  const config = getDeliveryCapabilityConfig();
  if (!config) throw new DeliveryPublishConfigurationError();

  const body = JSON.stringify({
    qflowTenantId,
    issuedAt: new Date().toISOString(),
  });
  const signature = await signDeliveryValue(body, config.secret);
  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-harbor-qflow-signature': signature,
    },
    body,
  });
  const payload = await response.json().catch(() => null);
  const bodyObject = isRecord(payload) ? payload as HarborDeliveryCapabilityResponse : {};

  if (response.ok && bodyObject.enabled === true) {
    return {
      enabled: true,
      status: 'configured',
      message: 'QFlowLearn Delivery is configured.',
      qflowTenantId,
      httpStatus: response.status,
    };
  }

  const rawError = typeof bodyObject.error === 'string' ? bodyObject.error.trim() : undefined;
  const rawMessage = typeof bodyObject.message === 'string' ? bodyObject.message.trim() : undefined;

  if (response.status === 401) {
    return {
      enabled: false,
      status: 'invalid_config',
      message:
        'QFlowLearn Delivery rejected the QFlow delivery capability check. Confirm QFLOW_DELIVERY_SIGNING_SECRET matches the delivery service QFLOW_HANDOFF_SECRET.',
      setupHint: HARBOR_DELIVERY_SETUP_HINT,
      qflowTenantId,
      httpStatus: response.status,
    };
  }

  return {
    enabled: false,
    status: getDeliveryCapabilityFailureStatus(rawError, response.status),
    message: getDeliveryPublishFailureMessage(response.status, rawMessage ?? rawError),
    setupHint: HARBOR_DELIVERY_SETUP_HINT,
    qflowTenantId,
    httpStatus: response.status,
  };
}

function readHttpUrlEnv(key: string): string | null {
  const raw = String(getEnv(key) ?? '').trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} must be an absolute http(s) URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${key} must use http or https.`);
  }

  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Parse one stored or remote Harbor publish response into its trusted application shape. */
export function parseDeliveryPublishResponsePayload(
  payload: unknown,
  expectedPublishId: string,
  allowedLinkOrigin?: string,
): DeliveryPublishResponse | null {
  if (
    !isRecord(payload) ||
    payload.publishId !== expectedPublishId ||
    payload.status !== 'published' ||
    !isRecord(payload.version)
  ) {
    return null;
  }

  const assessmentId = parseNonEmptyString(payload.version.assessmentId);
  const assessmentVersionId = parseNonEmptyString(payload.version.assessmentVersionId);
  const sourcePackageSha256 = parseOptionalNonEmptyString(payload.version.sourcePackageSha256);
  const links = parseDeliveryPublishLinks(payload.links, allowedLinkOrigin);
  const warnings = parseDeliveryPublishWarnings(payload.warnings);
  if (
    assessmentId === null ||
    assessmentVersionId === null ||
    sourcePackageSha256 === null ||
    links === null ||
    warnings === null
  ) {
    return null;
  }

  return {
    publishId: expectedPublishId,
    status: 'published',
    version: {
      assessmentId,
      assessmentVersionId,
      ...(sourcePackageSha256 === undefined ? {} : { sourcePackageSha256 }),
    },
    ...(links === undefined ? {} : { links }),
    ...(warnings === undefined ? {} : { warnings }),
  };
}

function parseDeliveryPublishLinks(
  value: unknown,
  allowedOrigin: string | undefined,
): DeliveryPublishResponse['links'] | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const previewUrl = parseDeliveryLink(value.previewUrl, allowedOrigin);
  const adminUrl = parseDeliveryLink(value.adminUrl, allowedOrigin);
  if (previewUrl === null || adminUrl === null) return null;

  return {
    ...(previewUrl === undefined ? {} : { previewUrl }),
    ...(adminUrl === undefined ? {} : { adminUrl }),
  };
}

function parseDeliveryLink(
  value: unknown,
  allowedOrigin: string | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (!isSafeHttpsUrl(value)) return null;

  const url = new URL(value);
  return allowedOrigin === undefined || url.origin === allowedOrigin ? url.toString() : null;
}

/** Parse one persisted Harbor request before retrying its remote side effect. */
export function parseDeliveryPublishRequestPayload(
  payload: unknown,
): DeliveryPublishRequest | null {
  if (!isRecord(payload)) return null;
  const publishId = parseNonEmptyString(payload.publishId);
  const qflowTenantId = parseNonEmptyString(payload.qflowTenantId);
  const qflowAssessmentId = parseNonEmptyString(payload.qflowAssessmentId);
  const packageUrl = isSafeHttpUrl(payload.packageUrl)
    ? new URL(payload.packageUrl).toString()
    : null;
  const assessmentSlug = parseOptionalNonEmptyString(payload.assessmentSlug);
  const packageName = parseOptionalNonEmptyString(payload.packageName);
  const exportFormat = parseOptionalNonEmptyString(payload.exportFormat);
  const actorId = parseOptionalNonEmptyString(payload.actorId);
  const issuedAt = parseOptionalTimestamp(payload.issuedAt);
  if (
    publishId === null ||
    qflowTenantId === null ||
    qflowAssessmentId === null ||
    packageUrl === null ||
    assessmentSlug === null ||
    packageName === null ||
    exportFormat === null ||
    actorId === null ||
    issuedAt === null
  ) return null;
  return {
    publishId,
    qflowTenantId,
    qflowAssessmentId,
    packageUrl,
    ...(assessmentSlug === undefined ? {} : { assessmentSlug }),
    ...(packageName === undefined ? {} : { packageName }),
    ...(exportFormat === undefined ? {} : { exportFormat }),
    ...(actorId === undefined ? {} : { actorId }),
    ...(issuedAt === undefined ? {} : { issuedAt }),
  };
}

function parseDeliveryPublishWarnings(
  value: unknown,
): DeliveryPublishResponse['warnings'] | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;

  const warnings: NonNullable<DeliveryPublishResponse['warnings']> = [];
  for (const warning of value) {
    if (!isRecord(warning)) return null;
    const code = parseNonEmptyString(warning.code);
    const message = parseNonEmptyString(warning.message);
    const severity = parseOptionalNonEmptyString(warning.severity);
    if (code === null || message === null || severity === null) return null;
    warnings.push({
      code,
      message,
      ...(severity === undefined ? {} : { severity }),
    });
  }
  return warnings;
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalNonEmptyString(value: unknown): string | null | undefined {
  return value === undefined ? undefined : parseNonEmptyString(value);
}

function parseOptionalTimestamp(value: unknown): string | null | undefined {
  const timestamp = parseOptionalNonEmptyString(value);
  if (timestamp === null || timestamp === undefined) return timestamp;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function invalidDeliveryPublishResponse(): DeliveryPublishRequestError {
  return new DeliveryPublishRequestError(
    502,
    'QFlowLearn Delivery returned an invalid delivery publish response.',
    'delivery_publish_invalid_response',
  );
}

function isDeliveryPublishReceipt(value: unknown): value is DeliveryPublishReceipt {
  return isRecord(value) &&
    typeof value.publishId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.assessmentId === 'string' &&
    typeof value.assessmentVersionId === 'string' &&
    typeof value.publishedAt === 'string';
}

function getDeliveryPublishFailureMessage(status: number, rawError?: string): string {
  const normalized = rawError?.toLowerCase() ?? '';
  if (
    status === 403 &&
    (normalized.includes('not linked') || normalized === 'qflow_tenant_not_linked')
  ) {
    return HARBOR_DELIVERY_SETUP_MESSAGE;
  }
  if (
    status === 403 &&
    (normalized.includes('not entitled') || normalized === 'qflow_publish_not_entitled')
  ) {
    return 'This workspace is not entitled to publish to QFlowLearn Delivery. Ask an administrator to activate delivery publishing.';
  }
  if (normalized.includes('package fetch')) {
    return `${rawError}. Confirm QFLOW_RUNNER_KEY matches between QFlow and QFlowLearn Delivery and that the delivery service can reach this QFlow package endpoint.`;
  }
  if (rawError) return rawError;
  if (status === 403) return HARBOR_DELIVERY_SETUP_MESSAGE;
  return 'Delivery publish failed.';
}

function getDeliveryPublishFailureCode(status: number, rawError?: string): string | undefined {
  const normalized = rawError?.toLowerCase() ?? '';
  if (
    status === 403 &&
    (normalized === 'qflow_tenant_not_linked' || normalized.includes('not linked'))
  ) {
    return 'delivery_publish_tenant_not_linked';
  }
  if (
    status === 403 &&
    (normalized === 'qflow_publish_not_entitled' || normalized.includes('not entitled'))
  ) {
    return 'delivery_publish_not_entitled';
  }
  if (normalized.includes('package fetch')) {
    return 'delivery_publish_package_fetch_failed';
  }
  return undefined;
}

function getDeliveryCapabilityFailureStatus(
  rawError: string | undefined,
  httpStatus: number,
): DeliveryPublishUnavailableStatus {
  if (rawError === 'qflow_tenant_not_linked') return 'not_linked';
  if (rawError === 'qflow_publish_not_entitled') return 'not_entitled';
  if (httpStatus >= 500) return 'unavailable';
  return 'invalid_config';
}
