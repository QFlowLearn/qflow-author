import { and, count, eq, gt, sql } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { enrichmentRunItems, enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentPreviews, enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import { enrichmentBudgets } from '../db/bank_enrichment_usage_schema.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import { organizationMemberships } from '../db/principal_schema.ts';
import { type EnrichmentAIConfig, parseEnrichmentAIConfig } from '../ai/bank_enrichment_config.ts';
import { parseRole } from '../roles.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import {
  type EnrichmentDefinition,
  type EnrichmentResult,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import type {
  EnrichmentBatchProgress,
  EnrichmentJobFailure,
} from './bank_enrichment_job_contract.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';
import {
  parsePrepareEnrichmentRun,
  type PrepareEnrichmentRun,
} from './bank_enrichment_run_contract.ts';

type ClaimIdentity = {
  readonly id: string;
  readonly executionId: string;
  readonly token: string;
  readonly ctx: RequestContext;
  readonly configuration: EnrichmentAIConfig;
  readonly snapshotId: string;
};
/** The task discriminant is read from the registry, never guessed from missing rows. */
export type EnrichmentClaim =
  & ClaimIdentity
  & (
    | {
      readonly kind: 'classify';
      readonly run: typeof enrichmentRuns.$inferSelect;
      readonly command: PrepareEnrichmentRun;
      readonly definition: EnrichmentDefinition;
    }
    | { readonly kind: 'preview'; readonly preview: typeof enrichmentPreviews.$inferSelect }
  );
type ClaimResult = { readonly kind: 'claimed'; readonly claim: EnrichmentClaim } | {
  readonly kind: 'progress';
  readonly progress: EnrichmentBatchProgress;
};

/** Lease ownership changes for every bounded step, fencing late provider responses. */
export async function claimEnrichmentStep(
  database: QflowDatabase,
  now: Date,
  id: string,
  executionId: string,
  token: string,
): Promise<EnrichmentResult<ClaimResult, EnrichmentJobFailure>> {
  if (![id, executionId, token].every(isCanonicalUuid)) return { ok: false, code: 'invalid_input' };
  try {
    return await database.transaction(
      async (tx): Promise<EnrichmentResult<ClaimResult, EnrichmentJobFailure>> => {
        const [record] = await tx.select({ task: enrichmentTasks, budget: enrichmentBudgets }).from(
          enrichmentTasks,
        ).innerJoin(enrichmentBudgets, eq(enrichmentBudgets.id, enrichmentTasks.budgetId)).where(
          eq(enrichmentTasks.id, id),
        );
        if (!record) return { ok: false, code: 'not_found' };
        const [member] = await tx.select({ role: organizationMemberships.role }).from(
          organizationMemberships,
        ).where(
          and(
            eq(organizationMemberships.tenantId, record.task.tenantId),
            eq(organizationMemberships.userId, record.budget.createdBy),
          ),
        );
        const role = parseRole(member?.role);
        if (!role) return { ok: false, code: 'forbidden' };
        const ctx = { tenantId: record.task.tenantId, userId: record.budget.createdBy, role };
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' };
        }
        const configuration = parseEnrichmentAIConfig(record.budget.configuration);
        if (!configuration) throw new Error('Invalid stored enrichment model configuration.');
        const identity = {
          id,
          executionId,
          token,
          ctx,
          configuration,
          snapshotId: record.budget.snapshotId,
        };
        const lease = {
          state: 'running',
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + 180_000),
          updatedAt: now,
        };
        if (record.task.kind === 'preview') {
          const [preview] = await tx.select().from(enrichmentPreviews).where(
            eq(enrichmentPreviews.id, id),
          ).for('update');
          if (!preview) throw new Error('Preview task has no preview record.');
          const progress = executionProgress(preview, executionId, now, 0);
          if (progress) return { ok: true, value: { kind: 'progress', progress } };
          await tx.update(enrichmentPreviews).set(lease).where(eq(enrichmentPreviews.id, id));
          return {
            ok: true,
            value: { kind: 'claimed', claim: { ...identity, kind: 'preview', preview } },
          };
        }
        if (record.task.kind !== 'classify') {
          throw new Error('Invalid stored enrichment task kind.');
        }
        const [run] = await tx.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id)).for(
          'update',
        );
        if (!run) throw new Error('Classification task has no run record.');
        const progress = executionProgress(run, executionId, now, await completedCount(tx, id));
        if (progress) return { ok: true, value: { kind: 'progress', progress } };
        const command = parsePrepareEnrichmentRun(runInput(run));
        const [version] = await tx.select().from(enrichmentSchemeVersions).where(
          and(
            eq(enrichmentSchemeVersions.id, run.versionId),
            eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
          ),
        );
        const definition = parseEnrichmentDefinition(version?.definition);
        if (!command || !definition) throw new Error('Invalid stored classification input.');
        await tx.update(enrichmentRuns).set(lease).where(eq(enrichmentRuns.id, id));
        return {
          ok: true,
          value: {
            kind: 'claimed',
            claim: { ...identity, kind: 'classify', run, command, definition },
          },
        };
      },
    );
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

