import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db.ts';
import {
  migrationAssets,
  migrationBatches,
  migrationCommitJobs,
  migrationItems,
  migrationRuns,
  organizationMemberships,
  users,
} from '../db/schema.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import { hasCapability } from '../roles.ts';
import {
  parseNonNegativeInteger,
  parseOptionalTimestamp,
  parsePositiveInteger,
  parseSha256,
  parseTimestamp,
  parseUuid,
} from '../persistence_parse.ts';
import type { RequestContext } from '../tenants.ts';
import { mapRunSummaryRow } from './migration_run_store.ts';
import {
  draftApprovalColumns,
  migrationApprovalStatus,
  migrationExecutionStatus,
} from './migration_state.ts';
import type {
  MigrationBatchProgress,
  MigrationBatchRecord,
  MigrationBatchRunSummary,
  MigrationBatchStatus,
} from './migration_types.ts';

type MigrationBatchItemCounts = {
  readonly total: number;
  readonly ready: number;
  readonly reviewNeeded: number;
  readonly blocked: number;
  readonly pending: number;
  readonly accepted: number;
  readonly rejected: number;
};

/** Minimal batch context needed to render and authorize one run review. */
export type MigrationBatchReviewContext = {
  readonly id: string;
  readonly purpose: MigrationBatchRecord['purpose'];
  readonly assignedReviewerId: string | null;
  readonly assignedReviewerName: string | null;
  readonly assignedReviewerEmail: string | null;
};

