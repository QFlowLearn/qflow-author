import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import { persistNormalizedSource } from '../lib/conversion/source_artifacts.ts';
import {
  auditLogs,
  conversionSourceArtifacts,
  migrationBatches,
  migrationRuns,
  organizationMemberships,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import {
  assignMigrationBatchReviewer,
  getMigrationBatch,
} from '../lib/import/migration_batches.ts';
import {
  decideMigrationRunApproval,
  submitMigrationRunForApproval,
} from '../lib/import/migration_approvals.ts';
import {
  enqueueMigrationBatch,
  MigrationBatchConflictError,
} from '../lib/import/migration_enqueue.ts';
import { MigrationSourceCleanupRequiredError } from '../lib/import/migration_source_compensation.ts';
import {
  claimMigrationRun,
  markMigrationRunFailed,
  markMigrationRunRetry,
  MigrationLeaseLostError,
  retryMigrationRun,
} from '../lib/import/migration_jobs.ts';
import { retryableMigrationFailure } from '../lib/import/migration_failures.ts';
import { processClaimedMigrationRun } from '../lib/import/migration_processor.ts';
import { getMigrationRun, listMigrationRuns } from '../lib/import/migration_run_queries.ts';
import {
  updateMigrationItems,
  updateMigrationRunBlueprint,
} from '../lib/import/migration_run_review.ts';
import type {
  ObjectDeleter,
  ObjectReadWriter,
  ObjectWriteLifecycle,
} from '../lib/storage_contract.ts';
import { type RequestContext, workerContext } from '../lib/tenants.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';

const FIXTURES = new URL('fixtures/import/migration-batches/', import.meta.url);

testCase('teaching assistants cannot assign migration reviewers', async () => {
  const ctx: RequestContext = {
    tenantId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    role: 'teaching_assistant',
  };

  await expect(
    Promise.resolve().then(() =>
      assignMigrationBatchReviewer(ctx, crypto.randomUUID(), crypto.randomUUID())
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('do not have permission')
  );
});

testCase('a losing concurrent enqueue removes only its unowned source object', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  const objects = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const deletes: string[] = [];
  let releaseWrites: (() => void) | undefined;
  const bothWritesStarted = new Promise<void>((resolve) => {
    releaseWrites = resolve;
  });
  const storage: ObjectWriteLifecycle = {
    putObject(input) {
      writes.push(input.key);
      objects.set(input.key, input.data);
      if (writes.length === 2) releaseWrites?.();
      return bothWritesStarted;
    },
    deleteObject(key) {
      deletes.push(key);
      objects.delete(key);
      return Promise.resolve();
    },
  };

  try {
    const email = `migration-race-${tenantId.slice(0, 8)}@example.com`;
    await db.insert(tenants).values({
      id: tenantId,
      slug: `migration-race-${tenantId.slice(0, 8)}`,
      name: 'Migration enqueue race',
    });
    await db.insert(users).values({ id: userId, email, emailNormalized: email });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });

    const idempotencyKey = crypto.randomUUID();
    const command = (byte: number) => ({
      idempotencyKey,
      destination: { _tag: 'Assessment' as const },
      purpose: 'recover_existing' as const,
      sources: [{
        source: {
          filename: 'question.xml',
          mime: 'application/xml',
          bytes: new Uint8Array([byte]),
        },
        adapter: { id: 'qti21', version: '1' },
      }],
    });
    const outcomes = await Promise.allSettled([
      enqueueMigrationBatch(ctx, command(1), { storage }),
      enqueueMigrationBatch(ctx, command(2), { storage }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled').length).toStrictEqual(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (!(rejected?.status === 'rejected')) {
      expect.unreachable("Expected rejected?.status === 'rejected'");
    }
    if (!(rejected.reason instanceof MigrationBatchConflictError)) {
      expect.unreachable('Expected rejected.reason instanceof MigrationBatchConflictError');
    }
    const ownedRows = await db.select({ storageKey: conversionSourceArtifacts.storageKey })
      .from(conversionSourceArtifacts)
      .where(inArray(conversionSourceArtifacts.storageKey, writes));
    expect(ownedRows.length).toStrictEqual(1);
    expect([...objects.keys()]).toStrictEqual([ownedRows[0].storageKey]);
    expect(deletes.length).toStrictEqual(1);
    expect(deletes[0]).not.toStrictEqual(ownedRows[0].storageKey);
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId))
      .catch(() => {});
    await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId))
      .catch(() => {});
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(() => {});
    await db.delete(organizationMemberships).where(eq(organizationMemberships.tenantId, tenantId))
      .catch(() => {});
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
    await shutdownDb().catch(() => {});
  }
});

