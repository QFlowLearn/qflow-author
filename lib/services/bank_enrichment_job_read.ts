import type { EnrichmentJobRecord, EnrichmentJobView } from './bank_enrichment_job_view.ts';
export type { EnrichmentJobView } from './bank_enrichment_job_view.ts';
import { readEnrichmentMutationJob } from './bank_enrichment_mutation_read.ts';
import { and, eq } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentPreviews, enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import { enrichmentBudgets } from '../db/bank_enrichment_usage_schema.ts';
import { enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';
import { organizationMemberships } from '../db/principal_schema.ts';
import { hasCapability, parseRole } from '../roles.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { canReadEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import {
  type EnrichmentJobFailure,
  parseEnrichmentPreviewInput,
} from './bank_enrichment_job_contract.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';
import {
  parseStoredEnrichmentPreviewResult,
  parseStoredEnrichmentSample,
} from './bank_enrichment_preview_codec.ts';
import { readEnrichmentRunProgress } from './bank_enrichment_progress.ts';
import { parsePrepareEnrichmentRun } from './bank_enrichment_run_contract.ts';
import { BankEnrichmentUsage } from './bank_enrichment_usage.ts';

/** Read one tenant-scoped task and validate its persisted lifecycle and reconciled counts. */
export class BankEnrichmentJobRead {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** Read the job's update token and current membership in one statement for polling. */
  async status(
    ctx: RequestContext,
    id: string,
  ): Promise<EnrichmentResult<{ readonly updatedAt: string }, EnrichmentJobFailure>> {
    if (!isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' };
    try {
      const [record] = await this.database.select({
        role: organizationMemberships.role,
        kind: enrichmentTasks.kind,
        previewUpdatedAt: enrichmentPreviews.updatedAt,
        runUpdatedAt: enrichmentRuns.updatedAt,
      }).from(organizationMemberships)
        .leftJoin(
          enrichmentTasks,
          and(
            eq(enrichmentTasks.id, id),
            eq(enrichmentTasks.tenantId, organizationMemberships.tenantId),
          ),
        )
        .leftJoin(
          enrichmentPreviews,
          and(
            eq(enrichmentPreviews.id, enrichmentTasks.id),
            eq(enrichmentPreviews.tenantId, enrichmentTasks.tenantId),
            eq(enrichmentTasks.kind, 'preview'),
          ),
        )
        .leftJoin(
          enrichmentRuns,
          and(
            eq(enrichmentRuns.id, enrichmentTasks.id),
            eq(enrichmentRuns.tenantId, enrichmentTasks.tenantId),
            eq(enrichmentRuns.kind, enrichmentTasks.kind),
          ),
        )
        .where(and(
          eq(organizationMemberships.tenantId, ctx.tenantId),
          eq(organizationMemberships.userId, ctx.userId),
        ));
      const role = parseRole(record?.role);
      if (!record || role === null || !hasCapability(role, 'view_content')) {
        return { ok: false, code: 'forbidden' };
      }
      if (record.kind === null) return { ok: false, code: 'not_found' };
      let updatedAt: Date | null;
      switch (record.kind) {
        case 'preview':
          updatedAt = record.previewUpdatedAt;
          break;
        case 'classify':
        case 'correct':
        case 'undo':
          updatedAt = record.runUpdatedAt;
          break;
        default:
          throw new Error('Invalid persisted enrichment task kind.');
      }
      if (!(updatedAt instanceof Date) || !Number.isFinite(updatedAt.getTime())) {
        throw new Error('Enrichment task is missing a valid update token.');
      }
      return { ok: true, value: { updatedAt: updatedAt.toISOString() } };
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Load a consistent job detail snapshot without advancing work or locking the workspace. */
  async get(
    ctx: RequestContext,
    id: string,
  ): Promise<EnrichmentResult<EnrichmentJobView, EnrichmentJobFailure>> {
    if (!isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' };
    try {
      const view = await this.database.transaction(
        async (tx): Promise<EnrichmentResult<EnrichmentJobRecord, EnrichmentJobFailure>> => {
          if (!await canReadEnrichment(tx, ctx, 'view_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const [task] = await tx.select().from(enrichmentTasks).where(
            and(eq(enrichmentTasks.id, id), eq(enrichmentTasks.tenantId, ctx.tenantId)),
          );
          if (!task) return { ok: false, code: 'not_found' };
          if (task.kind === 'correct' || task.kind === 'undo') {
            return { ok: true, value: await readEnrichmentMutationJob(tx, ctx, id, task.kind) };
          }
          const [record] = await tx.select({ task: enrichmentTasks, snapshot: enrichmentSnapshots })
            .from(enrichmentTasks)
            .innerJoin(enrichmentBudgets, eq(enrichmentBudgets.id, enrichmentTasks.budgetId))
            .innerJoin(
              enrichmentSnapshots,
              eq(enrichmentSnapshots.id, enrichmentBudgets.snapshotId),
            )
            .where(and(eq(enrichmentTasks.id, id), eq(enrichmentTasks.tenantId, ctx.tenantId)));
          if (!record) return { ok: false, code: 'not_found' };
          const identity = {
            id,
            snapshotId: record.snapshot.id,
            scopeCount: record.snapshot.itemCount,
            capturedAt: record.snapshot.createdAt.toISOString(),
          };
          if (record.task.kind === 'preview') {
            const [row] = await tx.select().from(enrichmentPreviews).where(
              eq(enrichmentPreviews.id, id),
            );
            if (!row) throw new Error('Preview task is missing its record.');
            const command = parseEnrichmentPreviewInput({
              seed: row.seed,
              baseVersionId: row.baseVersionId,
              audience: row.audience,
              definition: row.definition,
            });
            const state = row.state, phase = row.phase;
            if (
              !command || (phase !== 'propose' && phase !== 'measure') ||
              (state !== 'queued' && state !== 'running' && state !== 'completed' &&
                state !== 'failed' && state !== 'cancelled')
            ) {
              throw new Error('Invalid persisted preview lifecycle.');
            }
            const sample = row.sample === null ? null : parseStoredEnrichmentSample(row.sample);
            if (
              (row.sample !== null && !sample) ||
              (sample &&
                (sample.snapshotId !== identity.snapshotId || sample.seed !== command.seed ||
                  sample.scopeCount !== identity.scopeCount))
            ) {
              throw new Error('Invalid persisted preview sample.');
            }
            const result = row.result === null || !sample
              ? null
              : parseStoredEnrichmentPreviewResult(row.result, sample);
            if ((state === 'completed') !== (result !== null) || (row.result !== null && !result)) {
              throw new Error('Invalid persisted preview result.');
            }
            return {
              ok: true,
              value: {
                ...identity,
                updatedAt: row.updatedAt.toISOString(),
                kind: 'preview',
                baseVersionId: command.baseVersionId,
                state,
                phase,
                audience: command.audience,
                sample,
                result,
                errorCode: state === 'failed' ? row.errorCode : null,
              },
            };
          }
          if (record.task.kind !== 'classify') throw new Error('Invalid persisted task kind.');
          const [row] = await tx.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id));
          if (!row) throw new Error('Classification task is missing its record.');
          const state = row.state;
          const command = parsePrepareEnrichmentRun({
            snapshotId: row.snapshotId,
            versionId: row.versionId,
            dimensions: row.dimensions,
            replacement: row.replacement,
          });
          if (
            !command || row.kind !== 'classify' || row.snapshotId !== identity.snapshotId ||
            (state !== 'queued' && state !== 'running' && state !== 'completed' &&
              state !== 'completed_with_issues' && state !== 'failed' && state !== 'cancelled')
          ) {
            throw new Error('Invalid persisted classification lifecycle.');
          }
          const progress = await readEnrichmentRunProgress(tx, ctx.tenantId, id, row.snapshotId);
          if (
            (state === 'completed' && progress.counts.classified !== progress.total) ||
            (['completed', 'completed_with_issues', 'failed', 'cancelled'].includes(state) &&
              progress.counts.pending !== 0)
          ) {
            throw new Error('Terminal enrichment state has unreconciled items.');
          }
          return {
            ok: true,
            value: {
              ...identity,
              updatedAt: row.updatedAt.toISOString(),
              kind: 'classify',
              state,
              schemeId: row.schemeId,
              errorCode: row.result !== null && typeof row.result === 'object' &&
                  'code' in row.result && typeof row.result.code === 'string'
                ? row.result.code
                : null,
              command,
              progress,
            },
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      if (!view.ok) return view;
      if (view.value.kind !== 'preview' && view.value.kind !== 'classify') {
        return { ok: true, value: { ...view.value, usage: null } };
      }
      const usage = await new BankEnrichmentUsage(this.database, this.now).summary(ctx, id);
      if (!usage.ok) {
        return { ok: false, code: usage.code === 'forbidden' ? 'forbidden' : 'storage_failed' };
      }
      return { ok: true, value: { ...view.value, usage: usage.value } };
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }
}
