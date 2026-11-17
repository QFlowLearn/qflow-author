import { and, eq } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { enrichmentRunItems, enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentAssignments, enrichmentChanges } from '../db/bank_enrichment_schema.ts';
import { uuidV5 } from '../uuid_v5.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDefinition,
  type EnrichmentDimension,
} from './bank_enrichment_contract.ts';
import { type EnrichmentCurrentChanges, loadEnrichmentChanges } from './bank_enrichment_changes.ts';
import { planEnrichmentCorrection } from './bank_enrichment_correction_policy.ts';
import { parseEnrichmentBaseline } from './bank_enrichment_job_contract.ts';
import type { EnrichmentMutationConfiguration } from './bank_enrichment_mutation_contract.ts';
import {
  type EnrichmentRestoration,
  type EnrichmentUndoTargets,
  planEnrichmentUndo,
} from './bank_enrichment_undo_policy.ts';
import type { EnrichmentProtection } from './bank_enrichment_apply_policy.ts';

type MutationPlan = {
  readonly writes: Readonly<Partial<Record<EnrichmentDimension, EnrichmentRestoration>>>;
  readonly protected: Readonly<Partial<Record<EnrichmentDimension, EnrichmentProtection>>>;
};

/** Apply bounded human changes inside the caller's authorized, locked transaction. */
export async function applyEnrichmentMutationItems(
  tx: QflowDatabaseTransaction,
  run: typeof enrichmentRuns.$inferSelect,
  configuration: EnrichmentMutationConfiguration,
  definition: EnrichmentDefinition,
  items: readonly (typeof enrichmentRunItems.$inferSelect)[],
  current: ReadonlyMap<string, EnrichmentCurrentChanges>,
  latest: ReadonlyMap<string, string | null>,
  now: Date,
): Promise<void> {
  const baselines = items.map((item) => {
    const baseline = parseEnrichmentBaseline(item.baseline);
    if (!baseline) throw new Error('Invalid enrichment mutation baseline.');
    return baseline;
  });
  const written = await loadEnrichmentChanges(
    tx,
    run.tenantId,
    run.schemeId,
    configuration.kind === 'undo'
      ? baselines.flatMap((b) => Object.values(b).filter((id) => id !== null))
      : [],
  );
  const predecessors = await loadEnrichmentChanges(
    tx,
    run.tenantId,
    run.schemeId,
    [...written.values()].flatMap((c) => c.previousChangeId ? [c.previousChangeId] : []),
  );
  const changes: typeof enrichmentChanges.$inferInsert[] = [];
  const assignments: typeof enrichmentAssignments.$inferInsert[] = [];
  for (const [index, item] of items.entries()) {
    const values = current.get(item.questionId);
    if (!values) throw new Error('Missing enrichment mutation current values.');
    if (configuration.kind === 'correct' && latest.get(item.questionId) !== item.revisionId) {
      await outcome(tx, run.id, item.questionId, 'outdated', { code: 'source_revision_changed' });
      continue;
    }
    let plan: MutationPlan;
    if (configuration.kind === 'correct') {
      const correction = planEnrichmentCorrection({
        values: configuration.values,
        definition,
        current: values,
        baseline: baselines[index],
      });
      const writes: Partial<Record<EnrichmentDimension, EnrichmentRestoration>> = {};
      for (const dimension of ENRICHMENT_DIMENSIONS) {
        const value = correction.writes[dimension];
        if (value) {
          writes[dimension] = {
            value,
            revisionId: item.revisionId,
            versionId: run.versionId,
            definition,
          };
        }
      }
      plan = { writes, protected: correction.protected };
    } else {
      const targets: { -readonly [D in keyof EnrichmentUndoTargets]: EnrichmentUndoTargets[D] } = {
        subject: null,
        topic: null,
        difficulty: null,
      };
      for (const dimension of ENRICHMENT_DIMENSIONS) {
        const id = baselines[index][dimension];
        if (id === null) continue;
        const source = written.get(id);
        if (
          !source || source.operationId !== run.sourceRunId ||
          source.questionId !== item.questionId || source.dimension !== dimension
        ) {
          throw new Error('Invalid enrichment undo source change.');
        }
        const previous = source.previousChangeId ? predecessors.get(source.previousChangeId) : null;
        if (
          previous === undefined ||
          previous && (previous.questionId !== item.questionId || previous.dimension !== dimension)
        ) {
          throw new Error('Invalid enrichment undo predecessor.');
        }
        targets[dimension] = { written: source, previous };
      }
      plan = planEnrichmentUndo(values, targets);
    }
    for (const dimension of ENRICHMENT_DIMENSIONS) {
      const write = plan.writes[dimension];
      if (!write) continue;
      const id = await uuidV5(run.id, `${configuration.kind}:${item.questionId}:${dimension}`);
      changes.push({
        id,
        tenantId: run.tenantId,
        schemeId: run.schemeId,
        versionId: write.versionId,
        questionId: item.questionId,
        revisionId: write.revisionId,
        dimension,
        value: write.value,
        origin: configuration.kind === 'correct' ? 'human' : 'undo',
        operationId: run.id,
        previousChangeId: values[dimension]?.changeId ?? null,
        createdBy: run.createdBy,
        createdAt: now,
      });
      assignments.push({
        tenantId: run.tenantId,
        schemeId: run.schemeId,
        questionId: item.questionId,
        dimension,
        changeId: id,
      });
    }
    const writtenDimensions = Object.keys(plan.writes);
    await outcome(
      tx,
      run.id,
      item.questionId,
      Object.keys(plan.protected).length ? 'protected' : 'classified',
      {
        written: writtenDimensions,
        protected: plan.protected,
        ...(writtenDimensions.length ? {} : { code: 'no_changes' }),
      },
    );
  }
  if (!changes.length) return;
  await tx.insert(enrichmentChanges).values(changes);
  for (const assignment of assignments) {
    await tx.insert(enrichmentAssignments).values(assignment).onConflictDoUpdate({
      target: [
        enrichmentAssignments.tenantId,
        enrichmentAssignments.schemeId,
        enrichmentAssignments.questionId,
        enrichmentAssignments.dimension,
      ],
      set: { changeId: assignment.changeId },
    });
  }
}

async function outcome(
  tx: QflowDatabaseTransaction,
  runId: string,
  questionId: string,
  state: string,
  detail: unknown,
): Promise<void> {
  await tx.update(enrichmentRunItems).set({ state, detail }).where(
    and(eq(enrichmentRunItems.runId, runId), eq(enrichmentRunItems.questionId, questionId)),
  );
}
