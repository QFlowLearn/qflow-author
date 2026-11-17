import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { organizationItems, organizationRuns } from '../db/question_organization_schema.ts';
import { workflowDispatches } from '../db/workflow_canvas_schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import type {
  EnrichmentBatchProgress,
  EnrichmentJobFailure,
} from './bank_enrichment_job_contract.ts';
import type { OrganizationFailure } from './question_organization_contract.ts';
import type { OrganizationRun } from './question_organization_read.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import { undoOrganizationItem } from './question_organization_undo_item.ts';

// One step owns at most twenty question locks and their small assignment/filing histories.
const UNDO_BATCH_SIZE = 20;

/** Queue undo or continue an interrupted undo without changing its durable cursor. */
export async function queueOrganizationUndo(
  database: QflowDatabase,
  ctx: RequestContext,
  input: { readonly runId: string; readonly expectedExecutionId: string },
  now: Date,
): Promise<EnrichmentResult<string, OrganizationFailure>> {
  if (![input.runId, input.expectedExecutionId].every(isCanonicalUuid)) {
    return { ok: false, code: 'invalid_input' };
  }
  const executionId = await uuidV5(input.runId, `undo:${input.expectedExecutionId}`);
  try {
    return await database.transaction(async (tx) => {
      if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
        return { ok: false, code: 'forbidden' } as const;
      }
      // Reconciliation acquires dispatch then run; preserve that lock order.
      await tx.select({ id: workflowDispatches.id }).from(workflowDispatches).where(and(
        eq(workflowDispatches.id, input.expectedExecutionId),
        eq(workflowDispatches.jobId, input.runId),
        eq(workflowDispatches.tenantId, ctx.tenantId),
      )).for('update');
      const [run] = await tx.select().from(organizationRuns).where(and(
        eq(organizationRuns.id, input.runId),
        eq(organizationRuns.tenantId, ctx.tenantId),
      )).for('update');
      if (!run) return { ok: false, code: 'not_found' } as const;
      if (run.mode !== 'apply') return { ok: false, code: 'invalid_input' } as const;
      if (run.state === 'undone') return { ok: true, value: run.id } as const;
      const [replay] = await tx.select({ id: workflowDispatches.id }).from(workflowDispatches)
        .where(and(
          eq(workflowDispatches.id, executionId),
          eq(workflowDispatches.jobId, run.id),
          eq(workflowDispatches.tenantId, ctx.tenantId),
          eq(workflowDispatches.kind, 'question_organization'),
        ));
      if (replay) return { ok: true, value: run.id } as const;
      if (run.executionId !== input.expectedExecutionId) {
        return { ok: false, code: 'conflict' } as const;
      }
      if (!['completed', 'failed', 'cancelled', 'undo_failed'].includes(run.state)) {
        return { ok: false, code: 'active_run' } as const;
      }
      await tx.update(organizationRuns).set({
        state: 'undoing',
        executionId,
        executionBy: ctx.userId,
        undoBy: ctx.userId,
      })
        .where(eq(organizationRuns.id, run.id));
      await tx.update(workflowDispatches).set({
        state: 'complete',
        startedAt:
          sql`COALESCE(${workflowDispatches.startedAt}, ${now.toISOString()}::timestamptz)`,
        completedAt: now,
        updatedAt: now,
        lastErrorCode: 'superseded_by_user_action',
      }).where(
        and(
          eq(workflowDispatches.id, input.expectedExecutionId),
          inArray(workflowDispatches.state, ['pending', 'active']),
        ),
      );
      await tx.insert(workflowDispatches).values({
        id: executionId,
        kind: 'question_organization',
        jobId: run.id,
        tenantId: ctx.tenantId,
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      await recordAuditEventInTransaction(tx, {
        eventId: executionId,
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'question_organization_undo_queued',
        metadata: {
          runId: run.id,
          executionId,
          previousExecutionId: input.expectedExecutionId,
          processed: run.undoProcessed,
        },
      });
      return { ok: true, value: run.id } as const;
    });
  } catch (cause) {
    console.error('Organization undo queue failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

/** Each transaction commits compensation and its cursor together; retries never redo a batch. */
export async function processOrganizationUndoStep(
  context: OrganizationRun,
  database: QflowDatabase,
  now: Date,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  return await database.transaction(async (tx) => {
    if (!await authorizeEnrichment(tx, context.ctx, 'manage_content')) {
      return { ok: false, code: 'forbidden' } as const;
    }
    const [run] = await tx.select().from(organizationRuns).where(
      eq(organizationRuns.id, context.run.id),
    ).for('update');
    if (run.executionId !== context.run.executionId) {
      return { ok: false, code: 'not_found' } as const;
    }
    if (run.state !== 'undoing') {
      return {
        ok: true,
        value: {
          state: run.state === 'undone' ? 'completed' : 'failed',
          completed: run.undoProcessed,
        },
      } as const;
    }
    const items = await tx.select().from(organizationItems).where(and(
      eq(organizationItems.runId, run.id),
      run.undoCursor ? gt(organizationItems.questionId, run.undoCursor) : undefined,
    )).orderBy(organizationItems.questionId).limit(UNDO_BATCH_SIZE + 1);
    const batch = items.slice(0, UNDO_BATCH_SIZE);
    // These writes share a transaction and one connection; serialize them intentionally.
    for (const item of batch) await undoOrganizationItem(tx, context, item, now);
    const more = items.length > UNDO_BATCH_SIZE;
    const processed = run.undoProcessed + batch.length;
    await tx.update(organizationRuns).set({
      undoCursor: batch.length ? batch[batch.length - 1].questionId : run.undoCursor,
      undoProcessed: processed,
      state: more ? 'undoing' : 'undone',
    }).where(eq(organizationRuns.id, run.id));
    return {
      ok: true,
      value: { state: more ? 'more' : 'completed', completed: processed },
    } as const;
  });
}
