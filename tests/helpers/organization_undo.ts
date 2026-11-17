import { eq } from 'drizzle-orm';
import type { QflowDatabase } from '../../lib/db.ts';
import { organizationRuns } from '../../lib/db/question_organization_schema.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { queueOrganizationUndo } from '../../lib/services/question_organization_undo.ts';
import { processOrganizationStep } from '../../lib/services/question_organization_processor.ts';

/** Existing persistence scenarios explicitly drain the newly asynchronous undo command. */
export async function completeOrganizationUndoForTest(
  database: QflowDatabase,
  ctx: RequestContext,
  runId: string,
  now: Date,
) {
  const [before] = await database.select().from(organizationRuns).where(
    eq(organizationRuns.id, runId),
  );
  if (!before) throw new Error('Missing fixture run');
  const result = await queueOrganizationUndo(database, ctx, {
    runId,
    expectedExecutionId: before.executionId,
  }, now);
  if (!result.ok || before.state === 'undone') return result;
  const [run] = await database.select().from(organizationRuns).where(
    eq(organizationRuns.id, runId),
  );
  for (let step = 0; step < 501; step++) {
    const outcome = await processOrganizationStep({
      jobId: runId,
      workflowExecutionId: run.executionId,
    }, {
      database,
      now: () => now,
      newId: () => crypto.randomUUID(),
      provider: () => {
        throw new Error('Undo must not invoke a model');
      },
    });
    if (!outcome.ok || outcome.value.state === 'failed') throw new Error('Fixture undo failed');
    if (outcome.value.state === 'completed') return result;
  }
  throw new Error('Fixture undo exceeded its bounded steps');
}
