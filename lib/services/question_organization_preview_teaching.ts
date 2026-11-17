import { loadOrganizationReview } from './organization_preview_sample.ts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { bankCollections } from '../db/bank_schema.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import {
  organizationItems,
  organizationRuns,
  organizationSetups,
} from '../db/question_organization_schema.ts';
import { questions } from '../db/question_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { uuidV5 } from '../uuid_v5.ts';
import type { RequestContext } from '../tenants.ts';
import { isEnrichmentRecord } from '../ai/bank_enrichment_config.ts';
import { clefTeachingExamplesFit } from '../ai/clef_organization_provider.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import { loadCurrentEnrichmentChanges } from './bank_enrichment_changes.ts';
import {
  type EnrichmentDefinition,
  type EnrichmentResult,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import { loadEnrichmentSources } from './bank_enrichment_sources.ts';
import type { EnrichmentQuestion } from './bank_enrichment_input.ts';
import type { OrganizationFailure } from './question_organization_contract.ts';
import { parseOrganizationDecision } from './question_organization_decision.ts';
import { loadOrganizationRun } from './question_organization_read.ts';
import { queueOrganizationInTransaction } from './question_organization_store.ts';

/** Explicit lessons from a completed preview; untouched predictions are never accepted implicitly. */
export type PreviewTeachingCommand = {
  readonly operationId: string;
  readonly corrections: readonly {
    readonly questionId: string;
    readonly revisionId: string;
    readonly topicId: string;
  }[];
};

/** Reject incomplete, duplicate or unbounded correction requests at the HTTP boundary. */
export function parsePreviewTeachingCommand(raw: unknown): PreviewTeachingCommand | null {
  if (
    !isEnrichmentRecord(raw) || Object.keys(raw).sort().join(',') !== 'corrections,operationId' ||
    !isCanonicalUuid(raw.operationId) || !Array.isArray(raw.corrections) ||
    raw.corrections.length < 1 || raw.corrections.length > 20
  ) return null;
  const corrections: PreviewTeachingCommand['corrections'][number][] = [];
  for (const entry of raw.corrections) {
    if (
      !isEnrichmentRecord(entry) ||
      Object.keys(entry).sort().join(',') !== 'questionId,revisionId,topicId' ||
      !isCanonicalUuid(entry.questionId) || !isCanonicalUuid(entry.revisionId) ||
      typeof entry.topicId !== 'string' || !entry.topicId.length || entry.topicId.length > 100
    ) return null;
    corrections.push({
      questionId: entry.questionId,
      revisionId: entry.revisionId,
      topicId: entry.topicId,
    });
  }
  if (new Set(corrections.map((c) => c.questionId)).size !== corrections.length) return null;
  return {
    operationId: raw.operationId,
    corrections: corrections.sort((a, b) => a.questionId.localeCompare(b.questionId)),
  };
}

/** Save only candidate teaching and queue a new preview atomically. Assignments and activation never change. */
export async function teachOrganizationPreview(
  database: QflowDatabase,
  ctx: RequestContext,
  runId: string,
  command: PreviewTeachingCommand,
  now: Date,
): Promise<EnrichmentResult<string, OrganizationFailure | 'input_too_large'>> {
  if (!isCanonicalUuid(runId)) return { ok: false, code: 'invalid_input' };
  try {
    return await database.transaction(
      async (tx): Promise<EnrichmentResult<string, OrganizationFailure | 'input_too_large'>> => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' };
        }
        const [run] = await tx.select().from(organizationRuns).where(
          and(eq(organizationRuns.id, runId), eq(organizationRuns.tenantId, ctx.tenantId)),
        );
        const context = run &&
          await loadOrganizationRun(tx, run.id, run.executionId, { kind: 'request', ctx });
        if (!context) return { ok: false, code: 'not_found' };
        if (
          run.mode !== 'preview' || run.state !== 'completed' ||
          context.policy.classifier.kind !== 'clef'
        ) return { ok: false, code: 'conflict' };
        const samples = await tx.select().from(organizationItems).where(
          eq(organizationItems.runId, runId),
        );
        const review = await loadOrganizationReview(tx, context);
        const additions: EnrichmentDefinition['examples'][number][] = [];
        for (const correction of command.corrections) {
          const sample = samples.find((s) =>
            s.questionId === correction.questionId && s.revisionId === correction.revisionId
          );
          const topic = context.definition.topics.find((t) => t.id === correction.topicId);
          const decision = sample &&
            parseOrganizationDecision(sample.decision, context.definition, context.policy);
          if (
            !sample || !review.some((r) => r.questionId === sample.questionId) || !topic ||
            decision?.kind !== 'clef' ||
            !['previewed', 'unassigned'].includes(sample.state)
          ) return { ok: false, code: 'invalid_input' };
          additions.push({
            questionId: correction.questionId,
            revisionId: correction.revisionId,
            classification: {
              subject: { state: 'assigned', valueIds: [topic.subjectId] },
              topic: { state: 'assigned', valueIds: [topic.id] },
              difficulty: null,
            },
          });
        }
        const retained = context.definition.examples.filter((e) =>
          !additions.some((a) => a.questionId === e.questionId)
        );
        const proposed = [...additions, ...retained];
        const sources = new Map<string, EnrichmentQuestion>();
        for (let offset = 0; offset < proposed.length; offset += 20) {
          for (
            const source of await loadEnrichmentSources(
              tx,
              ctx.tenantId,
              proposed.slice(offset, offset + 20),
            )
          ) {
            if (source.content.ok) sources.set(source.revisionId, source.content.value);
          }
        }
        const examples: EnrichmentDefinition['examples'][number][] = [];
        const teaching: { question: EnrichmentQuestion; topicId: string }[] = [];
        for (const example of proposed) {
          const topic = example.classification.topic;
          const source = sources.get(example.revisionId);
          if (examples.length === 20) break;
          if (topic?.state === 'assigned' && topic.valueIds.length === 1) {
            if (
              !source ||
              !clefTeachingExamplesFit(context.definition, [...teaching, {
                question: source,
                topicId: topic.valueIds[0],
              }])
            ) {
              // Never silently discard an instructor's submitted correction to fit the input limit.
              if (additions.includes(example)) return { ok: false, code: 'input_too_large' };
              continue;
            }
            teaching.push({ question: source, topicId: topic.valueIds[0] });
          }
          examples.push(example);
        }
        const definition = parseEnrichmentDefinition({
          ...context.definition,
          examples,
          replacements: [],
        });
        if (!definition) return { ok: false, code: 'invalid_input' };
        const versionId = await uuidV5(command.operationId, `preview-teaching:${runId}`);
        const setupId = await uuidV5(command.operationId, `preview-setup:${runId}`);
        const policy = { ...context.policy, versionId };
        const [existing] = await tx.select().from(organizationRuns).where(
          eq(organizationRuns.id, command.operationId),
        );
        if (existing) {
          const saved = await loadOrganizationRun(tx, existing.id, existing.executionId, {
            kind: 'request',
            ctx,
          });
          return saved && existing.createdBy === ctx.userId && existing.mode === 'preview' &&
              saved.setup.id === setupId && saved.setup.versionId === versionId &&
              canonicalJsonStringify(saved.definition) === canonicalJsonStringify(definition) &&
              canonicalJsonStringify(saved.policy) === canonicalJsonStringify(policy)
            ? { ok: true, value: existing.id }
            : { ok: false, code: 'conflict' };
        }
        const [collection] = await tx.select().from(bankCollections).where(
          and(
            eq(bankCollections.id, context.setup.collectionId),
            isNull(bankCollections.archivedAt),
          ),
        );
        const [latestSetup] = await tx.select().from(organizationSetups).where(
          eq(organizationSetups.collectionId, context.setup.collectionId),
        ).orderBy(desc(organizationSetups.version)).limit(1);
        const [latestVersion] = await tx.select().from(enrichmentSchemeVersions).where(
          and(
            eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
            eq(enrichmentSchemeVersions.schemeId, context.schemeId),
          ),
        ).orderBy(desc(enrichmentSchemeVersions.version)).limit(1);
        if (
          !collection || latestSetup?.id !== context.setup.id ||
          latestVersion?.id !== context.setup.versionId
        ) return { ok: false, code: 'conflict' };
        // A changed revision or classification makes the displayed prediction stale.
        const current = await loadCurrentEnrichmentChanges(
          tx,
          ctx.tenantId,
          context.schemeId,
          command.corrections.map((c) => c.questionId),
        );
        for (const correction of command.corrections) {
          const [question] = await tx.select().from(questions).where(
            and(eq(questions.id, correction.questionId), eq(questions.tenantId, ctx.tenantId)),
          );
          const sample = samples.find((s) => s.questionId === correction.questionId);
          const values = current.get(correction.questionId);
          if (
            !question || question.latestRevisionId !== correction.revisionId ||
            question.lifecycleState !== 'active' || !sample || !values ||
            canonicalJsonStringify(sample.baseline) !==
              canonicalJsonStringify({
                subject: values.subject?.changeId ?? null,
                topic: values.topic?.changeId ?? null,
                difficulty: values.difficulty?.changeId ?? null,
              })
          ) return { ok: false, code: 'conflict' };
        }
        await tx.insert(enrichmentSchemeVersions).values({
          id: versionId,
          tenantId: ctx.tenantId,
          schemeId: context.schemeId,
          version: latestVersion.version + 1,
          definition,
          createdBy: ctx.userId,
          createdAt: now,
        });
        await tx.insert(organizationSetups).values({
          id: setupId,
          tenantId: ctx.tenantId,
          collectionId: context.setup.collectionId,
          version: latestSetup.version + 1,
          versionId,
          policy,
          createdBy: ctx.userId,
          createdAt: now,
        });
        const queued = await queueOrganizationInTransaction(tx, ctx, {
          id: command.operationId,
          setupId,
          mode: 'preview',
          questionIds: samples.map((s) => s.questionId),
        }, now);
        // The entire write must roll back if the frozen sample is no longer queueable.
        if (!queued.ok) throw new PreviewScopeChanged();
        return queued;
      },
    );
  } catch (cause: unknown) {
    if (cause instanceof PreviewScopeChanged) return { ok: false, code: 'conflict' };
    console.error('Preview teaching failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

// The database adapter requires an exception to roll back both candidate versions and the outbox.
// Translate it back to the public typed conflict channel at this transaction boundary.
class PreviewScopeChanged extends Error {}
