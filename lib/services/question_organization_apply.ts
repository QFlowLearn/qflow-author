import { and, eq, inArray, sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { enrichmentAssignments, enrichmentChanges } from '../db/bank_enrichment_schema.ts';
import { organizationItems, organizationRuns } from '../db/question_organization_schema.ts';
import { questions } from '../db/question_schema.ts';
import { uuidV5 } from '../uuid_v5.ts';
import {
  type EnrichmentCurrentChanges,
  loadCurrentEnrichmentChanges,
} from './bank_enrichment_changes.ts';
import { parseEnrichmentBaseline } from './bank_enrichment_job_contract.ts';
import { organizationTopic, parseOrganizationDecision } from './question_organization_decision.ts';
import type { OrganizationRun } from './question_organization_read.ts';
import type { EnrichmentTopic } from './bank_enrichment_contract.ts';
import { fileOrganizationQuestions } from './question_organization_filing.ts';

/** Apply a bounded group after receipts commit, sharing current question/history reads. */
export async function applyOrganizationItems(
  tx: QflowDatabaseTransaction,
  context: OrganizationRun,
  claims: readonly { readonly questionId: string; readonly leaseToken: string }[],
  now: Date,
): Promise<void> {
  if (!claims.length) return;
  const [run] = await tx.select().from(organizationRuns).where(
    eq(organizationRuns.id, context.run.id),
  ).for('update');
  if (run?.state !== 'queued' || run.executionId !== context.run.executionId) return;
  const ids = claims.map((c) => c.questionId);
  const items = await tx.select().from(organizationItems).where(
    and(eq(organizationItems.runId, context.run.id), inArray(organizationItems.questionId, ids)),
  ).orderBy(organizationItems.questionId).for('update');
  const questionRows = await tx.select().from(questions).where(
    and(eq(questions.tenantId, context.ctx.tenantId), inArray(questions.id, ids)),
  ).orderBy(questions.id).for('update');
  const changes = await loadCurrentEnrichmentChanges(
    tx,
    context.ctx.tenantId,
    context.schemeId,
    ids,
  );
  const history: (typeof enrichmentChanges.$inferInsert)[] = [];
  const assignments: (typeof enrichmentAssignments.$inferInsert)[] = [];
  const filing: { questionId: string; collectionId: string }[] = [];
  const finished = new Map<Application['state'], string[]>();
  for (const item of items) {
    const claim = claims.find((c) => c.questionId === item.questionId);
    const current = changes.get(item.questionId);
    if (!claim || !current) throw new Error('Organization application input is missing.');
    const application = planApplication(
      context,
      run.mode,
      item,
      questionRows.find((q) => q.id === item.questionId),
      current,
      claim.leaseToken,
      now,
    );
    if (!application) continue;
    const group = finished.get(application.state) ?? [];
    group.push(item.questionId);
    finished.set(application.state, group);
    if (application.state !== 'applied') continue;
    if (application.origin !== null) {
      for (const dimension of ['subject', 'topic'] as const) {
        if (dimension === 'subject' && current.subject) continue;
        const id = await uuidV5(context.run.id, `${item.questionId}:${dimension}`);
        history.push({
          id,
          tenantId: context.ctx.tenantId,
          questionId: item.questionId,
          revisionId: item.revisionId,
          schemeId: context.schemeId,
          versionId: context.setup.versionId,
          dimension,
          value: {
            state: 'assigned',
            valueIds: [
              dimension === 'topic' ? application.topic.id : application.topic.subjectId,
            ],
          },
          origin: application.origin,
          operationId: context.run.id,
          previousChangeId: current[dimension]?.changeId ?? null,
          createdBy: context.ctx.userId,
          createdAt: now,
        });
        assignments.push({
          tenantId: context.ctx.tenantId,
          schemeId: context.schemeId,
          questionId: item.questionId,
          dimension,
          changeId: id,
        });
      }
    }
    const collectionId = context.policy.filing.find((f) => f.topicId === application.topic.id)
      ?.collectionId;
    if (collectionId) filing.push({ questionId: item.questionId, collectionId });
  }
  // History precedes current pointers; filing and final states share this transaction.
  if (history.length) {
    await tx.insert(enrichmentChanges).values(history);
    await tx.insert(enrichmentAssignments).values(assignments).onConflictDoUpdate({
      target: [
        enrichmentAssignments.tenantId,
        enrichmentAssignments.schemeId,
        enrichmentAssignments.questionId,
        enrichmentAssignments.dimension,
      ],
      set: { changeId: sql`excluded.change_id` },
    });
  }
  await fileOrganizationQuestions(tx, context, filing, now);
  for (const [state, questionIds] of finished) {
    await tx.update(organizationItems).set({ state, leaseToken: null, leaseExpiresAt: null }).where(
      and(
        eq(organizationItems.runId, context.run.id),
        inArray(organizationItems.questionId, questionIds),
      ),
    );
  }
}

type Application =
  | { readonly state: 'outdated' | 'protected' | 'unsupported' | 'unassigned' | 'previewed' }
  | {
    readonly state: 'applied';
    readonly topic: EnrichmentTopic;
    readonly origin: 'ai' | 'source' | null;
  };

function planApplication(
  context: OrganizationRun,
  mode: 'preview' | 'apply',
  item: typeof organizationItems.$inferSelect,
  question: typeof questions.$inferSelect | undefined,
  current: EnrichmentCurrentChanges,
  leaseToken: string,
  now: Date,
): Application | null {
  if (
    item.state !== 'received' || item.leaseToken !== leaseToken ||
    !item.leaseExpiresAt || item.leaseExpiresAt <= now
  ) return null;
  if (
    !question || question.latestRevisionId !== item.revisionId ||
    question.lifecycleState !== 'active'
  ) {
    return { state: 'outdated' };
  }
  const decision = parseOrganizationDecision(item.decision, context.definition, context.policy);
  const baseline = parseEnrichmentBaseline(item.baseline);
  if (!decision || !baseline) throw new Error('Invalid persisted organization receipt.');
  if (
    (current.topic?.changeId ?? null) !== baseline.topic ||
    (current.subject?.changeId ?? null) !== baseline.subject
  ) {
    return { state: 'protected' };
  }
  const topicId = organizationTopic(decision);
  if (!topicId) {
    return {
      state: decision.kind === 'unsupported'
        ? 'unsupported'
        : decision.kind === 'protected'
        ? 'protected'
        : 'unassigned',
    };
  }
  const topic = context.definition.topics.find((topic) => topic.id === topicId);
  if (!topic) throw new Error('Receipt topic is outside the producing vocabulary.');
  if (decision.kind !== 'preserved') {
    if (
      current.topic && (current.topic.origin !== 'ai' || current.topic.value?.state === 'assigned')
    ) {
      return { state: 'protected' };
    }
    if (
      current.subject &&
      (current.subject.value?.state !== 'assigned' ||
        current.subject.value.valueIds[0] !== topic.subjectId)
    ) {
      return { state: 'protected' };
    }
  }
  if (mode === 'preview') return { state: 'previewed' };
  return {
    state: 'applied',
    topic,
    origin: decision.kind === 'preserved' ? null : decision.kind === 'source' ? 'source' : 'ai',
  };
}
