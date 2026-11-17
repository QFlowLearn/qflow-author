import { saveCorrectionTeaching } from './bank_enrichment_teaching.ts';
import { and, eq, inArray } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { enrichmentRunItems, enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import { enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import { organizationMemberships } from '../db/principal_schema.ts';
import { questions } from '../db/question_schema.ts';
import { parseRole } from '../roles.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { QflowWorkflowInvocation } from '../workflows/job_workflows.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentResult,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import { loadCurrentEnrichmentChanges } from './bank_enrichment_changes.ts';
import type {
  EnrichmentBatchProgress,
  EnrichmentJobFailure,
} from './bank_enrichment_job_contract.ts';
import { jobStorageFailure } from './bank_enrichment_jobs.ts';
import { applyEnrichmentMutationItems } from './bank_enrichment_mutation_apply.ts';
import { parseEnrichmentMutationConfiguration } from './bank_enrichment_mutation_contract.ts';
import { readEnrichmentRunProgress } from './bank_enrichment_progress.ts';
import { parsePrepareEnrichmentRun } from './bank_enrichment_run_contract.ts';
import { completedCount, executionProgress } from './bank_enrichment_worker_store.ts';

/** One transaction owns at most 20 corrections/restorations; there is no provider call or external lease gap. */
export async function processEnrichmentMutation(
  database: QflowDatabase,
  params: QflowWorkflowInvocation,
  now: Date,
  token: string,
): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> {
  if (![params.jobId, params.workflowExecutionId, token].every(isCanonicalUuid)) {
    return { ok: false, code: 'invalid_input' };
  }
  try {
    return await database.transaction(
      async (tx): Promise<EnrichmentResult<EnrichmentBatchProgress, EnrichmentJobFailure>> => {
        const [identity] = await tx.select({
          task: enrichmentTasks,
          actorId: enrichmentRuns.createdBy,
        }).from(enrichmentTasks)
          .innerJoin(
            enrichmentRuns,
            and(
              eq(enrichmentRuns.id, enrichmentTasks.id),
              eq(enrichmentRuns.tenantId, enrichmentTasks.tenantId),
            ),
          )
          .where(eq(enrichmentTasks.id, params.jobId));
        if (!identity) return { ok: false, code: 'not_found' };
        if (
          (identity.task.kind !== 'correct' && identity.task.kind !== 'undo') ||
          identity.task.budgetId !== null
        ) {
          throw new Error('Invalid enrichment mutation task.');
        }
        const [member] = await tx.select({ role: organizationMemberships.role }).from(
          organizationMemberships,
        ).where(and(
          eq(organizationMemberships.tenantId, identity.task.tenantId),
          eq(organizationMemberships.userId, identity.actorId),
        ));
        const role = parseRole(member?.role);
        if (
          !role ||
          !await authorizeEnrichment(tx, {
            tenantId: identity.task.tenantId,
            userId: identity.actorId,
            role,
          }, 'manage_content')
        ) {
          return { ok: false, code: 'forbidden' };
        }
        const [run] = await tx.select().from(enrichmentRuns).where(
          eq(enrichmentRuns.id, params.jobId),
        ).for('update');
        if (run.kind !== identity.task.kind) throw new Error('Enrichment mutation kind mismatch.');
        const progress = executionProgress(
          run,
          params.workflowExecutionId,
          now,
          await completedCount(tx, run.id),
        );
        if (progress) return { ok: true, value: progress };
        const [version] = await tx.select().from(enrichmentSchemeVersions).where(and(
          eq(enrichmentSchemeVersions.id, run.versionId),
          eq(enrichmentSchemeVersions.tenantId, run.tenantId),
          eq(enrichmentSchemeVersions.schemeId, run.schemeId),
        ));
        const definition = parseEnrichmentDefinition(version?.definition);
        const configuration = definition &&
          parseEnrichmentMutationConfiguration(run.configuration, definition);
        const command = parsePrepareEnrichmentRun({
          snapshotId: run.snapshotId,
          versionId: run.versionId,
          dimensions: run.dimensions,
          replacement: run.replacement,
        });
        if (
          !definition || !configuration || configuration.kind !== run.kind || !command ||
          (configuration.kind === 'correct' &&
            command.dimensions.join(',') !==
              ENRICHMENT_DIMENSIONS.filter((d) => configuration.values[d] !== null).join(','))
        ) {
          throw new Error('Invalid stored enrichment mutation input.');
        }
        const items = await tx.select().from(enrichmentRunItems).where(
          and(eq(enrichmentRunItems.runId, run.id), eq(enrichmentRunItems.state, 'pending')),
        )
          .orderBy(enrichmentRunItems.questionId).limit(20);
        if (!items.length) {
          if (command.dimensions.includes('topic')) {
            await saveCorrectionTeaching(tx, run, definition, now);
          }
          const result = await readEnrichmentRunProgress(tx, run.tenantId, run.id, run.snapshotId);
          await tx.update(enrichmentRuns).set({
            state: result.counts.classified === result.total
              ? 'completed'
              : 'completed_with_issues',
            result: { counts: result.counts },
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: now,
          }).where(eq(enrichmentRuns.id, run.id));
          return { ok: true, value: { state: 'completed', completed: result.completed } };
        }
        const ids = items.map((item) => item.questionId);
        const latest = await tx.select({ id: questions.id, revisionId: questions.latestRevisionId })
          .from(questions).where(and(
            eq(questions.tenantId, run.tenantId),
            inArray(questions.id, ids),
          )).orderBy(questions.id).for('update');
        const current = await loadCurrentEnrichmentChanges(tx, run.tenantId, run.schemeId, ids);
        await applyEnrichmentMutationItems(
          tx,
          run,
          configuration,
          definition,
          items,
          current,
          new Map(latest.map((q) => [q.id, q.revisionId])),
          now,
        );
        // The row lock owns this whole step; its expired lease lets the next step proceed immediately.
        await tx.update(enrichmentRuns).set({
          state: 'running',
          leaseToken: token,
          leaseExpiresAt: now,
          updatedAt: now,
        }).where(eq(enrichmentRuns.id, run.id));
        return { ok: true, value: { state: 'more', completed: await completedCount(tx, run.id) } };
      },
    );
  } catch (cause: unknown) {
    return jobStorageFailure(cause);
  }
}