testCase(
  'migration batches are idempotent, resumable, partially successful, and staged for approval',
  { skip: !process.env['DATABASE_URL'] },
  async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const reviewerId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    const reviewerCtx: RequestContext = { tenantId, userId: reviewerId, role: 'instructor' };
    const objects = new Map<string, Uint8Array>();
    let putCount = 0;
    let failPutNumber: number | null = 2;
    const storage: ObjectReadWriter & ObjectDeleter = {
      putObject(input) {
        putCount += 1;
        if (putCount === failPutNumber) {
          return Promise.reject(new Error('Synthetic interrupted upload.'));
        }
        objects.set(input.key, input.data);
        return Promise.resolve();
      },
      readObject(key) {
        const value = objects.get(key);
        if (!value) throw new Error(`Missing test object: ${key}`);
        return Promise.resolve(value);
      },
      deleteObject(key) {
        objects.delete(key);
        return Promise.resolve();
      },
    };

    try {
      const email = `migration-queue-${tenantId.slice(0, 8)}@example.com`;
      const reviewerEmail = `migration-reviewer-${tenantId.slice(0, 8)}@example.com`;
      await db.insert(tenants).values({
        id: tenantId,
        slug: `mq-${tenantId.slice(0, 8)}`,
        name: 'Migration Queue Tenant',
      });
      await db.insert(users).values([
        { id: userId, email, emailNormalized: email },
        { id: reviewerId, email: reviewerEmail, emailNormalized: reviewerEmail },
      ]);
      await db.insert(organizationMemberships).values([
        {
          id: crypto.randomUUID(),
          tenantId,
          userId,
          role: 'owner',
        },
        {
          id: crypto.randomUUID(),
          tenantId,
          userId: reviewerId,
          role: 'instructor',
        },
      ]);

      const command = {
        idempotencyKey: crypto.randomUUID(),
        destination: { _tag: 'Assessment' as const },
        purpose: 'recover_existing' as const,
        sources: [
          {
            source: {
              filename: 'choice.xml',
              mime: 'application/xml',
              bytes: await _fs.readFile(new URL('qti21-choice.xml', FIXTURES)),
            },
            adapter: { id: 'qti21', version: '1' },
          },
          {
            source: {
              filename: 'broken-package.bin',
              mime: 'application/octet-stream',
              bytes: await _fs.readFile(new URL('unsupported-package.bin', FIXTURES)),
            },
            adapter: { id: 'qti21', version: '1' },
          },
          {
            source: {
              filename: 'examview.xml',
              mime: 'application/xml',
              bytes: await _fs.readFile(new URL('examview-choice.xml', FIXTURES)),
            },
            adapter: { id: 'examview-xml', version: '1' },
          },
        ],
      };
      await expect(Promise.resolve().then(() => enqueueMigrationBatch(ctx, command, { storage })))
        .rejects.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('Synthetic interrupted upload.')
        );
      expect(
        (await db.select().from(migrationBatches).where(eq(migrationBatches.tenantId, tenantId)))
          .length,
      ).toStrictEqual(0);
      expect(objects.size).toStrictEqual(0);
      failPutNumber = null;

      await expect(
        Promise.resolve().then(() =>
          enqueueMigrationBatch(
            { ...ctx, userId: crypto.randomUUID() },
            { ...command, idempotencyKey: crypto.randomUUID() },
            { storage },
          )
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('Question history actor does not exist.')
      );
      expect(objects.size).toStrictEqual(0);

      const strandedObjects = new Map<string, Uint8Array>();
      const cleanupFailure = await (async () => {
        const caught: unknown = await Promise.resolve().then(() =>
          enqueueMigrationBatch(
            { ...ctx, userId: crypto.randomUUID() },
            { ...command, idempotencyKey: crypto.randomUUID() },
            {
              storage: {
                putObject(input) {
                  strandedObjects.set(input.key, input.data);
                  return Promise.resolve();
                },
                deleteObject() {
                  return Promise.reject(new Error('Synthetic source cleanup failure.'));
                },
              },
            },
          )
        ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
        if (!(caught instanceof MigrationSourceCleanupRequiredError)) {
          expect.unreachable('Expected MigrationSourceCleanupRequiredError');
        }
        expect(caught.message).toContain('requires operator attention');
        return caught;
      })();
      expect(cleanupFailure.objectKeys.length).toStrictEqual(command.sources.length);
      expect(cleanupFailure.cleanupFailures.length).toStrictEqual(command.sources.length);
      expect(strandedObjects.size).toStrictEqual(command.sources.length);

      const batch = await enqueueMigrationBatch(ctx, command, { storage });
      const replay = await enqueueMigrationBatch(ctx, command, { storage });
      expect(replay.id).toStrictEqual(batch.id);
      expect(replay.runs.map((run) => run.id)).toStrictEqual(batch.runs.map((run) => run.id));
      expect(batch.runs.length).toStrictEqual(3);
      expect(batch.runs.every((run) => run.execution._tag === 'Queued')).toStrictEqual(true);
      await expect(
        Promise.resolve().then(() =>
          db.update(migrationRuns).set({
            approvalStatus: 'submitted',
            submittedBy: userId,
            submittedAt: new Date(),
          }).where(eq(migrationRuns.id, batch.runs[0].id))
        ),
      ).rejects.toBeInstanceOf(Error);
      expect((await getMigrationRun(ctx, batch.runs[0].id))?.approval._tag).toStrictEqual('Draft');
      await expect(
        Promise.resolve().then(() =>
          enqueueMigrationBatch(ctx, {
            ...command,
            sources: command.sources.map((entry, index) =>
              index === 0
                ? {
                  ...entry,
                  source: { ...entry.source, filename: 'different-choice.xml' },
                }
                : entry
            ),
          }, { storage })
        ),
      ).rejects.toBeInstanceOf(MigrationBatchConflictError);

      const sourceRows = await db.select().from(conversionSourceArtifacts)
        .where(eq(conversionSourceArtifacts.runId, batch.runs[0].id));
      expect(sourceRows.length).toStrictEqual(1);

      const firstExecutionId = await workflowExecutionId('source_migration', batch.runs[0].id);
      const firstClaim = await claimMigrationRun(
        batch.runs[0].id,
        firstExecutionId,
      );
      const secondClaim = await claimMigrationRun(
        batch.runs[1].id,
        await workflowExecutionId('source_migration', batch.runs[1].id),
      );
      if (!firstClaim) expect.unreachable('Expected firstClaim');
      if (!secondClaim) expect.unreachable('Expected secondClaim');
      const replayedFirstClaim = await claimMigrationRun(batch.runs[0].id, firstExecutionId);
      expect(replayedFirstClaim?.leaseToken).toStrictEqual(firstClaim.leaseToken);
      expect(replayedFirstClaim?.attempts).toStrictEqual(1);
      expect(firstClaim.id).not.toStrictEqual(secondClaim.id);
      await processOrPersistFailure(firstClaim, storage);
      await processOrPersistFailure(secondClaim, storage);
      await drainMigrationRuns(batch.runs.map((run) => run.id), storage);

      const valid = await getMigrationRun(ctx, batch.runs[0].id);
      const failed = await getMigrationRun(ctx, batch.runs[1].id);
      const examView = await getMigrationRun(ctx, batch.runs[2].id);
      if (!valid) expect.unreachable('Expected valid');
      if (!failed) expect.unreachable('Expected failed');
      if (!examView) expect.unreachable('Expected examView');
      expect(valid.execution._tag).toStrictEqual('Analyzed');
      expect(valid.summary.counts.items).toStrictEqual(1);
      expect(failed.execution._tag).toStrictEqual('Failed');
      expect(failed.execution.attempts).toStrictEqual(1);
      expect(examView.execution._tag).toStrictEqual('Analyzed');
      expect(examView.items.length).toStrictEqual(1);
      expect(examView.items[0].evidence[0]?.kind).toStrictEqual('block');

      const progress = await getMigrationBatch(ctx, batch.id);
      if (!progress) expect.unreachable('Expected progress');
      expect(progress.progress.files.analyzed).toStrictEqual(2);
      expect(progress.progress.files.failed).toStrictEqual(1);
      expect(progress.progress.items.total).toStrictEqual(2);
      expect(progress.progress.blockingFindings.failedFiles).toStrictEqual(1);

      const failedExecutionId = await workflowExecutionId('source_migration', failed.id);
      const lastPlatformObservation = new Date('2026-08-07T10:15:00.000Z');
      await db.update(workflowDispatches).set({
        state: 'active',
        workflowStatus: 'running',
        startedAt: new Date('2026-08-07T10:14:00.000Z'),
        lastCheckedAt: lastPlatformObservation,
      }).where(eq(workflowDispatches.id, failedExecutionId));
      const retried = await retryMigrationRun(ctx, failed.id);
      expect(retried.execution._tag).toStrictEqual('Queued');
      expect(retried.execution.attempts).toStrictEqual(0);
      const retriedExecutionId = await workflowExecutionId('source_migration', failed.id);
      expect(retriedExecutionId).not.toStrictEqual(failedExecutionId);
      const [supersededDispatch] = await db.select({
        state: workflowDispatches.state,
        workflowStatus: workflowDispatches.workflowStatus,
        lastCheckedAt: workflowDispatches.lastCheckedAt,
        lastErrorCode: workflowDispatches.lastErrorCode,
        completedAt: workflowDispatches.completedAt,
      }).from(workflowDispatches).where(eq(workflowDispatches.id, failedExecutionId));
      expect(supersededDispatch?.state).toStrictEqual('failed');
      expect(supersededDispatch?.workflowStatus).toStrictEqual('running');
      expect(supersededDispatch?.lastCheckedAt?.toISOString()).toStrictEqual(
        lastPlatformObservation.toISOString(),
      );
      expect(supersededDispatch?.lastErrorCode).toStrictEqual('workflow_superseded_by_user_retry');
      if (!(supersededDispatch?.completedAt)) {
        expect.unreachable('Expected supersededDispatch?.completedAt');
      }
      expect(await claimMigrationRun(failed.id, failedExecutionId)).toStrictEqual(null);
      const interrupted = await claimMigrationRun(failed.id, retriedExecutionId);
      if (!interrupted) expect.unreachable('Expected interrupted');
      expect(interrupted.id).toStrictEqual(failed.id);
      await markMigrationRunRetry(
        interrupted,
        retryableMigrationFailure('source_read_unavailable', new Error('Synthetic retry.')),
      );
      await markMigrationRunRetry(
        interrupted,
        retryableMigrationFailure('source_read_unavailable', new Error('Synthetic retry.')),
      );
      expect((await getMigrationRun(ctx, failed.id))?.execution._tag).toStrictEqual('Queued');
      const resumed = await claimMigrationRun(failed.id, retriedExecutionId);
      if (!resumed) expect.unreachable('Expected resumed');
      expect(resumed.leaseToken).not.toStrictEqual(interrupted.leaseToken);
      await expect(
        Promise.resolve().then(() =>
          persistNormalizedSource({
            ctx: workerContext(interrupted.tenantId, interrupted.userId),
            runId: interrupted.id,
            leaseToken: interrupted.leaseToken,
            source: command.sources[1].source,
            storage,
            document: {
              version: 1,
              title: 'Late abandoned processor',
              sourceKind: 'text',
              blocks: [{
                id: 'block-1',
                kind: 'paragraph',
                text: 'This write must not become authoritative.',
              }],
              text: 'This write must not become authoritative.',
              uncertainties: [],
            },
          })
        ),
      ).rejects.toBeInstanceOf(MigrationLeaseLostError);
      const lateArtifacts = await db.select().from(conversionSourceArtifacts)
        .where(eq(conversionSourceArtifacts.runId, interrupted.id));
      expect(lateArtifacts.some((artifact) => artifact.kind === 'normalized')).toStrictEqual(false);
      await processOrPersistFailure(resumed, storage);

      await assignMigrationBatchReviewer(ctx, batch.id, reviewerId);
      const item = valid.items[0];
      await updateMigrationRunBlueprint(
        ctx,
        valid.id,
        testAssessmentBlueprint([
          { id: 'recovered-target', questionType: item.itemType, count: 1 },
        ]),
      );
      await updateMigrationItems(
        ctx,
        valid.id,
        [item.id],
        { kind: 'align_blueprint_target', targetId: 'recovered-target' },
        {
          [item.id]: {
            contentHash: item.contentHash,
            contextHash: item.contextHash,
            decision: item.decision,
          },
        },
      );
      const aligned = await getMigrationRun(ctx, valid.id);
      const alignedItem = aligned?.items[0];
      if (!alignedItem) throw new Error('Aligned migration item was not found.');
      await updateMigrationItems(ctx, valid.id, [alignedItem.id], { kind: 'accept' }, {
        [alignedItem.id]: {
          contentHash: alignedItem.contentHash,
          contextHash: alignedItem.contextHash,
          decision: alignedItem.decision,
        },
      });
      expect((await submitMigrationRunForApproval(ctx, valid.id)).approval._tag).toStrictEqual(
        'Submitted',
      );
      expect(
        (await decideMigrationRunApproval(reviewerCtx, valid.id, {
          decision: 'approve',
        })).approval._tag,
      ).toStrictEqual('Approved');

      const listed = await listMigrationRuns(ctx);
      expect(listed.some((run) => run.id === valid.id)).toStrictEqual(true);
    } catch (err) {
      await shutdownDb().catch(() => {});
      throw err;
    } finally {
      try {
        await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
        await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId));
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
        await db.delete(organizationMemberships).where(
          eq(organizationMemberships.tenantId, tenantId),
        );
        await db.delete(users).where(eq(users.id, reviewerId));
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      } catch (_) {
        // Ignore cleanup errors after a database outage.
      }
      await shutdownDb().catch(() => {});
    }
  },
);

