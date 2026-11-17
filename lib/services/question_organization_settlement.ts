import { recordOrganizationNotice } from './question_organization_notices.ts';
import { and, eq, inArray } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { organizationItems, organizationRuns } from '../db/question_organization_schema.ts';
import type { WorkflowTerminalDomainOutcome } from '../job_failure.ts';

/** Platform recovery cannot silently report a partially applied run as complete. */
export async function settleOrganizationAfterWorkflowTerminal(tx: QflowDatabaseTransaction, input: {
  readonly jobId: string;
  readonly tenantId: string;
  readonly executionId: string;
}): Promise<WorkflowTerminalDomainOutcome> {
  const [run] = await tx.select().from(organizationRuns).where(
    and(eq(organizationRuns.id, input.jobId), eq(organizationRuns.tenantId, input.tenantId)),
  ).for('update');
  if (!run) return { _tag: 'JobMissing' };
  if (run.executionId !== input.executionId) return { _tag: 'AlreadyFailed' };
  if (run.state === 'completed' || run.state === 'undone') return { _tag: 'AlreadyCompleted' };
  if (run.state === 'undoing') {
    await tx.update(organizationRuns).set({ state: 'undo_failed' }).where(
      eq(organizationRuns.id, run.id),
    );
    return { _tag: 'Failed' };
  }
  if (run.state !== 'queued') return { _tag: 'AlreadyFailed' };
  await tx.update(organizationItems).set({
    state: 'failed',
    detail: 'workflow_stopped',
    leaseToken: null,
    leaseExpiresAt: null,
  }).where(
    and(
      eq(organizationItems.runId, run.id),
      inArray(organizationItems.state, ['pending', 'processing', 'received']),
    ),
  );
  await tx.update(organizationRuns).set({ state: 'failed' }).where(eq(organizationRuns.id, run.id));
  await recordOrganizationNotice(tx, run);
  return { _tag: 'Failed' };
}