/** Load one tenant-scoped migration batch with aggregate progress. */
export async function getMigrationBatch(
  ctx: RequestContext,
  batchId: string,
): Promise<MigrationBatchRecord | null> {
  const rows = await db.select({
    batch: migrationBatches,
    reviewerName: users.displayName,
    reviewerEmail: users.email,
  }).from(migrationBatches)
    .leftJoin(users, eq(users.id, migrationBatches.assignedReviewerId))
    .where(and(
      eq(migrationBatches.id, batchId),
      eq(migrationBatches.tenantId, ctx.tenantId),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const runRows = await db.select().from(migrationRuns)
    .where(and(
      eq(migrationRuns.batchId, batchId),
      eq(migrationRuns.tenantId, ctx.tenantId),
    ))
    .orderBy(migrationRuns.batchPosition);
  const runs = runRows.map((run) =>
    mapRunSummaryRow(run, {
      purpose: row.batch.purpose,
      createdBy: row.batch.createdBy,
    })
  );
  const runIds = runs.map((run) => run.id);
  const [itemCounts, recoveredAssets] = await Promise.all([
    countBatchItems(runIds),
    countBatchAssets(runIds),
  ]);

  return {
    id: parseUuid(row.batch.id, 'Migration batch ID is invalid.'),
    purpose: parsePurpose(row.batch.purpose),
    createdBy: parseUuid(row.batch.createdBy, 'Migration batch creator is invalid.'),
    idempotencyKey: parseUuid(
      row.batch.idempotencyKey,
      'Migration batch idempotency key is invalid.',
    ),
    requestFingerprint: parseSha256(
      row.batch.requestFingerprint,
      'Migration batch fingerprint is invalid.',
    ),
    sourceCount: parsePositiveInteger(
      row.batch.sourceCount,
      'Migration batch source count is invalid.',
    ),
    status: determineMigrationBatchStatus(runs),
    assignedReviewerId: row.batch.assignedReviewerId ?? null,
    assignedReviewerName: row.reviewerName ?? null,
    assignedReviewerEmail: row.reviewerEmail ?? null,
    assignedBy: row.batch.assignedBy ?? null,
    assignedAt: parseOptionalTimestamp(
      row.batch.assignedAt,
      'Migration batch assignment timestamp is invalid.',
    ),
    createdAt: parseTimestamp(row.batch.createdAt, 'Migration batch created timestamp is invalid.'),
    updatedAt: parseTimestamp(row.batch.updatedAt, 'Migration batch updated timestamp is invalid.'),
    progress: buildMigrationBatchProgress(runs, itemCounts, recoveredAssets),
    runs,
  };
}

/** Load only the batch fields used by one migration report. */
export async function getMigrationBatchReviewContext(
  ctx: RequestContext,
  batchId: string,
): Promise<MigrationBatchReviewContext | null> {
  const rows = await db.select({
    id: migrationBatches.id,
    purpose: migrationBatches.purpose,
    assignedReviewerId: migrationBatches.assignedReviewerId,
    reviewerName: users.displayName,
    reviewerEmail: users.email,
  }).from(migrationBatches)
    .leftJoin(users, eq(users.id, migrationBatches.assignedReviewerId))
    .where(and(
      eq(migrationBatches.id, batchId),
      eq(migrationBatches.tenantId, ctx.tenantId),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: parseUuid(row.id, 'Migration batch ID is invalid.'),
    purpose: parsePurpose(row.purpose),
    assignedReviewerId: row.assignedReviewerId ?? null,
    assignedReviewerName: row.reviewerName ?? null,
    assignedReviewerEmail: row.reviewerEmail ?? null,
  };
}

/** Assign one current workspace member as reviewer for every uncommitted run in a batch. */
export async function assignMigrationBatchReviewer(
  ctx: RequestContext,
  batchId: string,
  reviewerId: string,
): Promise<MigrationBatchRecord> {
  if (!hasCapability(ctx.role, 'manage_content')) {
    throw new Error('You do not have permission to assign migration reviewers.');
  }

  const reviewer = await db.select({ id: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.tenantId, ctx.tenantId),
      eq(organizationMemberships.userId, reviewerId),
    ))
    .limit(1);
  if (!reviewer.length) {
    throw new Error('Choose a reviewer who belongs to this workspace.');
  }

  await db.transaction(async (tx) => {
    const locked = await tx.select({
      id: migrationBatches.id,
      assignedReviewerId: migrationBatches.assignedReviewerId,
    })
      .from(migrationBatches)
      .where(and(
        eq(migrationBatches.id, batchId),
        eq(migrationBatches.tenantId, ctx.tenantId),
      ))
      .for('update')
      .limit(1);
    const batch = locked[0];
    if (!batch) throw new Error('Migration batch not found.');
    if (batch.assignedReviewerId === reviewerId) return;
    const runs = await tx.select({ id: migrationRuns.id }).from(migrationRuns).where(
      eq(migrationRuns.batchId, batchId),
    ).for('update');
    if (runs.length) {
      const [frozen] = await tx.select({ id: migrationCommitJobs.id }).from(migrationCommitJobs)
        .where(inArray(migrationCommitJobs.id, runs.map((run) => run.id))).limit(1);
      if (frozen) throw new Error('A bank commit has frozen this batch reviewer.');
    }

    await tx.update(migrationBatches).set({
      assignedReviewerId: reviewerId,
      assignedBy: ctx.userId,
      assignedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(eq(migrationBatches.id, batchId));
    await tx.update(migrationRuns).set({
      ...draftApprovalColumns(),
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.batchId, batchId),
      eq(migrationRuns.tenantId, ctx.tenantId),
      sql`${migrationRuns.status} <> 'committed'`,
    ));
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'migration_batch_reviewer_assigned',
      metadata: { batchId, reviewerId },
    });
  });

  const batch = await getMigrationBatch(ctx, batchId);
  if (!batch) throw new Error('Migration batch not found after reviewer assignment.');
  return batch;
}

/** Derive aggregate batch progress from durable run and SQL count projections. */
function buildMigrationBatchProgress(
  runs: readonly MigrationBatchRunSummary[],
  items: MigrationBatchItemCounts,
  recoveredAssets: number,
): MigrationBatchProgress {
  const statuses = runs.map((run) => migrationExecutionStatus(run.execution));
  const failedFiles = statuses.filter((status) => status === 'failed').length;
  return {
    files: {
      total: runs.length,
      queued: statuses.filter((status) => status === 'queued').length,
      processing: statuses.filter((status) => status === 'analyzing').length,
      analyzed: statuses.filter((status) => status === 'analyzed').length,
      failed: failedFiles,
      committed: statuses.filter((status) => status === 'committed').length,
    },
    assessments: {
      total: runs.filter((run) => run.destination._tag === 'Assessment').length,
      committed:
        runs.filter((run) =>
          run.destination._tag === 'Assessment' && run.execution._tag === 'Committed'
        ).length,
    },
    items: {
      total: items.total,
      ready: items.ready,
      reviewNeeded: items.reviewNeeded,
      blocked: items.blocked,
      pendingReview: items.pending,
      accepted: items.accepted,
      rejected: items.rejected,
    },
    assets: { recovered: recoveredAssets },
    blockingFindings: {
      total: items.blocked + failedFiles,
      blockedItems: items.blocked,
      failedFiles,
    },
  };
}

/** Derive the batch lifecycle without persisting a second contradictory status. */
function determineMigrationBatchStatus(
  runs: readonly MigrationBatchRunSummary[],
): MigrationBatchStatus {
  const statuses = runs.map((run) => migrationExecutionStatus(run.execution));
  if (!runs.length || statuses.some((status) => status === 'queued')) return 'queued';
  if (statuses.some((status) => status === 'analyzing')) return 'processing';
  if (statuses.every((status) => status === 'failed')) return 'failed';
  if (statuses.every((status) => status === 'failed' || status === 'committed')) {
    return 'completed';
  }
  if (runs.some((run) => migrationApprovalStatus(run.approval) !== 'draft')) {
    return 'approval';
  }
  return 'review';
}

async function countBatchItems(runIds: readonly string[]): Promise<MigrationBatchItemCounts> {
  if (!runIds.length) return emptyItemCounts();
  const rows = await db.select({
    total: count(migrationItems.id),
    ready: sql<
      number
    >`coalesce(sum(case when ${migrationItems.readiness} = 'ready' then 1 else 0 end), 0)`.mapWith(
      Number,
    ),
    reviewNeeded: sql<
      number
    >`coalesce(sum(case when ${migrationItems.readiness} in ('minor_review', 'major_review') then 1 else 0 end), 0)`
      .mapWith(
        Number,
      ),
    blocked: sql<
      number
    >`coalesce(sum(case when ${migrationItems.readiness} = 'blocked' then 1 else 0 end), 0)`
      .mapWith(
        Number,
      ),
    pending: sql<
      number
    >`coalesce(sum(case when ${migrationItems.decision} = 'pending' then 1 else 0 end), 0)`.mapWith(
      Number,
    ),
    accepted: sql<
      number
    >`coalesce(sum(case when ${migrationItems.decision} = 'accepted' then 1 else 0 end), 0)`
      .mapWith(
        Number,
      ),
    rejected: sql<
      number
    >`coalesce(sum(case when ${migrationItems.decision} = 'rejected' then 1 else 0 end), 0)`
      .mapWith(
        Number,
      ),
  }).from(migrationItems).where(inArray(migrationItems.runId, [...runIds]));
  const row = rows[0];
  return row
    ? {
      total: parseNonNegativeInteger(row.total, 'Migration item total is invalid.'),
      ready: parseNonNegativeInteger(row.ready, 'Migration ready-item total is invalid.'),
      reviewNeeded: parseNonNegativeInteger(
        row.reviewNeeded,
        'Migration review-item total is invalid.',
      ),
      blocked: parseNonNegativeInteger(row.blocked, 'Migration blocked-item total is invalid.'),
      pending: parseNonNegativeInteger(row.pending, 'Migration pending-item total is invalid.'),
      accepted: parseNonNegativeInteger(
        row.accepted,
        'Migration accepted-item total is invalid.',
      ),
      rejected: parseNonNegativeInteger(
        row.rejected,
        'Migration rejected-item total is invalid.',
      ),
    }
    : emptyItemCounts();
}

async function countBatchAssets(runIds: readonly string[]): Promise<number> {
  if (!runIds.length) return 0;
  const rows = await db.select({ total: count(migrationAssets.id) })
    .from(migrationAssets)
    .where(inArray(migrationAssets.runId, [...runIds]));
  return parseNonNegativeInteger(rows[0]?.total ?? 0, 'Migration asset total is invalid.');
}

function emptyItemCounts(): MigrationBatchItemCounts {
  return {
    total: 0,
    ready: 0,
    reviewNeeded: 0,
    blocked: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
  };
}

function parsePurpose(value: string): MigrationBatchRecord['purpose'] {
  if (value === 'recover_existing' || value === 'generate_new') return value;
  throw new Error(`Invalid migration batch purpose: ${value}`);
}
