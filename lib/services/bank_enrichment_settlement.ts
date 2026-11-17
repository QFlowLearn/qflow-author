import { and, eq } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { enrichmentRunItems, enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentPreviews, enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import type { WorkflowTerminalDomainOutcome } from '../job_failure.ts';

/** A stale Workflow observation cannot terminate a newly resumed enrichment execution. */
export async function settleEnrichmentAfterWorkflowTerminal(
  tx: QflowDatabaseTransaction,
  input: {
    readonly jobId: string;
    readonly tenantId: string;
    readonly executionId: string;
    readonly now: Date;
  },
): Promise<WorkflowTerminalDomainOutcome> {
  const [task] = await tx.select().from(enrichmentTasks).where(
    and(eq(enrichmentTasks.id, input.jobId), eq(enrichmentTasks.tenantId, input.tenantId)),
  );
  if (!task) return { _tag: 'JobMissing' };
  const table = task.kind === 'preview' ? enrichmentPreviews : enrichmentRuns;
  const [row] = await tx.select().from(table).where(
    and(eq(table.id, task.id), eq(table.tenantId, task.tenantId)),
  ).for('update');
  if (!row) return { _tag: 'JobMissing' };
  if (row.workflowExecutionId !== input.executionId) return { _tag: 'AlreadyFailed' };
  if (row.state === 'completed' || row.state === 'completed_with_issues') {
    return { _tag: 'AlreadyCompleted' };
  }
  if (row.state === 'failed' || row.state === 'cancelled') return { _tag: 'AlreadyFailed' };
  const now = input.now;
  if (task.kind === 'preview') {
    await tx.update(enrichmentPreviews).set({
      state: 'failed',
      errorCode: 'workflow_stopped',
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    }).where(eq(enrichmentPreviews.id, task.id));
  } else {
    await tx.update(enrichmentRunItems).set({
      state: 'failed',
      detail: { code: 'workflow_stopped' },
    }).where(and(eq(enrichmentRunItems.runId, task.id), eq(enrichmentRunItems.state, 'pending')));
    await tx.update(enrichmentRuns).set({
      state: 'failed',
      result: { code: 'workflow_stopped' },
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    }).where(eq(enrichmentRuns.id, task.id));
  }
  return { _tag: 'Failed' };
}
