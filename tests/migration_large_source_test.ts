import { expect, test as testCase } from 'vitest';

import { and, count, eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import {
  auditLogs,
  migrationBatches,
  migrationItems,
  organizationMemberships,
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

testCase(
  'one 7787-question source persists a complete ordered analysis without exceeding SQL bind limits',
  { skip: !process.env['DATABASE_URL'] },
  async () => {
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
      const source = Array.from(
        { length: questionCount },
        (_, index) => `::Question ${index + 1}:: What is ${index + 1} plus one? {=${index + 2} ~0}`,
      ).join('\n\n');
      const batch = await enqueueMigrationBatch(
        ctx,
        {
          idempotencyKey: crypto.randomUUID(),
          purpose: 'recover_existing',
          destination: { _tag: 'WorkspaceBank', collectionId: null },
          sources: [{
            source: {
              filename: 'large-bank.gift',
              mime: 'text/plain',
              bytes: new TextEncoder().encode(source),
            },
            adapter: { id: 'gift', version: '1' },
          }],
        },
        { storage },
      );
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
    } finally {
      await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
      await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId));
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await db.delete(organizationMemberships).where(
        eq(organizationMemberships.tenantId, tenantId),
      );
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await shutdownDb();
    }
  },
);
