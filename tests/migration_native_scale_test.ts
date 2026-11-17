import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';
import { assignMigrationBatchReviewer } from '../lib/import/migration_batches.ts';
import {
  decideMigrationRunApproval,
  submitMigrationRunForApproval,
} from '../lib/import/migration_approvals.ts';
import {
  enqueueMigrationCommit,
  processMigrationCommitBatch,
} from '../lib/import/migration_commit_job.ts';

import { and, count, eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import {
  auditLogs,
  migrationBatches,
  migrationItems,
  organizationMemberships,
  questions,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { enqueueMigrationBatch } from '../lib/import/migration_enqueue.ts';
import { claimMigrationRun } from '../lib/import/migration_jobs.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { processClaimedMigrationRun } from '../lib/import/migration_processor.ts';
import type { ObjectReadWriter, ObjectWriteLifecycle } from '../lib/storage_contract.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase('native ARC package persists all 7787 items through bounded checkpoints', {
  skip: !process.env['QFLOW_ARC_PACKAGE'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  const objects = new Map<string, Uint8Array>();
  const storage: ObjectReadWriter & ObjectWriteLifecycle = {
    putObject(input) {
      objects.set(input.key, input.data);
      return Promise.resolve();
    },
    readObject(key) {
      const bytes = objects.get(key);
      if (!bytes) return Promise.reject(new Error('Test source object is missing.'));
      return Promise.resolve(bytes);
    },
    deleteObject(key) {
      objects.delete(key);
      return Promise.resolve();
    },
  };
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `large-source-${tenantId}`,
      name: 'Large source regression test',
    });
    const email = `large-source-${userId}@example.com`;
    await db.insert(users).values({ id: userId, email, emailNormalized: email });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });

    const questionCount = 7787;
    const packagePath = process.env['QFLOW_ARC_PACKAGE'];
    if (!packagePath) expect.unreachable('QFLOW_ARC_PACKAGE must name the intact ARC ZIP');
    const source = await _fs.readFile(packagePath);
    const batch = await enqueueMigrationBatch(ctx, {
      idempotencyKey: crypto.randomUUID(),
      purpose: 'recover_existing',
      destination: { _tag: 'WorkspaceBank', collectionId: null },
      sources: [{
        source: {
          filename: 'arc-all-7787-qti3.zip',
          mime: 'application/zip',
          bytes: source,
        },
        adapter: { id: 'qti3', version: '1' },
      }],
    }, { storage });
    expect(batch.runs.length).toStrictEqual(1);
    const runId = batch.runs[0].id;
    const [dispatch] = await db.select({ id: workflowDispatches.id }).from(workflowDispatches)
      .where(
        and(eq(workflowDispatches.kind, 'source_migration'), eq(workflowDispatches.jobId, runId)),
      );
    if (!dispatch) expect.unreachable('Expected dispatch');
    const claim = await claimMigrationRun(runId, dispatch.id);
    if (!claim) expect.unreachable('Expected claim');
    const processed = await processClaimedMigrationRun(claim, { storage });
    if (!(processed._tag === 'Success')) {
      expect.unreachable(processed._tag === 'Failure' ? processed.failure.code : undefined);
    }
    expect(processed.value).toStrictEqual({ runId });
    const run = await getMigrationRun(ctx, runId);
    if (!run) expect.unreachable('Expected run');
    expect(run.execution._tag).toStrictEqual('Analyzed');
    expect(
      run.summary.counts.blocked,
      JSON.stringify(
        run.items.filter((item) => item.readiness === 'blocked').slice(0, 2).map((item) => ({
          id: item.sourceIdentifier,
          warnings: item.warnings,
        })),
      ),
    ).toStrictEqual(0);
    expect(run.summary.counts.items).toStrictEqual(questionCount);
    expect(run.items.length).toStrictEqual(questionCount);
    expect(run.items.map((item) => item.position)).toStrictEqual(
      Array.from({ length: questionCount }, (_, index) => index + 1),
    );
    expect(new Set(run.items.map((item) => item.id)).size).toStrictEqual(questionCount);
    const [persisted] = await db.select({ total: count() }).from(migrationItems)
      .where(eq(migrationItems.runId, runId));
    expect(persisted.total).toStrictEqual(questionCount);
    expect(await claimMigrationRun(runId, dispatch.id)).toStrictEqual(null);
    for (let offset = 0; offset < questionCount; offset += 100) {
      const page = await getMigrationRun(ctx, runId, db, { offset, limit: 100 });
      if (!page) expect.unreachable('Expected page');
      const versions = Object.fromEntries(
        page.items.map((
          item,
        ) => [item.id, {
          contentHash: item.contentHash,
          contextHash: item.contextHash,
          decision: item.decision,
        }]),
      );
      await updateMigrationItems(
        ctx,
        runId,
        page.items.map((item) => item.id),
        { kind: 'accept' },
        versions,
      );
    }
    await assignMigrationBatchReviewer(ctx, batch.id, userId);
    await submitMigrationRunForApproval(ctx, runId);
    await decideMigrationRunApproval(ctx, runId, { decision: 'approve' });
    const approvedIds = run.items.map((item) => item.id);
    await enqueueMigrationCommit(ctx, runId, approvedIds, true);
    await expect(
      Promise.resolve().then(() =>
        enqueueMigrationCommit({ ...ctx, tenantId: crypto.randomUUID() }, runId, approvedIds, true)
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      Promise.resolve().then(() => enqueueMigrationCommit(ctx, runId, approvedIds.slice(1), true)),
    ).rejects.toBeInstanceOf(Error);
    const frozenRun = await getMigrationRun(ctx, runId, db, { offset: 0, limit: 1 });
    if (!frozenRun) expect.unreachable('Expected frozen run.');
    const frozenItem = frozenRun.items[0];
    if (!frozenItem) expect.unreachable('Expected frozen item.');
    await expect(
      Promise.resolve().then(() =>
        updateMigrationItems(ctx, runId, [frozenItem.id], { kind: 'reset_decision' }, {
          [frozenItem.id]: {
            contentHash: frozenItem.contentHash,
            contextHash: frozenItem.contextHash,
            decision: frozenItem.decision,
          },
        })
      ),
    ).rejects.toBeInstanceOf(Error);

    await enqueueMigrationCommit(ctx, runId, approvedIds, true);
    let progress = await processMigrationCommitBatch(runId, { database: db, storage });
    if (!(progress.completed > 0 && progress.completed <= 500)) {
      expect.unreachable('Expected progress.completed > 0 && progress.completed <= 500');
    }
    expect(progress.complete).toStrictEqual(false);
    while (!progress.complete) {
      progress = await processMigrationCommitBatch(runId, { database: db, storage });
    }
    expect(progress.completed).toStrictEqual(questionCount);
    expect(await processMigrationCommitBatch(runId, { database: db, storage })).toStrictEqual(
      progress,
    );
    const [created] = await db.select({ total: count() }).from(questions).where(
      eq(questions.tenantId, tenantId),
    );
    expect(created.total).toStrictEqual(questionCount);
  } finally {
    await db.delete(questions).where(eq(questions.tenantId, tenantId));
    await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
    await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId));
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.tenantId, tenantId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await shutdownDb();
  }
});
