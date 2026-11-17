import { ORGANIZATION_QUESTION_LIMIT } from '../organization_limits.ts';
import { loadOrganizationRecovery } from './question_organization_resume.ts';
import { selectOrganizationPreviewPool } from '../organization_preview_sample.ts';
import { loadOrganizationReview, organizationSampleSource } from './organization_preview_sample.ts';
import { prepareEnrichmentQuestion } from './bank_enrichment_input.ts';
import { sanitizeBodyHtml } from '../sanitize.ts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { bankCollectionItems, bankCollections } from '../db/bank_schema.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import {
  organizationActivation,
  organizationItems,
  organizationOrigins,
  organizationRuns,
  organizationSetups,
} from '../db/question_organization_schema.ts';
import { questionRevisions, questions } from '../db/question_schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { RequestContext } from '../tenants.ts';
import type { OrganizationFailure, OrganizationSetup } from './question_organization_contract.ts';
import { loadOrganizationSections } from './question_organization_sources.ts';
import { authorizeEnrichment, canReadEnrichment } from './bank_enrichment_access.ts';
import { parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import { parseOrganizationSetup } from './question_organization_contract.ts';
import { BankEnrichmentStore } from './bank_enrichment_store.ts';
import {
  queueOrganizationInTransaction,
  saveOrganizationSetup,
} from './question_organization_store.ts';
import { organizationTopic, parseOrganizationDecision } from './question_organization_decision.ts';
import { loadOrganizationRun } from './question_organization_read.ts';

type PreviewInput = {
  operationId: string;
  collectionId: string;
  expectedVersion: number;
  definition: unknown;
  filing: unknown;
  sourceMappings: unknown;
};

type PreviewFailure =
  | OrganizationFailure
  | 'operation_conflict'
  | 'version_conflict'
  | 'empty_scope'
  | 'scope_too_large';
class PreviewRejected extends Error {
  constructor(readonly result: { readonly ok: false; readonly code: PreviewFailure }) {
    super('Organization preview was not queued');
  }
}

/** Screen-facing operations for the collection organization flow. */
export class QuestionOrganizationWorkspace {
  constructor(
    private readonly database: QflowDatabase | QflowDatabaseTransaction,
    private readonly now: () => Date,
  ) {}

  /** Read saved candidates separately from the explicitly active version. */
  async home(ctx: RequestContext) {
    try {
      return await this.database.transaction(async (tx) => {
        if (!await canReadEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const collections = await tx.select({ id: bankCollections.id, name: bankCollections.name })
          .from(bankCollections).where(
            and(eq(bankCollections.tenantId, ctx.tenantId), isNull(bankCollections.archivedAt)),
          ).orderBy(bankCollections.position);
        const rows = await tx.select({
          setup: organizationSetups,
          version: enrichmentSchemeVersions,
        }).from(organizationSetups).innerJoin(
          enrichmentSchemeVersions,
          eq(enrichmentSchemeVersions.id, organizationSetups.versionId),
        ).where(
          and(
            eq(organizationSetups.tenantId, ctx.tenantId),
            sql`NOT EXISTS (SELECT 1 FROM question_organization_setups newer WHERE newer.collection_id = ${organizationSetups.collectionId} AND newer.version > ${organizationSetups.version})`,
          ),
        );
        const setups = rows.map(({ setup, version }) => {
          const definition = parseEnrichmentDefinition(version.definition);
          const policy = definition && parseOrganizationSetup(setup.policy, definition);
          if (!definition || !policy) throw new Error('Invalid saved organization setup');
          return {
            id: setup.id,
            collectionId: setup.collectionId,
            version: setup.version,
            definition,
            policy,
          };
        });
        const activation = await tx.select({
          collectionId: organizationActivation.collectionId,
          setupId: organizationActivation.setupId,
          revision: organizationActivation.revision,
        }).from(organizationActivation).where(eq(organizationActivation.tenantId, ctx.tenantId));
        const recent = await tx.select({
          id: organizationRuns.id,
          mode: organizationRuns.mode,
          state: organizationRuns.state,
          name: bankCollections.name,
        }).from(organizationRuns).innerJoin(
          organizationSetups,
          eq(organizationSetups.id, organizationRuns.setupId),
        ).innerJoin(bankCollections, eq(bankCollections.id, organizationSetups.collectionId)).where(
          eq(organizationRuns.tenantId, ctx.tenantId),
        ).orderBy(desc(organizationRuns.createdAt)).limit(20);
        const sources = await loadOrganizationSections(tx, ctx.tenantId);
        return { ok: true, value: { collections, setups, activation, recent, sources } } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (cause) {
      console.error('Organization workspace read failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' } as const;
    }
  }

  /** Freeze candidate rules and up to one hundred questions. No automatic activation occurs. */
  async preview(
    ctx: RequestContext,
    input: PreviewInput,
    classifier: OrganizationSetup['classifier'],
  ) {
    try {
      return await this.database.transaction(async (tx) => {
        const result = await new QuestionOrganizationWorkspace(tx, this.now)
          .saveAndQueuePreview(ctx, input, classifier);
        if (!result.ok) throw new PreviewRejected(result);
        return result;
      });
    } catch (cause) {
      if (cause instanceof PreviewRejected) return cause.result;
      console.error('Organization preview transaction failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' } as const;
    }
  }

  private async saveAndQueuePreview(
    ctx: RequestContext,
    input: PreviewInput,
    classifier: OrganizationSetup['classifier'],
  ) {
    if (
      ![input.operationId, input.collectionId].every(isCanonicalUuid) ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
    ) return { ok: false, code: 'invalid_input' } as const;
    const definition = parseEnrichmentDefinition(input.definition);
    if (!definition) return { ok: false, code: 'invalid_input' } as const;
    const candidate = parseOrganizationSetup({
      versionId: input.operationId,
      classifier,
      filing: input.filing,
      sourceMappings: input.sourceMappings,
    }, definition);
    if (!candidate) return { ok: false, code: 'invalid_input' } as const;
    try {
      const home = await this.home(ctx);
      if (!home.ok) return home;
      if (!home.value.collections.some((c) => c.id === input.collectionId)) {
        return { ok: false, code: 'not_found' } as const;
      }
      const setupId = await uuidV5(input.operationId, 'setup');
      const saved = home.value.setups.find((s) => s.collectionId === input.collectionId);
      // Retry of a completed preview must reuse its frozen input, not advance a version.
      const [existing] = await this.database.select().from(organizationSetups).where(
        and(eq(organizationSetups.id, setupId), eq(organizationSetups.tenantId, ctx.tenantId)),
      );
      let versionId: string;
      if (existing) versionId = existing.versionId;
      else if (
        saved && canonicalJsonStringify(saved.definition) === canonicalJsonStringify(definition)
      ) versionId = saved.policy.versionId;
      else {
        if ((saved?.version ?? 0) !== input.expectedVersion) {
          return { ok: false, code: 'conflict' } as const;
        }
        const base = saved
          ? await new BankEnrichmentStore(this.database, this.now).getVersion(
            ctx,
            saved.policy.versionId,
          )
          : null;
        if (base && !base.ok) return base;
        const version = await new BankEnrichmentStore(this.database, this.now).saveVersion(ctx, {
          id: await uuidV5(input.operationId, 'vocabulary'),
          schemeId: base?.ok ? base.value.schemeId : await uuidV5(input.operationId, 'scheme'),
          expectedVersion: base?.ok ? base.value.version : 0,
          definition,
        });
        if (!version.ok) return version;
        versionId = version.value.id;
      }
      if (existing) {
        const version = await new BankEnrichmentStore(this.database, this.now).getVersion(
          ctx,
          versionId,
        );
        if (!version.ok) return version;
        if (
          canonicalJsonStringify(version.value.definition) !== canonicalJsonStringify(definition)
        ) return { ok: false, code: 'conflict' } as const;
      }
      const policy = { ...candidate, versionId };
      const savedResult = await saveOrganizationSetup(this.database, ctx, {
        id: setupId,
        collectionId: input.collectionId,
        expectedVersion: input.expectedVersion,
        policy,
      }, this.now());
      if (!savedResult.ok) return savedResult;
      return await this.queue(ctx, { id: input.operationId, setupId, mode: 'preview' });
    } catch (cause) {
      console.error('Organization preview failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' } as const;
    }
  }

  /** Queue current published questions; retries return the original captured scope. */
  async queue(
    ctx: RequestContext,
    input: { id: string; setupId: string; mode: 'preview' | 'apply' },
  ) {
    if (![input.id, input.setupId].every(isCanonicalUuid)) {
      return { ok: false, code: 'invalid_input' } as const;
    }
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [setup] = await tx.select().from(organizationSetups).innerJoin(
          bankCollections,
          and(
            eq(bankCollections.id, organizationSetups.collectionId),
            isNull(bankCollections.archivedAt),
          ),
        ).where(
          and(
            eq(organizationSetups.id, input.setupId),
            eq(organizationSetups.tenantId, ctx.tenantId),
          ),
        );
        if (!setup) return { ok: false, code: 'not_found' } as const;
        const [existing] = await tx.select().from(organizationRuns).where(
          eq(organizationRuns.id, input.id),
        );
        if (existing) {
          return existing.tenantId === ctx.tenantId && existing.createdBy === ctx.userId &&
              existing.setupId === input.setupId && existing.mode === input.mode
            ? { ok: true, value: existing.id } as const
            : { ok: false, code: 'conflict' } as const;
        }
        if (input.mode === 'apply') {
          const [latest] = await tx.select({ id: organizationSetups.id }).from(organizationSetups)
            .where(
              eq(organizationSetups.collectionId, setup.question_organization_setups.collectionId),
            )
            .orderBy(desc(organizationSetups.version)).limit(1);
          if (latest?.id !== input.setupId) return { ok: false, code: 'conflict' } as const;
        }
        const rows = await tx.select({
          id: questions.id,
          sourceKey: organizationSampleSource(
            sql`${questions.id}`,
            sql`(SELECT o.source FROM question_organization_origins o WHERE o.question_id = ${questions.id} AND o.tenant_id = ${ctx.tenantId})`,
          ),
          orderKey: sql<string>`md5(${input.id} || ${questions.id}::text)`,
        }).from(questions).innerJoin(
          questionRevisions,
          eq(questionRevisions.id, questions.latestRevisionId),
        ).where(and(
          eq(questions.tenantId, ctx.tenantId),
          eq(questions.lifecycleState, 'active'),
          eq(questionRevisions.draftState, 'published'),
          sql`(EXISTS(SELECT 1 FROM ${bankCollectionItems} WHERE ${bankCollectionItems.questionId}=${questions.id} AND ${bankCollectionItems.collectionId}=${setup.question_organization_setups.collectionId} AND ${bankCollectionItems.tenantId}=${ctx.tenantId}) OR EXISTS(SELECT 1 FROM ${organizationOrigins} WHERE ${organizationOrigins.questionId}=${questions.id} AND ${organizationOrigins.collectionId}=${setup.question_organization_setups.collectionId} AND ${organizationOrigins.tenantId}=${ctx.tenantId}))`,
        )).orderBy(questions.id).limit(ORGANIZATION_QUESTION_LIMIT + 1);
        if (!rows.length) return { ok: false, code: 'empty_scope' } as const;
        if (rows.length > ORGANIZATION_QUESTION_LIMIT) {
          return { ok: false, code: 'scope_too_large' } as const;
        }
        return await queueOrganizationInTransaction(tx, ctx, {
          ...input,
          questionIds: input.mode === 'preview'
            ? selectOrganizationPreviewPool(rows.map((r) => ({ ...r, questionId: r.id })))
            : rows.map((r) => r.id),
        }, this.now());
      });
    } catch (cause) {
      console.error('Organization queue failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' } as const;
    }
  }

  /** Return a bounded sample and aggregate status; bank contents never enter the client in bulk. */
  async run(ctx: RequestContext, id: string) {
    if (!isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' } as const;
    try {
      return await this.database.transaction(async (tx) => {
        if (!await canReadEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [row] = await tx.select().from(organizationRuns).where(
          and(eq(organizationRuns.id, id), eq(organizationRuns.tenantId, ctx.tenantId)),
        );
        if (!row) return { ok: false, code: 'not_found' } as const;
        const context = await loadOrganizationRun(tx, id, row.executionId, {
          kind: 'request',
          ctx,
        });
        if (!context) return { ok: false, code: 'not_found' } as const;
        const counts = await tx.select({
          state: organizationItems.state,
          count: sql<number>`count(*)`.mapWith(Number),
        }).from(organizationItems).where(eq(organizationItems.runId, id)).groupBy(
          organizationItems.state,
        );
        const review = row.mode === 'preview' && row.state !== 'queued'
          ? await loadOrganizationReview(tx, context)
          : null;
        const samples = await tx.select({
          item: organizationItems,
          title: sql<string>`${questionRevisions.body}->>'title'`,
          body: questionRevisions.body,
        }).from(organizationItems).innerJoin(
          questionRevisions,
          eq(questionRevisions.id, organizationItems.revisionId),
        ).where(
          and(
            eq(organizationItems.runId, id),
            review
              ? inArray(organizationItems.questionId, review.map((r) => r.questionId))
              : undefined,
          ),
        ).orderBy(organizationItems.questionId).limit(20);
        const destinations = context.policy.filing.length
          ? await tx.select({ id: bankCollections.id, name: bankCollections.name }).from(
            bankCollections,
          ).where(
            and(
              eq(bankCollections.tenantId, ctx.tenantId),
              inArray(
                bankCollections.id,
                context.policy.filing.map((f) => f.collectionId),
              ),
            ),
          )
          : [];
        const sample = samples.map(({ item, title, body }) => {
          const prepared = prepareEnrichmentQuestion(item.questionId, item.revisionId, body);
          const content = prepared.ok
            ? {
              body: sanitizeBodyHtml(prepared.value.bodyHtml + prepared.value.promptHtml),
              choices: prepared.value.choices.map((c) => ({
                id: c.id,
                text: c.text,
                html: sanitizeBodyHtml(c.html),
              })),
            }
            : null;
          const decision = item.decision === null
            ? null
            : parseOrganizationDecision(item.decision, context.definition, context.policy);
          if (item.decision !== null && !decision) throw new Error('Invalid stored decision');
          if (typeof title !== 'string') throw new Error('Question title is missing');
          const topicId = decision && organizationTopic(decision);
          return {
            questionId: item.questionId,
            revisionId: item.revisionId,
            sampleReason: review?.find((r) => r.questionId === item.questionId)?.reason ?? null,
            canTeach: row.mode === 'preview' && row.state === 'completed' &&
              decision?.kind === 'clef' && content !== null &&
              ['previewed', 'unassigned'].includes(item.state),
            title,
            content,
            destination: destinations.find((d) =>
              d.id === context.policy.filing.find((f) =>
                f.topicId === topicId
              )?.collectionId
            )?.name ?? null,
            state: item.state,
            topic: context.definition.topics.find((t) => t.id === topicId)?.label ?? null,
          };
        });
        const [activation] = await tx.select().from(organizationActivation).where(
          eq(organizationActivation.collectionId, context.setup.collectionId),
        );
        return {
          ok: true,
          value: {
            id,
            executionId: row.executionId,
            undoProcessed: row.undoProcessed,
            recovery: await loadOrganizationRecovery(tx, context),
            mode: row.mode,
            state: row.state,
            setupId: row.setupId,
            collectionId: context.setup.collectionId,
            definition: context.definition,
            counts,
            sample: review
              ? review.flatMap((r) => sample.filter((s) => s.questionId === r.questionId))
              : sample,
            activation: {
              revision: activation?.revision ?? 0,
              setupId: activation?.setupId ?? null,
            },
          },
        } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (cause) {
      console.error('Organization progress read failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' } as const;
    }
  }
}
export type OrganizationHome = Extract<
  Awaited<ReturnType<QuestionOrganizationWorkspace['home']>>,
  { ok: true }
>['value'];
export type OrganizationProgress = Extract<
  Awaited<ReturnType<QuestionOrganizationWorkspace['run']>>,
  { ok: true }
>['value'];
