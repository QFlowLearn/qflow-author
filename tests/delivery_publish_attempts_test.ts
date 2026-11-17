import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentDeliveryPublishAttempts,
  assessmentExportReceipts,
  assessments,
  organizationMemberships,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { buildDeliveryPublishRequest } from '../lib/delivery_publish.ts';
import {
  claimDeliveryPublishAttempt,
  completeDeliveryPublishAttempt,
  markDeliveryPublishAttemptRetryable,
  prepareDeliveryPublishAttempt,
} from '../lib/services/delivery_publish_attempts.ts';
import { sha256Hex } from '../lib/sha256.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase('delivery publish attempts retain one remote identity across replay and recovery', {
  skip: !process.env['DATABASE_URL'],
}, async function () {
  const fixture = await createFixture();
  const { auth, assessmentId, exportReceiptId, preflightId, replayExportReceiptId } = fixture;
  const firstAttemptId = crypto.randomUUID();
  const firstRequest = deliveryRequest(auth, assessmentId, exportReceiptId, firstAttemptId);

  try {
    const prepared = await prepareDeliveryPublishAttempt(auth, {
      attemptId: firstAttemptId,
      assessmentId,
      exportReceiptId,
      preflightId,
      request: firstRequest,
      now: new Date('2026-08-16T10:00:00.000Z'),
    });
    expect(prepared.phase).toStrictEqual('prepared');

    const replayAttemptId = crypto.randomUUID();
    const replay = await prepareDeliveryPublishAttempt(auth, {
      attemptId: replayAttemptId,
      assessmentId,
      exportReceiptId: replayExportReceiptId,
      preflightId,
      request: deliveryRequest(auth, assessmentId, replayExportReceiptId, replayAttemptId),
      now: new Date('2026-08-16T10:00:01.000Z'),
    });
    expect(replay.id).toStrictEqual(prepared.id);
    expect(replay.request.publishId).toStrictEqual(firstRequest.publishId);

    const firstClaim = await claimDeliveryPublishAttempt(auth, assessmentId, prepared.id, {
      now: new Date('2026-08-16T10:01:00.000Z'),
    });
    if (!(firstClaim._tag === 'Claimed')) {
      expect.unreachable("Expected firstClaim._tag === 'Claimed'");
    }
    expect(
      await claimDeliveryPublishAttempt(auth, assessmentId, prepared.id, {
        now: new Date('2026-08-16T10:01:30.000Z'),
      }),
    ).toStrictEqual({ _tag: 'Busy' });

    const recoveredClaim = await claimDeliveryPublishAttempt(auth, assessmentId, prepared.id, {
      now: new Date('2026-08-16T10:04:00.000Z'),
    });
    if (!(recoveredClaim._tag === 'Claimed')) {
      expect.unreachable("Expected recoveredClaim._tag === 'Claimed'");
    }
    expect(recoveredClaim.attempt.request.publishId).toStrictEqual(
      firstClaim.attempt.request.publishId,
    );
    expect(recoveredClaim.attempt.attemptCount).toStrictEqual(2);
    expect(
      await markDeliveryPublishAttemptRetryable(auth, {
        assessmentId,
        attemptId: recoveredClaim.attempt.id,
        leaseToken: recoveredClaim.attempt.leaseToken,
        failure: { code: 'delivery_publish_unavailable', message: 'Harbor was unavailable.' },
        now: new Date('2026-08-16T10:04:10.000Z'),
      }),
    ).toStrictEqual(true);

    const retryClaim = await claimDeliveryPublishAttempt(auth, assessmentId, prepared.id, {
      now: new Date('2026-08-16T10:04:11.000Z'),
    });
    if (!(retryClaim._tag === 'Claimed')) {
      expect.unreachable("Expected retryClaim._tag === 'Claimed'");
    }
    expect(retryClaim.attempt.request.publishId).toStrictEqual(firstRequest.publishId);

    await db.update(assessments).set({
      metadata: { unrelated: 'preserved', concurrent: true },
    }).where(eq(assessments.id, assessmentId));
    const completed = await completeDeliveryPublishAttempt(auth, {
      assessmentId,
      attemptId: retryClaim.attempt.id,
      leaseToken: retryClaim.attempt.leaseToken,
      response: {
        publishId: firstRequest.publishId,
        status: 'published',
        version: {
          assessmentId: 'harbor-assessment-1',
          assessmentVersionId: 'harbor-version-1',
        },
        links: { previewUrl: 'https://delivery.example/session' },
      },
      now: new Date('2026-08-16T10:04:20.000Z'),
    });
    expect(completed.phase).toStrictEqual('published');

    const publishedReplay = await claimDeliveryPublishAttempt(auth, assessmentId, prepared.id);
    if (!(publishedReplay._tag === 'Published')) {
      expect.unreachable("Expected publishedReplay._tag === 'Published'");
    }
    expect(publishedReplay.attempt.response.version.assessmentVersionId).toStrictEqual(
      'harbor-version-1',
    );
    const assessmentRows = await db.select({ metadata: assessments.metadata }).from(assessments)
      .where(eq(assessments.id, assessmentId));
    const metadata = requireRecord(assessmentRows[0]?.metadata);
    expect(metadata.unrelated).toStrictEqual('preserved');
    expect(metadata.concurrent).toStrictEqual(true);
    const delivery = requireRecord(metadata.delivery);
    const latestPublish = requireRecord(delivery.latestPublish);
    expect(latestPublish.publishId).toStrictEqual(firstRequest.publishId);
    expect(latestPublish.assessmentVersionId).toStrictEqual('harbor-version-1');

    const attemptRows = await db.select({ id: assessmentDeliveryPublishAttempts.id })
      .from(assessmentDeliveryPublishAttempts)
      .where(eq(assessmentDeliveryPublishAttempts.preflightId, preflightId));
    expect(attemptRows).toStrictEqual([{ id: firstAttemptId }]);
  } finally {
    await deleteFixture(fixture);
  }
});

