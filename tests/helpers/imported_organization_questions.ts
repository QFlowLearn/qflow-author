import { expect } from 'vitest';
import * as _fs from 'node:fs/promises';
import { qtiOrganizationPackage } from './qti_organization_package.ts';
import { blackboardOrganizationPackage } from './blackboard_organization_package.ts';
import type { MigrationRunRecord } from '../../lib/import/migration_types.ts';

import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { auditLogs, migrationBatches, workflowDispatches } from '../../lib/db/schema.ts';
import { enqueueMigrationBatch } from '../../lib/import/migration_enqueue.ts';
import { getMigrationRun } from '../../lib/import/migration_run_queries.ts';
import { updateMigrationItems } from '../../lib/import/migration_run_review.ts';
import { assignMigrationBatchReviewer } from '../../lib/import/migration_batches.ts';
import {
  decideMigrationRunApproval,
  submitMigrationRunForApproval,
} from '../../lib/import/migration_approvals.ts';
import {
  enqueueMigrationCommit,
  processMigrationCommitBatch,
} from '../../lib/import/migration_commit_job.ts';
import { runSourceMigrationWorkflow } from '../../lib/workflows/job_workflows.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { createMemoryObjectStorage } from '../memory_object_storage.ts';

/** Import two public fixture questions through approval and the real background bank commit. */
export async function withImportedOrganizationQuestions(
  ctx: RequestContext,
  collectionId: string,
  test: (run: MigrationRunRecord) => Promise<void>,
  format: 'respondus' | 'moodle' | 'qti' | 'qti_ambiguous' | 'blackboard' | 'imscc' | {
    readonly filename: string;
    readonly mime: string;
    readonly bytes: Uint8Array;
    readonly adapterId: string;
  } = 'respondus',
) {
  const storage = createMemoryObjectStorage();
  const fixture = typeof format === 'object'
    ? format
    : format === 'blackboard' || format === 'imscc'
    ? {
      filename: format === 'imscc' ? 'science-pools.imscc' : 'science-pools.zip',
      mime: 'application/zip',
      bytes: await blackboardOrganizationPackage(undefined, format),
      adapterId: format,
    }
    : format === 'qti' || format === 'qti_ambiguous'
    ? {
      filename: 'science-chapters.zip',
      mime: 'application/zip',
      bytes: await qtiOrganizationPackage({ unnamed: true, ambiguous: format === 'qti_ambiguous' }),
      adapterId: 'qti3',
    }
    : format === 'respondus'
    ? {
      filename: 'word-visible-numbering.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: await _fs.readFile(
        new URL('../fixtures/import/respondus/word-visible-numbering.docx', import.meta.url),
      ),
      adapterId: 'respondus-standard',
    }
    : {
      filename: 'categories.xml',
      mime: 'application/xml',
      bytes: await _fs.readFile(
        new URL('../fixtures/import/moodle/categories.xml', import.meta.url),
      ),
      adapterId: 'moodle_xml',
    };
  const batch = await enqueueMigrationBatch(
    ctx,
    {
      idempotencyKey: crypto.randomUUID(),
      destination: { _tag: 'WorkspaceBank', collectionId },
      purpose: 'recover_existing',
      sources: [{
        source: {
          filename: fixture.filename,
          mime: fixture.mime,
          bytes: fixture.bytes,
        },
        adapter: { id: fixture.adapterId, version: '1' },
      }],
    },
    { storage },
  );
  try {
    const runId = batch.runs[0].id;
    const [dispatch] = await db.select().from(workflowDispatches).where(
      eq(workflowDispatches.jobId, runId),
    );
    expect(
      (await runSourceMigrationWorkflow(
        { jobId: runId, workflowExecutionId: dispatch.id },
        { do: (_name, _config, operation) => operation(), sleep: () => Promise.resolve() },
        { database: db, storage },
      ))._tag,
    ).toStrictEqual('Completed');
    const run = await getMigrationRun(ctx, runId);
    if (!run) expect.unreachable('Expected run');
    expect(run.items.length).toStrictEqual(2);
    const ids = run.items.map((i) => i.id);
    await updateMigrationItems(
      ctx,
      runId,
      ids,
      { kind: 'accept' },
      Object.fromEntries(run.items.map((i) => [i.id, {
        contentHash: i.contentHash,
        contextHash: i.contextHash,
        decision: i.decision,
      }])),
    );
    await assignMigrationBatchReviewer(ctx, batch.id, ctx.userId);
    await submitMigrationRunForApproval(ctx, runId);
    await decideMigrationRunApproval(ctx, runId, { decision: 'approve' });
    await enqueueMigrationCommit(ctx, runId, ids, true);
    expect(await processMigrationCommitBatch(runId, { database: db, storage })).toStrictEqual({
      complete: true,
      completed: 2,
    });
    // A replay neither recreates questions nor changes source identities.
    expect(await processMigrationCommitBatch(runId, { database: db, storage })).toStrictEqual({
      complete: true,
      completed: 2,
    });
    await test(run);
  } finally {
    await db.delete(migrationBatches).where(eq(migrationBatches.id, batch.id));
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, ctx.tenantId));
  }
}
