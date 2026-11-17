import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbReadConnection, QflowDatabase } from '../db.ts';
import { organizationItems, organizationRuns } from '../db/question_organization_schema.ts';
import { workflowDispatches } from '../db/workflow_canvas_schema.ts';
import { CLEF_INPUT_TOKEN_LIMIT } from '../ai/clef_organization_provider.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import type { OrganizationFailure } from './question_organization_contract.ts';
import { loadOrganizationRun, type OrganizationRun } from './question_organization_read.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';

function resumeConditions(context: OrganizationRun) {
  const classifier = context.policy.classifier;
  const canReserve = classifier.kind === 'source_only' ||
    context.run.reservedMicros +
          Math.ceil(CLEF_INPUT_TOKEN_LIMIT * classifier.config.inputMicrosPerMillion / 1_000_000) <=
      classifier.config.budgetMicros;
  const unfinished = sql`(${organizationItems.state} = 'cancelled' OR
    (${organizationItems.state} = 'failed' AND (${organizationItems.decision} IS NOT NULL OR
      ${organizationItems.detail} IN ('workflow_stopped', 'provider_failed', 'aborted',
        'attempts_exhausted', 'budget_exceeded'))))`;
  return {
    unfinished,
    affordable: sql`(${organizationItems.decision} IS NOT NULL OR ${canReserve})`,
  };
}

/** Use the same eligibility for the control and the transaction, including the frozen spend cap. */
export async function loadOrganizationRecovery(
  database: DbReadConnection,
  context: OrganizationRun,
) {
  if (!['cancelled', 'failed'].includes(context.run.state)) return { count: 0, budgetBlocked: 0 };
  const { unfinished, affordable } = resumeConditions(context);
  const [counts] = await database.select({
    count: sql<number>`count(*) FILTER (WHERE ${unfinished} AND ${affordable})`.mapWith(Number),
    budgetBlocked: sql<number>`count(*) FILTER (WHERE ${unfinished} AND NOT ${affordable})`
      .mapWith(Number),
  }).from(organizationItems).where(eq(organizationItems.runId, context.run.id));
  return counts;
}

/** Resume the frozen scope once per stopped execution; retain receipts and every spending charge. */
export async function resumeOrganizationRun(
  database: QflowDatabase,
  ctx: RequestContext,
  runId: string,
  expectedExecutionId: string,
  now: Date,
): Promise<EnrichmentResult<string, OrganizationFailure>> {
  if (![runId, expectedExecutionId].every(isCanonicalUuid)) {
    return { ok: false, code: 'invalid_input' };
  }
  const executionId = await uuidV5(runId, `resume:${expectedExecutionId}`);
  try {
    return await database.transaction(async (tx) => {
      if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
        return { ok: false, code: 'forbidden' } as const;
      }
      // Reconciliation locks the dispatch before the run. Keep the same lock order.
      await tx.select({ id: workflowDispatches.id }).from(workflowDispatches).where(and(
        eq(workflowDispatches.id, expectedExecutionId),
        eq(workflowDispatches.tenantId, ctx.tenantId),
        eq(workflowDispatches.jobId, runId),
      )).for('update');
      const [run] = await tx.select().from(organizationRuns).where(and(
        eq(organizationRuns.id, runId),
        eq(organizationRuns.tenantId, ctx.tenantId),
      )).for('update');
      if (!run) return { ok: false, code: 'not_found' } as const;
      const [replay] = await tx.select().from(workflowDispatches).where(and(
        eq(workflowDispatches.id, executionId),
        eq(workflowDispatches.jobId, runId),
        eq(workflowDispatches.tenantId, ctx.tenantId),
        eq(workflowDispatches.kind, 'question_organization'),
      ));
      if (replay) return { ok: true, value: runId } as const;
      if (run.executionId !== expectedExecutionId || !['cancelled', 'failed'].includes(run.state)) {
        return { ok: false, code: 'conflict' } as const;
      }
      const context = await loadOrganizationRun(tx, runId, expectedExecutionId, {
        kind: 'request',
        ctx,
      });
      if (!context) return { ok: false, code: 'not_found' } as const;
      const recovery = await loadOrganizationRecovery(tx, context);
      if (!recovery.count) return { ok: false, code: 'conflict' } as const;
      const { unfinished, affordable } = resumeConditions(context);
      await tx.update(organizationItems).set({
        state:
          sql`CASE WHEN ${organizationItems.decision} IS NOT NULL THEN 'received' ELSE 'pending' END`,
        // This counter bounds automatic retries in one explicitly authorized execution.
        // The immutable attempt ledger and run spending total are never reset.
        attempts: 0,
        detail: null,
        leaseToken: null,
        leaseExpiresAt: null,
      }).where(and(eq(organizationItems.runId, runId), unfinished, affordable));
      await tx.update(organizationRuns).set({
        state: 'queued',
        executionId,
        executionBy: ctx.userId,
      }).where(
        eq(organizationRuns.id, runId),
      );
      await tx.update(workflowDispatches).set({
        state: 'complete',
        startedAt:
          sql`COALESCE(${workflowDispatches.startedAt}, ${now.toISOString()}::timestamptz)`,
        completedAt: now,
        updatedAt: now,
        lastErrorCode: 'superseded_by_user_action',
      }).where(and(
        eq(workflowDispatches.id, expectedExecutionId),
        inArray(workflowDispatches.state, ['pending', 'active']),
      ));
      await tx.insert(workflowDispatches).values({
        id: executionId,
        kind: 'question_organization',
        jobId: runId,
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
        action: 'question_organization_resumed',
        metadata: {
          runId,
          previousExecutionId: expectedExecutionId,
          executionId,
          count: recovery.count,
        },
      });
      return { ok: true, value: runId } as const;
    });
  } catch (cause) {
    console.error('Organization resume failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}