async function createFixture(): Promise<{
  readonly auth: RequestContext;
  readonly assessmentId: string;
  readonly exportReceiptId: string;
  readonly replayExportReceiptId: string;
  readonly preflightId: string;
}> {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assessmentId = crypto.randomUUID();
  const auth: RequestContext = { tenantId, userId, role: 'owner' };
  const email = `delivery-attempt-${userId.slice(0, 8)}@example.com`;
  await db.insert(tenants).values({
    id: tenantId,
    slug: `delivery-attempt-${tenantId.slice(0, 8)}`,
    name: 'Delivery attempt test',
  });
  await db.insert(users).values({ id: userId, email, emailNormalized: email });
  await db.insert(organizationMemberships).values({
    id: crypto.randomUUID(),
    tenantId,
    userId,
    role: 'owner',
  });
  await db.insert(assessments).values({
    id: assessmentId,
    tenantId,
    slug: assessmentId,
    title: 'Durable delivery test',
    status: 'draft',
    createdBy: userId,
    metadata: { before: 'initial' },
    blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
  });

  const exportReceiptId = await sha256Hex(
    new TextEncoder().encode(`delivery-export:${assessmentId}`),
  );
  const replayExportReceiptId = await sha256Hex(
    new TextEncoder().encode(`delivery-export-replay:${assessmentId}`),
  );
  const preflightId = await sha256Hex(new TextEncoder().encode(`preflight:${assessmentId}`));
  const createdAt = new Date('2026-08-16T09:59:00.000Z');
  await Promise.all([
    insertExportReceipt({
      id: exportReceiptId,
      tenantId,
      userId,
      assessmentId,
      preflightId,
      createdAt,
    }),
    insertExportReceipt({
      id: replayExportReceiptId,
      tenantId,
      userId,
      assessmentId,
      preflightId,
      createdAt: new Date('2026-08-16T09:59:01.000Z'),
    }),
  ]);
  return { auth, assessmentId, exportReceiptId, replayExportReceiptId, preflightId };
}

async function insertExportReceipt(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly assessmentId: string;
  readonly preflightId: string;
  readonly createdAt: Date;
}): Promise<void> {
  const receipt = {
    receiptId: input.id,
    schema: 'qflow.export-receipt.v1',
    authorizedBy: input.userId,
    preflightId: input.preflightId,
    assessment: { id: input.assessmentId },
    target: { destinationId: 'qti3-conformant' },
    requirements: {
      scoring: { _tag: 'AutomaticScoringRequired' },
      interaction: { _tag: 'BehaviorMustBePreserved' },
    },
    acknowledgements: [],
  };
  await db.insert(assessmentExportReceipts).values({
    id: input.id,
    tenantId: input.tenantId,
    assessmentId: input.assessmentId,
    createdBy: input.userId,
    authorizedBy: input.userId,
    preflightId: input.preflightId,
    targetId: 'qti3-conformant',
    scoringSelection: 'automatic',
    interactionSelection: 'preserve',
    acknowledgementToken: null,
    schema: receipt.schema,
    receipt: JSON.stringify(receipt),
    createdAt: input.createdAt,
  });
}

function deliveryRequest(
  auth: RequestContext,
  assessmentId: string,
  exportReceiptId: string,
  attemptId: string,
) {
  return buildDeliveryPublishRequest(
    auth,
    { id: assessmentId, title: 'Durable delivery test' },
    `http://127.0.0.1/api/assessments/${assessmentId}/package?receiptId=${exportReceiptId}`,
    {
      publishId: `qflow-${attemptId}`,
      now: new Date('2026-08-16T10:00:00.000Z'),
    },
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a record.');
  }
  // SAFETY: The value is a non-null, non-array object and is used only for test assertions.
  return value as Record<string, unknown>;
}

async function deleteFixture(input: {
  readonly auth: RequestContext;
  readonly assessmentId: string;
  readonly exportReceiptId: string;
  readonly replayExportReceiptId: string;
}): Promise<void> {
  await db.delete(assessmentDeliveryPublishAttempts).where(
    eq(assessmentDeliveryPublishAttempts.assessmentId, input.assessmentId),
  ).catch(() => {});
  await db.delete(assessmentExportReceipts).where(
    eq(assessmentExportReceipts.id, input.exportReceiptId),
  ).catch(() => {});
  await db.delete(assessmentExportReceipts).where(
    eq(assessmentExportReceipts.id, input.replayExportReceiptId),
  ).catch(() => {});
  await db.delete(assessments).where(eq(assessments.id, input.assessmentId)).catch(() => {});
  await db.delete(organizationMemberships).where(
    eq(organizationMemberships.tenantId, input.auth.tenantId),
  ).catch(() => {});
  await db.delete(users).where(eq(users.id, input.auth.userId)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, input.auth.tenantId)).catch(() => {});
  await shutdownDb().catch(() => {});
}
