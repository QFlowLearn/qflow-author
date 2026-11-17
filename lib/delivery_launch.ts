import { type DeliveryAssessmentStatus, parseDeliveryAssessmentStatus } from './delivery_status.ts';
import { getEnv } from './config.ts';
import { encodeBase64Url, signDeliveryValue } from './delivery_signature.ts';

export const QFLOW_SSO_LAUNCH_TOKEN_ISSUER = 'qflowlearn';
export const QFLOW_SSO_LAUNCH_TOKEN_AUDIENCE = 'harbor:qflow-sso-launch';
const QFLOW_SSO_LAUNCH_TOKEN_TTL_SECONDS = 5 * 60;

export type DeliveryLaunchLearner = {
  subject: string;
  displayName: string;
  email?: string | null;
};

export type DeliveryLaunchTokenClaims = {
  iss: typeof QFLOW_SSO_LAUNCH_TOKEN_ISSUER;
  aud: typeof QFLOW_SSO_LAUNCH_TOKEN_AUDIENCE;
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  qflowTenantId: string;
  assignmentId: string;
  learner: DeliveryLaunchLearner;
};

export type DeliveryLaunchInput = {
  qflowTenantId: string;
  assignmentId: string;
  learner: DeliveryLaunchLearner;
  now?: Date;
  tokenId?: string;
};

export type DeliveryAssignmentState = {
  assignment: {
    assignmentId: string;
    assessmentId: string;
    assessmentVersionId: string;
    title: string;
    status: string;
    updatedAt: string;
  };
};

export class DeliveryLaunchConfigurationError extends Error {
  constructor(message = 'Delivery launch is not configured.') {
    super(message);
    this.name = 'DeliveryLaunchConfigurationError';
  }
}

function getDeliverySsoLaunchUrl(): string {
  return readRequiredHttpUrl('QFLOW_DELIVERY_SSO_LAUNCH_URL');
}

function getDeliveryStateUrl(): string {
  return readRequiredHttpUrl('QFLOW_DELIVERY_STATE_URL');
}

function readRequiredHttpUrl(key: string): string {
  const raw = String(getEnv(key) ?? '').trim();
  if (!raw) {
    throw new DeliveryLaunchConfigurationError(`${key} must be configured.`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DeliveryLaunchConfigurationError(`${key} must be an absolute http(s) URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DeliveryLaunchConfigurationError(`${key} must use http or https.`);
  }

  return url.toString();
}

function getDeliveryLaunchSigningSecret(): string {
  const secret = String(getEnv('QFLOW_DELIVERY_SIGNING_SECRET') ?? '').trim();
  if (!secret) {
    throw new DeliveryLaunchConfigurationError(
      'QFLOW_DELIVERY_SIGNING_SECRET must be configured.',
    );
  }
  return secret;
}

export async function buildDeliverySsoLaunchRedirectUrl(
  input: DeliveryLaunchInput,
): Promise<string> {
  const launchUrl = new URL(getDeliverySsoLaunchUrl());
  launchUrl.searchParams.set('token', await signDeliveryLaunchToken(input));
  return launchUrl.toString();
}

export async function fetchDeliveryAssignmentState(
  input: {
    assignmentId: string;
    qflowTenantId: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryAssignmentState> {
  const body = JSON.stringify({
    assignmentId: requireNonEmpty(input.assignmentId, 'assignmentId is required.'),
    qflowTenantId: requireNonEmpty(input.qflowTenantId, 'qflowTenantId is required.'),
  });
  const signature = await signDeliveryValue(body, getDeliveryLaunchSigningSecret());
  const response = await fetchImpl(getDeliveryStateUrl(), {
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
    const message = typeof error.error === 'string' && error.error.trim()
      ? error.error.trim()
      : 'QFlowLearn Delivery assignment state could not be verified.';
    throw new DeliveryLaunchConfigurationError(message);
  }
  if (!isDeliveryAssignmentState(payload)) {
    throw new DeliveryLaunchConfigurationError(
      'QFlowLearn Delivery assignment state response is invalid.',
    );
  }
  return payload;
}

export async function signDeliveryLaunchToken(input: DeliveryLaunchInput): Promise<string> {
  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const learner = normalizeLearner(input.learner);
  const claims: DeliveryLaunchTokenClaims = {
    iss: QFLOW_SSO_LAUNCH_TOKEN_ISSUER,
    aud: QFLOW_SSO_LAUNCH_TOKEN_AUDIENCE,
    sub: learner.subject,
    jti: input.tokenId ?? `qlaunch-${crypto.randomUUID()}`,
    iat,
    exp: iat + QFLOW_SSO_LAUNCH_TOKEN_TTL_SECONDS,
    qflowTenantId: requireNonEmpty(input.qflowTenantId, 'qflowTenantId is required.'),
    assignmentId: requireNonEmpty(input.assignmentId, 'assignmentId is required.'),
    learner,
  };
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await signDeliveryValue(payload, getDeliveryLaunchSigningSecret());
  return `${payload}.${signature}`;
}

function normalizeLearner(learner: DeliveryLaunchLearner): DeliveryLaunchLearner {
  const subject = requireNonEmpty(learner.subject, 'learner.subject is required.');
  const displayName = requireNonEmpty(learner.displayName, 'learner.displayName is required.');
  const email = learner.email?.trim() || null;
  return { subject, displayName, email };
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function isDeliveryAssignmentState(value: unknown): value is DeliveryAssignmentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assignment = (value as Record<string, unknown>).assignment;
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) return false;
  const record = assignment as Record<string, unknown>;
  return typeof record.assignmentId === 'string' &&
    typeof record.assessmentId === 'string' &&
    typeof record.assessmentVersionId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.status === 'string' &&
    typeof record.updatedAt === 'string';
}

/** Read aggregate assignment state through the configured, signed delivery state endpoint. */
export async function fetchDeliveryAssessmentStatus(
  input: { qflowTenantId: string; qflowAssessmentId: string; assessmentVersionId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryAssessmentStatus> {
  const body = JSON.stringify({ scope: 'assessment-version', ...input });
  const response = await fetchImpl(getDeliveryStateUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-harbor-qflow-signature': await signDeliveryValue(body, getDeliveryLaunchSigningSecret()),
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new DeliveryLaunchConfigurationError('Delivery status is unavailable.');
  const status = parseDeliveryAssessmentStatus(await response.json(), input.assessmentVersionId);
  if (!status) throw new DeliveryLaunchConfigurationError('Delivery status response is invalid.');
  return status;
}
