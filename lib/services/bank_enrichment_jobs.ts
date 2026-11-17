import { and, eq, inArray, sql } from 'drizzle-orm';
import { canonicalJsonStringify } from '../canonical_json.ts';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import {
  enrichmentBatches,
  enrichmentRunItems,
  enrichmentRuns,
} from '../db/bank_enrichment_job_schema.ts';
import { enrichmentPreviews, enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import { enrichmentBudgets } from '../db/bank_enrichment_usage_schema.ts';
import { workflowDispatches } from '../db/workflow_canvas_schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import { parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import { parseEnrichmentMutationConfiguration } from './bank_enrichment_mutation_contract.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import {
  type EnrichmentJobFailure,
  parseEnrichmentPreviewInput,
} from './bank_enrichment_job_contract.ts';
import { BankEnrichmentUsage } from './bank_enrichment_usage.ts';
import { enrichmentExampleSourcesExist } from './bank_enrichment_sources.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';

/** Queue and control durable work without changing its frozen inputs or published classifications. */
export class BankEnrichmentJobs {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** Create a preview with an explicit budget; task, preview and dispatch become visible together. */
  async queuePreview(
    ctx: RequestContext,
    id: string,
    snapshotId: string,
    executionId: string,
    input: unknown,
    configuration: unknown,
  ): Promise<EnrichmentResult<string, EnrichmentJobFailure>> {
    const command = parseEnrichmentPreviewInput(input);
    if (!command || !isCanonicalUuid(executionId)) return { ok: false, code: 'invalid_input' };
    const budget = await new BankEnrichmentUsage(this.database, this.now).open(
      ctx,
      id,
      snapshotId,
      'preview',
      configuration,
    );
    if (!budget.ok) {
      return {
        ok: false,
        code: budget.code === 'storage_failed'
          ? 'storage_failed'
          : budget.code === 'forbidden'
          ? 'forbidden'
          : 'invalid_input',
      };
    }
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [task] = await tx.select().from(enrichmentTasks).where(eq(enrichmentTasks.id, id));
        if (task) {
          if (task.kind !== 'preview' || task.tenantId !== ctx.tenantId) {
            return { ok: false, code: 'operation_conflict' } as const;
          }
          const [preview] = await tx.select().from(enrichmentPreviews).where(
            eq(enrichmentPreviews.id, id),
          );
          return preview && preview.workflowExecutionId === executionId &&
              canonicalJsonStringify({
                  seed: preview.seed,
                  baseVersionId: preview.baseVersionId,
                  audience: preview.audience,
                  definition: preview.definition,
                }) === canonicalJsonStringify(command)
            ? { ok: true, value: id } as const
            : { ok: false, code: 'operation_conflict' } as const;
        }
        const [run] = await tx.select({ id: enrichmentRuns.id }).from(enrichmentRuns).where(
          eq(enrichmentRuns.id, id),
        );
        if (run) return { ok: false, code: 'operation_conflict' } as const;
        if (command.baseVersionId !== null) {
          const [base] = await tx.select({ id: enrichmentSchemeVersions.id }).from(
            enrichmentSchemeVersions,
          )
            .where(
              and(
                eq(enrichmentSchemeVersions.id, command.baseVersionId),
                eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
              ),
            );
          if (!base) return { ok: false, code: 'invalid_input' } as const;
        }
        if (
          command.definition &&
          !await enrichmentExampleSourcesExist(tx, ctx.tenantId, command.definition.examples)
        ) {
          return { ok: false, code: 'invalid_input' } as const;
        }
        await tx.insert(enrichmentTasks).values({
          id,
          tenantId: ctx.tenantId,
          budgetId: id,
          kind: 'preview',
        });
        await tx.insert(enrichmentPreviews).values({
          id,
          tenantId: ctx.tenantId,
          ...command,
          state: 'queued',
          phase: command.definition === null ? 'propose' : 'measure',
          workflowExecutionId: executionId,
          createdAt: this.now(),
          updatedAt: this.now(),
        });
        await insertDispatch(tx, ctx, id, executionId);
        return { ok: true, value: id } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Bind the prepared run's model and reserve limit before atomically dispatching it. */
  async queueRun(
    ctx: RequestContext,
    id: string,
    executionId: string,
    configuration: unknown,
  ): Promise<EnrichmentResult<string, EnrichmentJobFailure>> {
    if (!isCanonicalUuid(id) || !isCanonicalUuid(executionId)) {
      return { ok: false, code: 'invalid_input' };
    }
    try {
      const [run] = await this.database.select().from(enrichmentRuns).where(
        and(eq(enrichmentRuns.id, id), eq(enrichmentRuns.tenantId, ctx.tenantId)),
      );
      if (!run) return { ok: false, code: 'not_found' };
      if (run.kind !== 'classify') return { ok: false, code: 'invalid_transition' };
      const budget = await new BankEnrichmentUsage(this.database, this.now).open(
        ctx,
        id,
        run.snapshotId,
        'run',
        configuration,
      );
      if (!budget.ok) {
        return {
          ok: false,
          code: budget.code === 'storage_failed'
            ? 'storage_failed'
            : budget.code === 'forbidden'
            ? 'forbidden'
            : 'operation_conflict',
        };
      }
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [current] = await tx.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id))
          .for('update');
        if (current.workflowExecutionId === executionId) return { ok: true, value: id } as const;
        if (current.state !== 'prepared' || current.kind !== 'classify') {
          return { ok: false, code: 'invalid_transition' } as const;
        }
        if (await activeSchemeRun(tx, current.schemeId, id)) {
          return { ok: false, code: 'active_run' } as const;
        }
        const [reserved] = await tx.select().from(enrichmentBudgets).where(
          eq(enrichmentBudgets.id, id),
        );
        await tx.insert(enrichmentTasks).values({
          id,
          tenantId: ctx.tenantId,
          budgetId: id,
          kind: 'classify',
        });
        await tx.update(enrichmentRuns).set({
          configuration: reserved.configuration,
          state: 'queued',
          workflowExecutionId: executionId,
          updatedAt: this.now(),
        }).where(eq(enrichmentRuns.id, id));
        await insertDispatch(tx, ctx, id, executionId);
        return { ok: true, value: id } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Dispatch a prepared correction or undo without an AI budget or provider configuration. */
  async queueMutation(
    ctx: RequestContext,
    id: string,
    executionId: string,
  ): Promise<EnrichmentResult<string, EnrichmentJobFailure>> {
    if (!isCanonicalUuid(id) || !isCanonicalUuid(executionId)) {
      return { ok: false, code: 'invalid_input' };
    }
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [run] = await tx.select().from(enrichmentRuns).where(
          and(eq(enrichmentRuns.id, id), eq(enrichmentRuns.tenantId, ctx.tenantId)),
        ).for('update');
        if (!run) return { ok: false, code: 'not_found' } as const;
        if (run.kind !== 'correct' && run.kind !== 'undo') {
          return { ok: false, code: 'invalid_transition' } as const;
        }
        if (run.createdBy !== ctx.userId) return { ok: false, code: 'forbidden' } as const;
        if (run.workflowExecutionId === executionId) return { ok: true, value: id } as const;
        if (run.state !== 'prepared') return { ok: false, code: 'invalid_transition' } as const;
        const [version] = await tx.select().from(enrichmentSchemeVersions).where(
          and(
            eq(enrichmentSchemeVersions.id, run.versionId),
            eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
          ),
        );
        const definition = parseEnrichmentDefinition(version?.definition);
        const configuration = definition &&
          parseEnrichmentMutationConfiguration(run.configuration, definition);
        if (!configuration || configuration.kind !== run.kind) {
          throw new Error('Invalid prepared enrichment mutation.');
        }
        await tx.insert(enrichmentTasks).values({
          id,
          tenantId: ctx.tenantId,
          budgetId: null,
          kind: run.kind,
        });
        await tx.update(enrichmentRuns).set({
          state: 'queued',
          workflowExecutionId: executionId,
          updatedAt: this.now(),
        }).where(eq(enrichmentRuns.id, id));
        await insertDispatch(tx, ctx, id, executionId);
        return { ok: true, value: id } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Cancel future work and fence active writers; completed assignments remain intact. */
  async cancel(
    ctx: RequestContext,
    id: string,
  ): Promise<EnrichmentResult<string, EnrichmentJobFailure>> {
    if (!isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [task] = await tx.select().from(enrichmentTasks).where(
          and(eq(enrichmentTasks.id, id), eq(enrichmentTasks.tenantId, ctx.tenantId)),
        );
        if (!task) return { ok: false, code: 'not_found' } as const;
        await retireDispatch(tx, id, this.now());
        if (task.kind === 'preview') {
          await tx.update(enrichmentPreviews).set({
            state: 'cancelled',
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: this.now(),
          }).where(
            and(
              eq(enrichmentPreviews.id, id),
              inArray(enrichmentPreviews.state, ['queued', 'running', 'failed']),
            ),
          );
        } else {
          await tx.update(enrichmentRuns).set({
            state: 'cancelled',
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: this.now(),
          }).where(
            and(
              eq(enrichmentRuns.id, id),
              inArray(enrichmentRuns.state, ['queued', 'running', 'failed']),
            ),
          );
          await tx.update(enrichmentRunItems).set({
            state: 'cancelled',
            detail: { code: 'cancelled' },
          }).where(and(eq(enrichmentRunItems.runId, id), eq(enrichmentRunItems.state, 'pending')));
        }
        return { ok: true, value: id } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Resume only failed/cancelled items; the source references, model and budget stay frozen. */
  async resume(
    ctx: RequestContext,
    id: string,
    executionId: string,
  ): Promise<EnrichmentResult<string, EnrichmentJobFailure>> {
    if (!isCanonicalUuid(id) || !isCanonicalUuid(executionId)) {
      return { ok: false, code: 'invalid_input' };
    }
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [task] = await tx.select().from(enrichmentTasks).where(
          and(eq(enrichmentTasks.id, id), eq(enrichmentTasks.tenantId, ctx.tenantId)),
        );
        if (!task) return { ok: false, code: 'not_found' } as const;
        await tx.select({ id: workflowDispatches.id }).from(workflowDispatches).where(
          and(eq(workflowDispatches.kind, 'bank_enrichment'), eq(workflowDispatches.jobId, id)),
        ).for('update');
        if (task.kind === 'preview') {
          const [preview] = await tx.select().from(enrichmentPreviews).where(
            eq(enrichmentPreviews.id, id),
          ).for('update');
          if (preview.workflowExecutionId === executionId) return { ok: true, value: id } as const;
          if (!['failed', 'cancelled'].includes(preview.state)) {
            return { ok: false, code: 'invalid_transition' } as const;
          }
          await tx.update(enrichmentPreviews).set({
            state: 'queued',
            errorCode: null,
            retriesRemaining: 3,
            workflowExecutionId: executionId,
            updatedAt: this.now(),
          }).where(eq(enrichmentPreviews.id, id));
        } else {
          const [run] = await tx.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id)).for(
            'update',
          );
          if (run.workflowExecutionId === executionId) return { ok: true, value: id } as const;
          if (!['failed', 'cancelled', 'completed_with_issues'].includes(run.state)) {
            return { ok: false, code: 'invalid_transition' } as const;
          }
          if (run.kind === 'classify' && await activeSchemeRun(tx, run.schemeId, id)) {
            return { ok: false, code: 'active_run' } as const;
          }
          await tx.update(enrichmentRunItems).set({ state: 'pending', detail: null }).where(
            and(
              eq(enrichmentRunItems.runId, id),
              inArray(enrichmentRunItems.state, ['failed', 'cancelled']),
            ),
          );
          await tx.update(enrichmentBatches).set({
            state: 'reserved',
            retriesRemaining: 3,
            errorCode: null,
          }).where(
            and(
              eq(enrichmentBatches.runId, id),
              inArray(enrichmentBatches.state, ['reserved', 'failed']),
            ),
          );
          await tx.update(enrichmentRuns).set({
            state: 'queued',
            result: null,
            workflowExecutionId: executionId,
            updatedAt: this.now(),
          }).where(eq(enrichmentRuns.id, id));
        }
        await retireDispatch(tx, id, this.now());
        await insertDispatch(tx, ctx, id, executionId);
        return { ok: true, value: id } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }
}

async function activeSchemeRun(
  tx: QflowDatabaseTransaction,
  schemeId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx.select({ id: enrichmentRuns.id }).from(enrichmentRuns).where(
    and(
      eq(enrichmentRuns.schemeId, schemeId),
      eq(enrichmentRuns.kind, 'classify'),
      inArray(enrichmentRuns.state, ['queued', 'running']),
    ),
  );
  return rows.some((run) => run.id !== id);
}
async function insertDispatch(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  jobId: string,
  id: string,
) {
  await tx.insert(workflowDispatches).values({
    id,
    tenantId: ctx.tenantId,
    jobId,
    kind: 'bank_enrichment',
    state: 'pending',
  });
}
async function retireDispatch(tx: QflowDatabaseTransaction, id: string, now: Date) {
  await tx.update(workflowDispatches).set({
    state: 'complete',
    startedAt: sql`COALESCE(${workflowDispatches.startedAt}, ${now.toISOString()}::timestamptz)`,
    completedAt: now,
    updatedAt: now,
    lastErrorCode: 'superseded_by_user_action',
  }).where(
    and(
      eq(workflowDispatches.kind, 'bank_enrichment'),
      eq(workflowDispatches.jobId, id),
      inArray(workflowDispatches.state, ['pending', 'active']),
    ),
  );
}
/** Safe database failure translation shared by the enrichment adapters. */
export function jobStorageFailure(
  cause: unknown,
): { readonly ok: false; readonly code: 'storage_failed' } {
  console.error('Enrichment job persistence failed', safeErrorSummary(cause));
  return { ok: false, code: 'storage_failed' };
}
