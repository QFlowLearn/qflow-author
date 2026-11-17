import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  organizationAttempts,
  organizationItems,
  organizationRuns,
} from '../db/question_organization_schema.ts';
import { questions } from '../db/question_schema.ts';
import { CLEF_INPUT_TOKEN_LIMIT } from '../ai/clef_organization_provider.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import { loadCurrentEnrichmentChanges } from './bank_enrichment_changes.ts';
import { parseEnrichmentBaseline } from './bank_enrichment_job_contract.ts';
import { parseOrganizationSource } from './question_organization_contract.ts';
import {
  type OrganizationDecision,
  parseOrganizationDecision,
} from './question_organization_decision.ts';
import type { OrganizationRun } from './question_organization_read.ts';
import type { ClaimedItem, OrganizationWorkerServices } from './question_organization_work.ts';

/** Claim a bounded group under one run lock, with shared revision/history reads. */
export async function claimOrganizationBatch(
  context: OrganizationRun,
  questionIds: readonly string[],
  services: OrganizationWorkerServices,
): Promise<readonly ClaimedItem[]> {
  const { database, now, newId } = services;
  return await database.transaction(async (tx) => {
    if (!await authorizeEnrichment(tx, context.ctx, 'manage_content')) return [];
    const [run] = await tx.select().from(organizationRuns).where(
      eq(organizationRuns.id, context.run.id),
    ).for('update');
    if (run.state !== 'queued' || run.executionId !== context.run.executionId) return [];
    const items = await tx.select().from(organizationItems).where(and(
      eq(organizationItems.runId, context.run.id),
      inArray(organizationItems.questionId, questionIds),
    )).orderBy(organizationItems.questionId).for('update');
    const questionRows = await tx.select().from(questions).where(and(
      eq(questions.tenantId, context.ctx.tenantId),
      inArray(questions.id, questionIds),
    ));
    const currentChanges = await loadCurrentEnrichmentChanges(
      tx,
      context.ctx.tenantId,
      context.schemeId,
      questionIds,
    );
    const priorItems = alias(organizationItems, 'prior_items');
    const priors = await tx.selectDistinctOn([priorItems.questionId], {
      questionId: priorItems.questionId,
      decision: priorItems.decision,
    }).from(priorItems).innerJoin(organizationRuns, eq(organizationRuns.id, priorItems.runId))
      .innerJoin(
        organizationItems,
        and(
          eq(organizationItems.runId, context.run.id),
          eq(organizationItems.questionId, priorItems.questionId),
          eq(organizationItems.revisionId, priorItems.revisionId),
          eq(organizationItems.contentHash, priorItems.contentHash),
          sql`${organizationItems.baseline} = ${priorItems.baseline}`,
          sql`${organizationItems.source} IS NOT DISTINCT FROM ${priorItems.source}`,
        ),
      ).where(
        and(
          eq(organizationRuns.setupId, context.setup.id),
          eq(organizationRuns.tenantId, context.ctx.tenantId),
          inArray(priorItems.questionId, questionIds),
          sql`${priorItems.decision} IS NOT NULL`,
          context.policy.classifier.kind === 'clef'
            ? sql`(${priorItems.decision}->>'kind' <> 'clef' OR
              ${priorItems.decision} #>> '{receipt,model}' = ${context.policy.classifier.config.modelVersion})`
            : undefined,
        ),
      ).orderBy(priorItems.questionId);
    const claimed: ClaimedItem[] = [];
    async function claim(item: typeof organizationItems.$inferSelect): Promise<ClaimedItem | null> {
      const questionId = item.questionId;
      const where = and(
        eq(organizationItems.runId, context.run.id),
        eq(organizationItems.questionId, questionId),
      );
      const instant = now();
      if (
        !item || run.state !== 'queued' || run.executionId !== context.run.executionId ||
        !['pending', 'processing', 'received'].includes(item.state) ||
        item.leaseExpiresAt && item.leaseExpiresAt > instant
      ) return null;
      const finish = async (state: string, detail: string | null = null) => {
        await tx.update(organizationItems).set({
          state,
          detail,
          leaseToken: null,
          leaseExpiresAt: null,
        }).where(where);
      };
      const question = questionRows.find((q) => q.id === questionId);
      if (
        !question || question.latestRevisionId !== item.revisionId ||
        question.lifecycleState !== 'active'
      ) {
        await finish('outdated');
        return null;
      }
      const baseline = parseEnrichmentBaseline(item.baseline);
      if (!baseline) throw new Error('Invalid organization baseline.');
      const current = currentChanges.get(questionId);
      if (!current) throw new Error('Missing organization assignment projection.');
      if (
        (current.topic?.changeId ?? null) !== baseline.topic ||
        (current.subject?.changeId ?? null) !== baseline.subject
      ) {
        await finish('protected');
        return null;
      }
      let decision: OrganizationDecision | null = null;
      let reservation = 0;
      if (item.state !== 'received') {
        if (
          [current.topic, current.subject].some((value) =>
            value &&
            (value.revisionId !== item.revisionId || value.versionId !== context.setup.versionId)
          )
        ) {
          decision = { kind: 'protected' };
        } else if (current.topic?.value?.state === 'assigned') {
          const id = current.topic.value.valueIds[0];
          decision = current.topic.value.valueIds.length === 1 &&
              context.definition.topics.some((topic) => topic.id === id)
            ? { kind: 'preserved', topicId: id }
            : { kind: 'protected' };
        } else if (current.topic && current.topic.origin !== 'ai') decision = { kind: 'protected' };
        else {
          const source = item.source === null ? null : parseOrganizationSource(item.source);
          if (item.source !== null && !source) {
            throw new Error('Invalid organization source identity.');
          }
          const mapping = source &&
            context.policy.sourceMappings.find((m) =>
              m.sourceId === source.sourceId && m.sectionKey === source.sectionKey
            );
          if (mapping) decision = { kind: 'source', topicId: mapping.topicId };
          else if (context.policy.classifier.kind === 'source_only') {
            decision = { kind: 'unassigned' };
          }
        }
        if (decision === null) {
          const prior = priors.find((p) => p.questionId === questionId);
          if (prior) {
            decision = parseOrganizationDecision(
              prior.decision,
              context.definition,
              context.policy,
            );
            if (!decision) throw new Error('Invalid prior organization receipt.');
          }
        }
        if (decision === null && context.policy.classifier.kind === 'clef') {
          if (item.attempts >= 3) {
            await finish('failed', 'attempts_exhausted');
            return null;
          }
          const config = context.policy.classifier.config;
          reservation = Math.ceil(
            CLEF_INPUT_TOKEN_LIMIT * config.inputMicrosPerMillion / 1_000_000,
          );
          if (run.reservedMicros + reservation > config.budgetMicros) {
            // Earlier claims in this batch still hold their worst-case reservations.
            // Let their receipts settle before deciding whether this question is affordable.
            if (claimed.some((claim) => claim.reservation > 0)) return null;
            await finish('failed', 'budget_exceeded');
            return null;
          }
          run.reservedMicros += reservation;
        }
      }
      const leaseToken = newId();
      await tx.update(organizationItems).set({
        state: item.state === 'received' ? 'received' : 'processing',
        leaseToken,
        leaseExpiresAt: new Date(instant.getTime() + 180_000),
        attempts: item.attempts + (reservation ? 1 : 0),
      }).where(where);
      return { item, leaseToken, decision, reservation };
    }
    for (const item of items) {
      const result = await claim(item);
      if (result) claimed.push(result);
    }
    const attempts = claimed.filter((c) => c.reservation > 0).map((c) => ({
      id: c.leaseToken,
      tenantId: context.ctx.tenantId,
      runId: context.run.id,
      questionId: c.item.questionId,
      reservedMicros: c.reservation,
      state: 'reserved',
      createdAt: now(),
    }));
    if (attempts.length) {
      await tx.insert(organizationAttempts).values(attempts);
      await tx.update(organizationRuns).set({ reservedMicros: run.reservedMicros }).where(
        eq(organizationRuns.id, run.id),
      );
    }
    return claimed;
  });
}