async function drainMigrationRuns(
  runIds: readonly string[],
  storage: ObjectReadWriter,
): Promise<void> {
  for (const runId of runIds) {
    const job = await claimMigrationRun(
      runId,
      await workflowExecutionId('source_migration', runId),
    );
    if (!job) continue;
    await processOrPersistFailure(job, storage);
  }
}

async function workflowExecutionId(
  kind: 'source_migration' | 'ai_generation',
  jobId: string,
): Promise<string> {
  const rows = await db.select({ id: workflowDispatches.id }).from(workflowDispatches).where(and(
    eq(workflowDispatches.kind, kind),
    eq(workflowDispatches.jobId, jobId),
  )).orderBy(desc(workflowDispatches.createdAt)).limit(1);
  if (!rows[0]) throw new Error(`Workflow execution not found for job ${jobId}.`);
  return rows[0].id;
}

async function processOrPersistFailure(
  job: NonNullable<Awaited<ReturnType<typeof claimMigrationRun>>>,
  storage: ObjectReadWriter,
): Promise<void> {
  const result = await processClaimedMigrationRun(job, { storage });
  if (result._tag === 'Success' || result.failure._tag === 'LeaseLost') return;
  if (result.failure._tag === 'Retryable' && job.attempts < job.maxAttempts) {
    await markMigrationRunRetry(job, result.failure);
  } else {
    await markMigrationRunFailed(job, result.failure);
  }
}
