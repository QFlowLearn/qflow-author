import { assessmentDeliveryPublishAttempts } from '../db/schema.ts';
import {
  type DeliveryPublishRequest,
  type DeliveryPublishResponse,
  parseDeliveryPublishRequestPayload,
  parseDeliveryPublishResponsePayload,
} from '../delivery_publish.ts';

type DeliveryPublishAttemptBase = {
  readonly id: string;
  readonly tenantId: string;
  readonly assessmentId: string;
  readonly createdBy: string;
  readonly exportReceiptId: string;
  readonly preflightId: string;
  readonly request: DeliveryPublishRequest;
  readonly attemptCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** Persisted Harbor publish lifecycle reconstructed from one validated database row. */
export type DeliveryPublishAttempt =
  | DeliveryPublishAttemptBase & {
    readonly phase: 'prepared';
  }
  | DeliveryPublishAttemptBase & {
    readonly phase: 'publishing';
    readonly leaseToken: string;
    readonly leaseExpiresAt: Date;
  }
  | DeliveryPublishAttemptBase & {
    readonly phase: 'retryable';
    readonly failure: { readonly code: string; readonly message: string };
  }
  | DeliveryPublishAttemptBase & {
    readonly phase: 'published';
    readonly response: DeliveryPublishResponse;
    readonly publishedAt: Date;
  };

/** Result of atomically claiming one Harbor publish side effect. */
export type ClaimDeliveryPublishAttemptResult =
  | {
    readonly _tag: 'Claimed';
    readonly attempt: Extract<DeliveryPublishAttempt, { readonly phase: 'publishing' }>;
  }
  | {
    readonly _tag: 'Published';
    readonly attempt: Extract<DeliveryPublishAttempt, { readonly phase: 'published' }>;
  }
  | { readonly _tag: 'Busy' }
  | { readonly _tag: 'NotFound' };

/** The active publisher no longer owns the attempt lease. */
export class DeliveryPublishAttemptLeaseLostError extends Error {
  readonly _tag = 'DeliveryPublishAttemptLeaseLostError' as const;

  constructor() {
    super('Delivery publish attempt lease was lost.');
    this.name = 'DeliveryPublishAttemptLeaseLostError';
  }
}

/** Reconstruct and validate one persisted Harbor attempt state. */
export function parseDeliveryPublishAttemptRow(
  row: typeof assessmentDeliveryPublishAttempts.$inferSelect,
): DeliveryPublishAttempt {
  const request = parseDeliveryPublishRequestPayload(row.request);
  if (
    !request ||
    request.publishId !== `qflow-${row.id}` ||
    request.qflowTenantId !== row.tenantId ||
    request.qflowAssessmentId !== row.assessmentId ||
    request.actorId !== row.createdBy ||
    !request.issuedAt ||
    new URL(request.packageUrl).searchParams.get('receiptId') !== row.exportReceiptId ||
    !/^[0-9a-f]{64}$/.test(row.preflightId) ||
    !(row.createdAt instanceof Date) ||
    !(row.updatedAt instanceof Date) ||
    !Number.isSafeInteger(row.attemptCount) ||
    row.attemptCount < 0
  ) throw new Error('Persisted delivery publish attempt is invalid.');
  const base: DeliveryPublishAttemptBase = {
    id: row.id,
    tenantId: row.tenantId,
    assessmentId: row.assessmentId,
    createdBy: row.createdBy,
    exportReceiptId: row.exportReceiptId,
    preflightId: row.preflightId,
    request,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  switch (row.phase) {
    case 'prepared': {
      if (
        row.attemptCount !== 0 ||
        row.leaseToken !== null ||
        row.leaseExpiresAt !== null ||
        row.failureCode !== null ||
        row.failureMessage !== null ||
        row.response !== null ||
        row.publishedAt !== null
      ) break;
      return { ...base, phase: 'prepared' };
    }
    case 'publishing': {
      if (
        row.attemptCount < 1 ||
        !row.leaseToken ||
        !(row.leaseExpiresAt instanceof Date) ||
        row.failureCode !== null ||
        row.failureMessage !== null ||
        row.response !== null ||
        row.publishedAt !== null
      ) break;
      return {
        ...base,
        phase: 'publishing',
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
      };
    }
    case 'retryable': {
      if (
        row.attemptCount < 1 ||
        row.leaseToken !== null ||
        row.leaseExpiresAt !== null ||
        !row.failureCode ||
        !row.failureMessage ||
        row.response !== null ||
        row.publishedAt !== null
      ) break;
      return {
        ...base,
        phase: 'retryable',
        failure: { code: row.failureCode, message: row.failureMessage },
      };
    }
    case 'published': {
      const response = parseDeliveryPublishResponsePayload(row.response, request.publishId);
      if (
        row.attemptCount < 1 ||
        row.leaseToken !== null ||
        row.leaseExpiresAt !== null ||
        row.failureCode !== null ||
        row.failureMessage !== null ||
        !response ||
        !(row.publishedAt instanceof Date)
      ) break;
      return { ...base, phase: 'published', response, publishedAt: row.publishedAt };
    }
  }
  throw new Error('Persisted delivery publish attempt state is invalid.');
}

export function deliveryPublishRequestJson(
  request: DeliveryPublishRequest,
): Record<string, unknown> {
  return {
    publishId: request.publishId,
    qflowTenantId: request.qflowTenantId,
    qflowAssessmentId: request.qflowAssessmentId,
    packageUrl: request.packageUrl,
    ...(request.assessmentSlug === undefined ? {} : { assessmentSlug: request.assessmentSlug }),
    ...(request.packageName === undefined ? {} : { packageName: request.packageName }),
    ...(request.exportFormat === undefined ? {} : { exportFormat: request.exportFormat }),
    ...(request.actorId === undefined ? {} : { actorId: request.actorId }),
    ...(request.issuedAt === undefined ? {} : { issuedAt: request.issuedAt }),
  };
}

export function deliveryPublishResponseJson(
  response: DeliveryPublishResponse,
): Record<string, unknown> {
  return {
    publishId: response.publishId,
    status: response.status,
    version: {
      assessmentId: response.version.assessmentId,
      assessmentVersionId: response.version.assessmentVersionId,
      ...(response.version.sourcePackageSha256 === undefined
        ? {}
        : { sourcePackageSha256: response.version.sourcePackageSha256 }),
    },
    ...(response.links === undefined ? {} : { links: response.links }),
    ...(response.warnings === undefined ? {} : { warnings: response.warnings }),
  };
}
