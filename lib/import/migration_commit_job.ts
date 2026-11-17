import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import {
  migrationAssets,
  migrationBatches,
  migrationCommitJobs,
  migrationCommitSelections,
  migrationItems,
  migrationRuns,
  organizationMemberships,
  workflowDispatches,
} from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { ObjectWriteLifecycle } from '../storage_contract.ts';
import { parseRole } from '../roles.ts';
import { authorizeBankIntakeInTransaction } from '../services/bank_intake_access.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import type { WorkflowTerminalDomainOutcome } from '../job_failure.ts';
import {
  cleanupStagedImportAssets,
  commitImportResultInTransaction,
  prepareImportQuestionRevisions,
  stageImportAssets,
  throwAfterImportAssetCleanup,
} from './commit_import_result.ts';
import {
  assertConversionCommitApproval,
  buildMigrationQuestionReferences,
} from './migration_run_commit.ts';
import { getMigrationRun } from './migration_run_queries.ts';
import { importResultFromRun } from './migration_run_store.ts';
import type { MigrationRunRecord } from './migration_types.ts';

const COMMIT_BATCH_SIZE = 500;
const COMMIT_BATCH_CONTENT_BYTES = 2 * 1024 * 1024;

/** Freeze the explicitly approved selection and enqueue its durable bank commit atomically. */
export async function enqueueMigrationCommit(
  ctx: RequestContext,
  runId: string,
  approvedIds: readonly string[],
  approval: boolean,
  database: QflowDatabase = db,
): Promise<void> {
  if (!approval || !approvedIds.length || new Set(approvedIds).size !== approvedIds.length) {
    throw new Error('Approve a unique, nonempty question selection.');
  }
  await database.transaction(async (tx) => {
    const [destination] = await tx.select({ collectionId: migrationRuns.collectionId }).from(
      migrationRuns,
    ).where(and(eq(migrationRuns.id, runId), eq(migrationRuns.tenantId, ctx.tenantId))).limit(1);
    if (
      !destination || !await authorizeBankIntakeInTransaction(tx, ctx, destination.collectionId)
    ) throw new Error('Bank intake destination is unavailable.');
    const [run] = await tx.select().from(migrationRuns).where(
      and(eq(migrationRuns.id, runId), eq(migrationRuns.tenantId, ctx.tenantId)),
    ).for('update').limit(1);
    if (!run || run.destination !== 'WorkspaceBank') {
      throw new Error('Background bank import requires a bank destination.');
    }
    if (run.collectionId !== destination.collectionId) throw new Error('Bank destination changed.');
    const [existing] = await tx.select().from(migrationCommitJobs).where(
      eq(migrationCommitJobs.id, runId),
    );
    if (existing) {
      const selection = await tx.select({ id: migrationCommitSelections.itemId }).from(
        migrationCommitSelections,
      ).where(eq(migrationCommitSelections.jobId, runId));
      const ids = new Set(approvedIds);
      if (selection.length !== ids.size || selection.some((item) => !ids.has(item.id))) {
        throw new Error('The committed selection is frozen.');
      }
      if (existing.state !== 'failed') return;
      await tx.update(migrationCommitJobs).set({ state: 'queued', updatedAt: new Date() }).where(
        eq(migrationCommitJobs.id, runId),
      );
    } else {
      const [batch] = await tx.select({ purpose: migrationBatches.purpose }).from(migrationBatches)
        .where(eq(migrationBatches.id, run.batchId));
      if (
        run.status !== 'analyzed' ||
        (batch.purpose === 'recover_existing' && run.approvalStatus !== 'approved')
      ) throw new Error('The assigned reviewer must approve this analysis.');
      const items = await tx.select({
        id: migrationItems.id,
        position: migrationItems.position,
        snapshotHash: migrationItems.acceptedSnapshotHash,
      }).from(migrationItems).where(
        and(
          eq(migrationItems.runId, runId),
          inArray(migrationItems.id, [...approvedIds]),
          eq(migrationItems.decision, 'accepted'),
          sql`${migrationItems.readiness} <> 'blocked'`,
          sql`${migrationItems.acceptedSnapshot}->>'contentHash' = ${migrationItems.contentHash}`,
          sql`${migrationItems.acceptedSnapshot}->>'contextHash' = ${migrationItems.contextHash}`,
        ),
      );
      if (items.length !== approvedIds.length || items.some((item) => !item.snapshotHash)) {
        throw new Error('Selection must contain current accepted snapshots.');
      }
      await tx.insert(migrationCommitJobs).values({
        id: runId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        state: 'queued',
        total: items.length,
      });
      for (let offset = 0; offset < items.length; offset += COMMIT_BATCH_SIZE) {
        await tx.insert(migrationCommitSelections).values(
          items.slice(offset, offset + COMMIT_BATCH_SIZE).map((item) => ({
            jobId: runId,
            itemId: item.id,
            position: item.position,
            snapshotHash: item.snapshotHash!,
          })),
        );
      }
    }
    await tx.insert(workflowDispatches).values({
      id: crypto.randomUUID(),
      jobId: runId,
      tenantId: ctx.tenantId,
      kind: 'migration_commit',
      state: 'pending',
    });
  });
}

