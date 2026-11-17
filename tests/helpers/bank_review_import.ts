import { expect } from 'vitest';
import type { ImportSource } from '../../lib/import/types.ts';

import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { auditLogs, migrationBatches, workflowDispatches } from '../../lib/db/schema.ts';
import {
  enqueueMigrationBatch,
  type EnqueueMigrationBatchCommand,
} from '../../lib/import/migration_enqueue.ts';
import { runSourceMigrationWorkflow } from '../../lib/workflows/job_workflows.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { createMemoryObjectStorage } from '../memory_object_storage.ts';
import { withEnrichmentWorkspace } from './enrichment_workspace.ts';

/** Import 60 ready and 61 missing-key questions so both review selections cross a page boundary. */
export async function withBankReviewImport(
  test: (ctx: RequestContext, runId: string) => Promise<void>,
): Promise<void> {
  const bytes = new TextEncoder().encode(
    Array.from(
      { length: 121 },
      (_, i) => `${i + 1}. Review question ${i + 1}?\n${i < 60 ? '*' : ''}a. Yes\nb. No\n`,
    ).join('\n'),
  );
  await withBankReviewSource(
    { filename: 'review-questions.txt', mime: 'text/plain', bytes },
    'respondus-standard',
    test,
  );
}

/** Run a real deterministic bank import and retain its analyzed review for the callback. */
export async function withBankReviewSource(
  source: ImportSource,
  adapterId: string,
  test: (ctx: RequestContext, runId: string) => Promise<void>,
): Promise<void> {
  await withQueuedBankReviewSource(source, adapterId, async (ctx, runId, analyze) => {
    await analyze();
    await test(ctx, runId);
  });
}

/** Keep the deterministic analysis step under caller control to test active progress and reload. */
export async function withQueuedBankReviewSource(
  source: ImportSource,
  adapterId: string,
  test: (ctx: RequestContext, runId: string, analyze: () => Promise<void>) => Promise<void>,
): Promise<void> {
  await withQueuedReviewSource(source, adapterId, {
    purpose: 'recover_existing',
    destination: { _tag: 'WorkspaceBank', collectionId: null },
  }, test);
}

/** Prepare deterministic assessment source/recovery data without invoking an AI provider. */
export async function withAssessmentReviewSource(
  source: ImportSource,
  adapterId: string,
  purpose: EnqueueMigrationBatchCommand['purpose'],
  test: (ctx: RequestContext, runId: string) => Promise<void>,
): Promise<void> {
  await withQueuedReviewSource(
    source,
    adapterId,
    { purpose, destination: { _tag: 'Assessment' } },
    async (ctx, runId, analyze) => {
      await analyze();
      await test(ctx, runId);
    },
  );
}

async function withQueuedReviewSource(
  source: ImportSource,
  adapterId: string,
  scope: Pick<EnqueueMigrationBatchCommand, 'purpose' | 'destination'>,
  test: (ctx: RequestContext, runId: string, analyze: () => Promise<void>) => Promise<void>,
): Promise<void> {
  await withEnrichmentWorkspace(async (ctx) => {
    const storage = createMemoryObjectStorage();
    const batch = await enqueueMigrationBatch(ctx, {
      idempotencyKey: crypto.randomUUID(),
      purpose: scope.purpose,
      destination: scope.destination,
      sources: [{
        source,
        adapter: { id: adapterId, version: '1' },
      }],
    }, { storage });
    try {
      const runId = batch.runs[0].id;
      const [dispatch] = await db.select().from(workflowDispatches).where(
        eq(workflowDispatches.jobId, runId),
      );
      await test(ctx, runId, async () => {
        expect(
          (await runSourceMigrationWorkflow({ jobId: runId, workflowExecutionId: dispatch.id }, {
            do: (_name, _config, operation) => operation(),
            sleep: () => Promise.resolve(),
          }, { database: db, storage }))._tag,
        ).toStrictEqual('Completed');
      });
    } finally {
      await db.delete(migrationBatches).where(eq(migrationBatches.id, batch.id));
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, ctx.tenantId));
    }
  });
}