/** Check ownership and current permission inside the same transaction as a checkpoint/write. */
export async function lockEnrichmentClaim(
  tx: QflowDatabaseTransaction,
  claim: EnrichmentClaim,
  now: Date,
): Promise<boolean> {
  if (!await authorizeEnrichment(tx, claim.ctx, 'manage_content')) return false;
  const table = claim.kind === 'preview' ? enrichmentPreviews : enrichmentRuns;
  const [row] = await tx.select({ id: table.id }).from(table).where(
    and(
      eq(table.id, claim.id),
      eq(table.tenantId, claim.ctx.tenantId),
      eq(table.state, 'running'),
      eq(table.workflowExecutionId, claim.executionId),
      eq(table.leaseToken, claim.token),
      gt(table.leaseExpiresAt, now),
    ),
  ).for('update');
  return row !== undefined;
}

/** Releasing a completed step allows the next one to claim a fresh fencing token. */
export async function releaseEnrichmentStep(
  tx: QflowDatabaseTransaction,
  claim: EnrichmentClaim,
  now: Date,
): Promise<void> {
  const table = claim.kind === 'preview' ? enrichmentPreviews : enrichmentRuns;
  await tx.update(table).set({ leaseExpiresAt: now, updatedAt: now }).where(
    and(eq(table.id, claim.id), eq(table.leaseToken, claim.token)),
  );
}

/** Count reconciled outcomes, including issues; never count pending questions as tagged. */
export async function completedCount(tx: QflowDatabaseTransaction, id: string): Promise<number> {
  const [row] = await tx.select({ total: count() }).from(enrichmentRunItems).where(
    and(eq(enrichmentRunItems.runId, id), sql`${enrichmentRunItems.state} <> 'pending'`),
  );
  return row.total;
}

/** Terminate owned work with explicit outcomes for every remaining question. */
export async function failEnrichmentClaim(
  database: QflowDatabase,
  claim: EnrichmentClaim,
  code: string,
  now: Date,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await lockEnrichmentClaim(tx, claim, now)) {
        return { ok: false, code: 'lease_lost' } as const;
      }
      if (claim.kind === 'preview') {
        await tx.update(enrichmentPreviews).set({
          state: 'failed',
          errorCode: code,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: now,
        }).where(eq(enrichmentPreviews.id, claim.id));
        return { ok: true, value: { state: 'failed', completed: 0 } } as const;
      }
      await tx.update(enrichmentRunItems).set({ state: 'failed', detail: { code } }).where(
        and(eq(enrichmentRunItems.runId, claim.id), eq(enrichmentRunItems.state, 'pending')),
      );
      await tx.update(enrichmentRuns).set({
        state: 'failed',
        result: { code },
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }).where(eq(enrichmentRuns.id, claim.id));
      return {
        ok: true,
        value: { state: 'failed', completed: await completedCount(tx, claim.id) },
      } as const;
    });
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}

/** Interpret the persisted execution identity and lifecycle before claiming work. */
export function executionProgress(
  row: { state: string; workflowExecutionId: string | null; leaseExpiresAt: Date | null },
  executionId: string,
  now: Date,
  completed: number,
): EnrichmentBatchProgress | null {
  if (row.workflowExecutionId !== executionId || row.state === 'cancelled') {
    return { state: 'cancelled', completed };
  }
  if (row.state === 'completed' || row.state === 'completed_with_issues') {
    return { state: 'completed', completed };
  }
  if (row.state === 'failed') return { state: 'failed', completed };
  if (row.state === 'running' && row.leaseExpiresAt && row.leaseExpiresAt > now) {
    return { state: 'busy', completed };
  }
  if (row.state !== 'queued' && row.state !== 'running') {
    throw new Error('Enrichment task is not dispatchable.');
  }
  return null;
}
function runInput(run: typeof enrichmentRuns.$inferSelect) {
  return {
    snapshotId: run.snapshotId,
    versionId: run.versionId,
    dimensions: run.dimensions,
    replacement: run.replacement,
  };
}