/** One small, retry-safe transaction publishes a frozen batch and its question identities. */
export async function processMigrationCommitBatch(
  jobId: string,
  services: { database: QflowDatabase; storage: ObjectWriteLifecycle },
): Promise<{ complete: boolean; completed: number }> {
  const { database, storage } = services;
  const [job] = await database.select().from(migrationCommitJobs).where(
    eq(migrationCommitJobs.id, jobId),
  );
  if (!job) throw new Error('Commit job is missing.');
  if (job.state === 'complete') return { complete: true, completed: job.completed };
  if (job.state === 'failed') throw new Error('Commit job requires an explicit retry.');
  const [member] = await database.select({ role: organizationMemberships.role }).from(
    organizationMemberships,
  ).where(
    and(
      eq(organizationMemberships.tenantId, job.tenantId),
      eq(organizationMemberships.userId, job.userId),
    ),
  );
  const role = parseRole(member?.role);
  if (!role) throw new Error('Commit actor is no longer a workspace member.');
  const ctx = { tenantId: job.tenantId, userId: job.userId, role };
  const candidates = await database.select({
    contentBytes: sql<
      number
    >`octet_length(${migrationItems.sourceXml}) + octet_length(${migrationItems.importedDraft}::text)`
      .mapWith(Number),
    id: migrationCommitSelections.itemId,
    hash: migrationCommitSelections.snapshotHash,
  }).from(migrationCommitSelections)
    .innerJoin(migrationItems, eq(migrationItems.id, migrationCommitSelections.itemId))
    .where(
      and(
        eq(migrationCommitSelections.jobId, jobId),
        sql`${migrationItems.createdQuestionId} is null`,
      ),
    )
    .orderBy(migrationCommitSelections.position).limit(COMMIT_BATCH_SIZE);
  const selection: typeof candidates = [];
  let contentBytes = 0;
  for (const candidate of candidates) {
    if (selection.length && contentBytes + candidate.contentBytes > COMMIT_BATCH_CONTENT_BYTES) {
      break;
    }
    selection.push(candidate);
    contentBytes += candidate.contentBytes;
  }
  if (!selection.length) throw new Error('Commit progress and question identities disagree.');
  const itemIds = selection.map((item) => item.id);
  const run = await getMigrationRun(ctx, jobId, database, { itemIds });
  if (!run || run.destination._tag !== 'WorkspaceBank') {
    throw new Error('Bank conversion is unavailable.');
  }
  assertFrozen(run);
  const assetRows = await database.select().from(migrationAssets).where(
    eq(migrationAssets.runId, jobId),
  );
  const parsed = importResultFromRun(run, assetRows);
  const staged = await stageImportAssets(ctx, parsed, {
    idempotencyKey: jobId,
    attemptId: crypto.randomUUID(),
    storage,
  });
  try {
    const prepared = await prepareImportQuestionRevisions(
      buildMigrationQuestionReferences(run, run, assetRows),
      staged,
    );
    const destination = run.destination;
    const outcome = await database.transaction(async (tx) => {
      if (!await authorizeBankIntakeInTransaction(tx, ctx, destination.collectionId)) {
        throw new Error('Bank intake destination is unavailable.');
      }
      const [lockedRun] = await tx.select().from(migrationRuns).where(
        and(eq(migrationRuns.id, jobId), eq(migrationRuns.tenantId, job.tenantId)),
      ).for('update');
      const [currentJob] = await tx.select().from(migrationCommitJobs).where(
        eq(migrationCommitJobs.id, jobId),
      ).for('update');
      if (!lockedRun || !currentJob || !['queued', 'running'].includes(currentJob.state)) {
        return {
          adopted: false,
          complete: currentJob?.state === 'complete',
          completed: currentJob?.completed ?? 0,
        };
      }
      if (lockedRun.collectionId !== destination.collectionId) {
        throw new Error('Bank destination changed.');
      }
      const current = await getMigrationRun(ctx, jobId, tx, { itemIds });
      if (!current || current.destination._tag !== 'WorkspaceBank') {
        throw new Error('Bank conversion disappeared.');
      }
      if (current.items.some((item) => item.createdQuestionId)) {
        return { adopted: false, complete: false, completed: currentJob.completed };
      }
      assertFrozen(current);
      const result = await commitImportResultInTransaction(
        tx,
        ctx,
        importResultFromRun(current, assetRows),
        current.sourceFilename,
        staged,
        buildMigrationQuestionReferences(current, current, assetRows),
        prepared,
        current.destination,
      );
      await tx.execute(sql`update ${migrationItems} as target set
        created_question_id = patch.question_id, created_revision = patch.revision
        from jsonb_to_recordset(${
        JSON.stringify(
          result.itemResults.map((item) => ({
            href: item.href,
            question_id: item.questionId,
            revision: item.revision,
          })),
        )
      }::jsonb)
        as patch(href text, question_id uuid, revision integer)
        where target.run_id = ${jobId}::uuid and target.source_href = patch.href`);
      const completed = currentJob.completed + result.itemResults.length;
      const complete = completed === currentJob.total;
      await tx.update(migrationCommitJobs).set({
        state: complete ? 'complete' : 'running',
        completed,
        updatedAt: new Date(),
      }).where(eq(migrationCommitJobs.id, jobId));
      if (complete) {
        await tx.update(migrationRuns).set({
          status: 'committed',
          committedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(migrationRuns.id, jobId));
        await recordAuditEventInTransaction(tx, {
          tenantId: job.tenantId,
          actorUserId: job.userId,
          action: 'migration_committed',
          metadata: { runId: jobId, items: completed },
        });
      }
      return { adopted: true, complete, completed };
    });
    if (!outcome.adopted) {
      await cleanupStagedImportAssets({ idempotencyKey: jobId, storage }, staged);
    }
    return { complete: outcome.complete, completed: outcome.completed };
  } catch (cause) {
    return await throwAfterImportAssetCleanup({ idempotencyKey: jobId, storage }, staged, cause);
  }
  function assertFrozen(current: MigrationRunRecord) {
    if (current.purpose === 'recover_existing' && current.approval._tag !== 'Approved') {
      throw new Error('Conversion approval changed.');
    }
    assertConversionCommitApproval(current, itemIds, true);
    for (const item of current.items) {
      if (
        selection.find((candidate) => candidate.id === item.id)?.hash !== item.acceptedSnapshotHash
      ) throw new Error('Frozen snapshot changed.');
    }
  }
}

/** Reconciliation marks incomplete work failed; retained progress supports an explicit retry. */
export async function settleMigrationCommitAfterWorkflowTerminal(
  tx: QflowDatabaseTransaction,
  input: { jobId: string; tenantId: string },
): Promise<WorkflowTerminalDomainOutcome> {
  const [job] = await tx.select().from(migrationCommitJobs).where(
    and(eq(migrationCommitJobs.id, input.jobId), eq(migrationCommitJobs.tenantId, input.tenantId)),
  ).for('update');
  if (!job) return { _tag: 'JobMissing' };
  if (job.state === 'complete') return { _tag: 'AlreadyCompleted' };
  if (job.state === 'failed') return { _tag: 'AlreadyFailed' };
  await tx.update(migrationCommitJobs).set({ state: 'failed', updatedAt: new Date() }).where(
    eq(migrationCommitJobs.id, input.jobId),
  );
  return { _tag: 'Failed' };
}
