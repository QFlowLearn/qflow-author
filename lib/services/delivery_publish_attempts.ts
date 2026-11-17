import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { db, type QflowDatabase } from '../db.ts';
import {
  assessmentDeliveryPublishAttempts,
  assessmentExportReceipts,
  assessments,
} from '../db/schema.ts';
import {
  type DeliveryPublishRequest,
  type DeliveryPublishResponse,
  mergeDeliveryPublishMetadata,
  parseDeliveryPublishRequestPayload,
  parseDeliveryPublishResponsePayload,
} from '../delivery_publish.ts';
import type { RequestContext } from '../tenants.ts';
import {
  type ClaimDeliveryPublishAttemptResult,
  type DeliveryPublishAttempt,
  DeliveryPublishAttemptLeaseLostError,
  deliveryPublishRequestJson,
  deliveryPublishResponseJson,
  parseDeliveryPublishAttemptRow,
} from './delivery_publish_attempt_state.ts';

const DELIVERY_PUBLISH_LEASE_MS = 2 * 60 * 1000;

/** Persist or replay the sole Harbor attempt for one deterministic export preflight. */
export async function prepareDeliveryPublishAttempt(
  auth: RequestContext,
  input: {
    readonly attemptId: string;
    readonly assessmentId: string;
    readonly exportReceiptId: string;
    readonly preflightId: string;
    readonly request: DeliveryPublishRequest;
    readonly now?: Date;
  },
  database: QflowDatabase = db,
): Promise<DeliveryPublishAttempt> {
  assertPreparedRequest(auth, input);
  const now = input.now ?? new Date();
  return await database.transaction(async (tx) => {
    const receipts = await tx.select({ id: assessmentExportReceipts.id })
      .from(assessmentExportReceipts)
      .where(and(
        eq(assessmentExportReceipts.id, input.exportReceiptId),
        eq(assessmentExportReceipts.tenantId, auth.tenantId),
        eq(assessmentExportReceipts.assessmentId, input.assessmentId),
        eq(assessmentExportReceipts.preflightId, input.preflightId),
      ))
      .limit(1);
    if (receipts.length === 0) throw new Error('Delivery export receipt was not found.');

    const inserted = await tx.insert(assessmentDeliveryPublishAttempts).values({
      id: input.attemptId,
      tenantId: auth.tenantId,
      assessmentId: input.assessmentId,
      createdBy: auth.userId,
      exportReceiptId: input.exportReceiptId,
      preflightId: input.preflightId,
      request: deliveryPublishRequestJson(input.request),
      phase: 'prepared',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({
      target: [
        assessmentDeliveryPublishAttempts.tenantId,
        assessmentDeliveryPublishAttempts.assessmentId,
        assessmentDeliveryPublishAttempts.preflightId,
      ],
    }).returning();
    if (inserted[0]) return parseDeliveryPublishAttemptRow(inserted[0]);

    const existing = await tx.select().from(assessmentDeliveryPublishAttempts).where(and(
      eq(assessmentDeliveryPublishAttempts.tenantId, auth.tenantId),
      eq(assessmentDeliveryPublishAttempts.assessmentId, input.assessmentId),
      eq(assessmentDeliveryPublishAttempts.preflightId, input.preflightId),
    )).limit(1);
    if (!existing[0]) throw new Error('Concurrent delivery publish attempt was not found.');
    return parseDeliveryPublishAttemptRow(existing[0]);
  });
}

/** Claim a prepared, retryable, or expired Harbor publish using one bounded lease. */
export async function claimDeliveryPublishAttempt(
  auth: RequestContext,
  assessmentId: string,
  attemptId: string,
  options: { readonly now?: Date; readonly database?: QflowDatabase } = {},
): Promise<ClaimDeliveryPublishAttemptResult> {
  const now = options.now ?? new Date();
  const database = options.database ?? db;
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + DELIVERY_PUBLISH_LEASE_MS);
  const claimed = await database.update(assessmentDeliveryPublishAttempts).set({
    phase: 'publishing',
    attemptCount: sql`${assessmentDeliveryPublishAttempts.attemptCount} + 1`,
    leaseToken,
    leaseExpiresAt,
    failureCode: null,
    failureMessage: null,
    updatedAt: now,
  }).where(and(
    scopedAttempt(auth, assessmentId, attemptId),
    or(
      inArray(assessmentDeliveryPublishAttempts.phase, ['prepared', 'retryable']),
      and(
        eq(assessmentDeliveryPublishAttempts.phase, 'publishing'),
        lte(assessmentDeliveryPublishAttempts.leaseExpiresAt, now),
      ),
    ),
  )).returning();
  if (claimed[0]) {
    const attempt = parseDeliveryPublishAttemptRow(claimed[0]);
    if (attempt.phase !== 'publishing') throw new Error('Claimed delivery attempt is invalid.');
    return { _tag: 'Claimed', attempt };
  }

  const rows = await database.select().from(assessmentDeliveryPublishAttempts)
    .where(scopedAttempt(auth, assessmentId, attemptId))
    .limit(1);
  if (!rows[0]) return { _tag: 'NotFound' };
  const attempt = parseDeliveryPublishAttemptRow(rows[0]);
  return attempt.phase === 'published' ? { _tag: 'Published', attempt } : { _tag: 'Busy' };
}

/** Complete one claimed Harbor publish and merge its receipt into current assessment metadata. */
export async function completeDeliveryPublishAttempt(
  auth: RequestContext,
  input: {
    readonly assessmentId: string;
    readonly attemptId: string;
    readonly leaseToken: string;
    readonly response: DeliveryPublishResponse;
    readonly now?: Date;
  },
  database: QflowDatabase = db,
): Promise<Extract<DeliveryPublishAttempt, { readonly phase: 'published' }>> {
  const expectedPublishId = `qflow-${input.attemptId}`;
  const response = parseDeliveryPublishResponsePayload(input.response, expectedPublishId);
  if (!response) throw new Error('Delivery publish response is invalid.');
  const now = input.now ?? new Date();

  return await database.transaction(async (tx) => {
    const assessmentRows = await tx.select({ metadata: assessments.metadata })
      .from(assessments)
      .where(and(
        eq(assessments.id, input.assessmentId),
        eq(assessments.tenantId, auth.tenantId),
      ))
      .for('update')
      .limit(1);
    if (!assessmentRows[0]) throw new Error('Assessment not found.');

    const completed = await tx.update(assessmentDeliveryPublishAttempts).set({
      phase: 'published',
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: null,
      failureMessage: null,
      response: deliveryPublishResponseJson(response),
      publishedAt: now,
      updatedAt: now,
    }).where(and(
      scopedAttempt(auth, input.assessmentId, input.attemptId),
      eq(assessmentDeliveryPublishAttempts.phase, 'publishing'),
      eq(assessmentDeliveryPublishAttempts.leaseToken, input.leaseToken),
    )).returning();
    if (!completed[0]) {
      const existing = await tx.select().from(assessmentDeliveryPublishAttempts)
        .where(scopedAttempt(auth, input.assessmentId, input.attemptId))
        .limit(1);
      if (existing[0]) {
        const attempt = parseDeliveryPublishAttemptRow(existing[0]);
        if (attempt.phase === 'published') return attempt;
      }
      throw new DeliveryPublishAttemptLeaseLostError();
    }

    const currentMetadata = isRecord(assessmentRows[0].metadata) ? assessmentRows[0].metadata : {};
    await tx.update(assessments).set({
      metadata: mergeDeliveryPublishMetadata(currentMetadata, response, now),
      updatedAt: sql`now()`,
    }).where(and(
      eq(assessments.id, input.assessmentId),
      eq(assessments.tenantId, auth.tenantId),
    ));
    const attempt = parseDeliveryPublishAttemptRow(completed[0]);
    if (attempt.phase !== 'published') throw new Error('Completed delivery attempt is invalid.');
    return attempt;
  });
}

/** Release one claimed attempt for a safe retry with the same remote publish identity. */
export async function markDeliveryPublishAttemptRetryable(
  auth: RequestContext,
  input: {
    readonly assessmentId: string;
    readonly attemptId: string;
    readonly leaseToken: string;
    readonly failure: { readonly code: string; readonly message: string };
    readonly now?: Date;
  },
  database: QflowDatabase = db,
): Promise<boolean> {
  const code = input.failure.code.trim().slice(0, 120);
  const message = input.failure.message.trim().slice(0, 1000);
  if (!code || !message) throw new Error('Delivery publish retry failure is invalid.');
  const rows = await database.update(assessmentDeliveryPublishAttempts).set({
    phase: 'retryable',
    leaseToken: null,
    leaseExpiresAt: null,
    failureCode: code,
    failureMessage: message,
    updatedAt: input.now ?? new Date(),
  }).where(and(
    scopedAttempt(auth, input.assessmentId, input.attemptId),
    eq(assessmentDeliveryPublishAttempts.phase, 'publishing'),
    eq(assessmentDeliveryPublishAttempts.leaseToken, input.leaseToken),
  )).returning({ id: assessmentDeliveryPublishAttempts.id });
  return rows.length > 0;
}

function assertPreparedRequest(
  auth: RequestContext,
  input: {
    readonly attemptId: string;
    readonly assessmentId: string;
    readonly exportReceiptId: string;
    readonly preflightId: string;
    readonly request: DeliveryPublishRequest;
  },
): void {
  const parsed = parseDeliveryPublishRequestPayload(input.request);
  if (
    !/^[0-9a-f]{64}$/.test(input.preflightId) ||
    !parsed ||
    parsed.publishId !== `qflow-${input.attemptId}` ||
    parsed.qflowTenantId !== auth.tenantId ||
    parsed.qflowAssessmentId !== input.assessmentId ||
    parsed.actorId !== auth.userId ||
    !parsed.issuedAt ||
    new URL(parsed.packageUrl).searchParams.get('receiptId') !== input.exportReceiptId
  ) {
    throw new Error('Delivery publish attempt request is invalid.');
  }
}

function scopedAttempt(auth: RequestContext, assessmentId: string, attemptId: string) {
  return and(
    eq(assessmentDeliveryPublishAttempts.id, attemptId),
    eq(assessmentDeliveryPublishAttempts.tenantId, auth.tenantId),
    eq(assessmentDeliveryPublishAttempts.assessmentId, assessmentId),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
