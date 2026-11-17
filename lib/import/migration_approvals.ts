import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db.ts';
import { migrationBatches, migrationItems, migrationRuns } from '../db/schema.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import type { RequestContext } from '../tenants.ts';
import { type MigrationApprovalState, parseMigrationApprovalState } from './migration_state.ts';

export interface MigrationApprovalReceipt {
  readonly runId: string;
  readonly approval: MigrationApprovalState;
}

/** Submit a fully reviewed recovery run to its batch reviewer. */
export async function submitMigrationRunForApproval(
  ctx: RequestContext,
  runId: string,
): Promise<MigrationApprovalReceipt> {
  await db.transaction(async (tx) => {
    const rows = await tx.select({
      run: migrationRuns,
      purpose: migrationBatches.purpose,
      assignedReviewerId: migrationBatches.assignedReviewerId,
    }).from(migrationRuns)
      .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
      .where(and(
        eq(migrationRuns.id, runId),
        eq(migrationRuns.tenantId, ctx.tenantId),
      ))
      .for('update')
      .limit(1);
    if (!rows.length) throw new Error('Conversion run not found.');
    const row = rows[0];
    if (row.purpose !== 'recover_existing' || row.run.status !== 'analyzed') {
      throw new Error('Only analyzed recovery runs can be submitted for approval.');
    }
    if (
      row.run.approvalStatus !== 'draft' &&
      row.run.approvalStatus !== 'changes_requested'
    ) {
      throw new Error('This conversion is already in the approval stage.');
    }
    if (!row.assignedReviewerId) {
      throw new Error('Assign a batch reviewer before submitting this conversion.');
    }
    await assertReviewComplete(tx, runId);

    const submitted = await tx.update(migrationRuns).set({
      approvalStatus: 'submitted',
      submittedBy: ctx.userId,
      submittedAt: sql`now()`,
      decidedBy: null,
      decidedAt: null,
      approvalNote: null,
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, runId),
      eq(migrationRuns.status, 'analyzed'),
      sql`${migrationRuns.approvalStatus} in ('draft', 'changes_requested')`,
    )).returning({ id: migrationRuns.id });
    if (!submitted.length) {
      throw new Error('This conversion changed before it could be submitted.');
    }
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'migration_approval_submitted',
      metadata: {
        batchId: row.run.batchId,
        runId,
        reviewerId: row.assignedReviewerId,
      },
    });
  });
  return await requireRun(ctx, runId);
}

/** Record the assigned reviewer's decision for one submitted recovery run. */
export async function decideMigrationRunApproval(
  ctx: RequestContext,
  runId: string,
  input: {
    readonly decision: 'approve' | 'request_changes';
    readonly note?: string | null;
  },
): Promise<MigrationApprovalReceipt> {
  const note = input.note?.trim() || null;
  if (input.decision === 'request_changes' && !note) {
    throw new Error('Explain what needs to change before returning this conversion.');
  }

  await db.transaction(async (tx) => {
    const rows = await tx.select({
      run: migrationRuns,
      assignedReviewerId: migrationBatches.assignedReviewerId,
    }).from(migrationRuns)
      .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
      .where(and(
        eq(migrationRuns.id, runId),
        eq(migrationRuns.tenantId, ctx.tenantId),
      ))
      .for('update')
      .limit(1);
    if (!rows.length) throw new Error('Conversion run not found.');
    const row = rows[0];
    if (row.assignedReviewerId !== ctx.userId) {
      throw new Error('Only the assigned batch reviewer can decide this conversion.');
    }
    if (row.run.status !== 'analyzed' || row.run.approvalStatus !== 'submitted') {
      throw new Error('Only submitted conversions can receive an approval decision.');
    }
    if (input.decision === 'approve') await assertReviewComplete(tx, runId);

    const approvalStatus = input.decision === 'approve' ? 'approved' : 'changes_requested';
    const decided = await tx.update(migrationRuns).set({
      approvalStatus,
      decidedBy: ctx.userId,
      decidedAt: sql`now()`,
      approvalNote: note,
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, runId),
      eq(migrationRuns.status, 'analyzed'),
      eq(migrationRuns.approvalStatus, 'submitted'),
    )).returning({ id: migrationRuns.id });
    if (!decided.length) {
      throw new Error('This conversion changed before the decision was saved.');
    }
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: input.decision === 'approve'
        ? 'migration_approval_granted'
        : 'migration_changes_requested',
      metadata: {
        batchId: row.run.batchId,
        runId,
        note,
      },
    });
  });
  return await requireRun(ctx, runId);
}

type ApprovalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertReviewComplete(tx: ApprovalTransaction, runId: string): Promise<void> {
  const items = await tx.select({
    decision: migrationItems.decision,
    readiness: migrationItems.readiness,
  }).from(migrationItems)
    .where(eq(migrationItems.runId, runId))
    .for('update');
  if (!items.length) throw new Error('Recover at least one question before requesting approval.');
  if (items.some((item) => item.decision === 'pending')) {
    throw new Error('Accept or reject every question before requesting approval.');
  }
  if (!items.some((item) => item.decision === 'accepted')) {
    throw new Error('Accept at least one question before requesting approval.');
  }
  if (items.some((item) => item.readiness === 'blocked' && item.decision !== 'rejected')) {
    throw new Error('Reject or correct every blocked question before requesting approval.');
  }
}

async function requireRun(ctx: RequestContext, runId: string): Promise<MigrationApprovalReceipt> {
  const [run] = await db.select({
    approvalStatus: migrationRuns.approvalStatus,
    submittedBy: migrationRuns.submittedBy,
    submittedAt: migrationRuns.submittedAt,
    decidedBy: migrationRuns.decidedBy,
    decidedAt: migrationRuns.decidedAt,
    approvalNote: migrationRuns.approvalNote,
  }).from(migrationRuns).where(and(
    eq(migrationRuns.id, runId),
    eq(migrationRuns.tenantId, ctx.tenantId),
  )).limit(1);
  if (!run) throw new Error('Conversion run not found.');
  return { runId, approval: parseMigrationApprovalState(run) };
}
