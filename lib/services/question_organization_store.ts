import { ORGANIZATION_QUESTION_LIMIT } from '../organization_limits.ts';
import { ORGANIZATION_PREVIEW_POOL_LIMIT } from '../organization_preview_sample.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { bankCollectionItems, bankCollections } from '../db/bank_schema.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import {
  organizationItems,
  organizationOrigins,
  organizationRuns,
  organizationSetups,
} from '../db/question_organization_schema.ts';
import { questionRevisions, questions } from '../db/question_schema.ts';
import { workflowDispatches } from '../db/workflow_canvas_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { RequestContext } from '../tenants.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import { loadCurrentEnrichmentChanges } from './bank_enrichment_changes.ts';
import { type EnrichmentResult, parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import {
  type OrganizationFailure,
  parseOrganizationSetup,
} from './question_organization_contract.ts';

/** Save an immutable collection policy; changing it never retroactively starts work. */
export async function saveOrganizationSetup(
  database: QflowDatabase | QflowDatabaseTransaction,
  ctx: RequestContext,
  input: {
    readonly id: string;
    readonly collectionId: string;
    readonly expectedVersion: number;
    readonly policy: unknown;
  },
  now: Date,
): Promise<EnrichmentResult<string, OrganizationFailure>> {
  if (
    ![input.id, input.collectionId].every(isCanonicalUuid) ||
    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
  ) return { ok: false, code: 'invalid_input' };
  try {
    return await database.transaction(
      async (tx): Promise<EnrichmentResult<string, OrganizationFailure>> => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' };
        }
        const [collection] = await tx.select().from(bankCollections).where(
          and(
            eq(bankCollections.id, input.collectionId),
            eq(bankCollections.tenantId, ctx.tenantId),
            isNull(bankCollections.archivedAt),
          ),
        );
        if (!collection) return { ok: false, code: 'not_found' };
        if (
          typeof input.policy !== 'object' || input.policy === null ||
          !('versionId' in input.policy) || typeof input.policy.versionId !== 'string' ||
          !isCanonicalUuid(input.policy.versionId)
        ) return { ok: false, code: 'invalid_input' };
        const [version] = await tx.select().from(enrichmentSchemeVersions).where(and(
          eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
          eq(enrichmentSchemeVersions.id, input.policy.versionId),
        ));
        const definition = version && parseEnrichmentDefinition(version.definition);
        const policy = definition && parseOrganizationSetup(input.policy, definition);
        if (!policy) return { ok: false, code: 'invalid_input' };
        const destinations = [...new Set(policy.filing.map((f) => f.collectionId))];
        if (destinations.length) {
          const allowed = await tx.select({ id: bankCollections.id }).from(bankCollections).where(
            and(
              eq(bankCollections.tenantId, ctx.tenantId),
              isNull(bankCollections.archivedAt),
              inArray(bankCollections.id, destinations),
            ),
          );
          if (allowed.length !== destinations.length) return { ok: false, code: 'invalid_input' };
        }
        const [existing] = await tx.select().from(organizationSetups).where(
          eq(organizationSetups.id, input.id),
        );
        if (existing) {
          return existing.tenantId === ctx.tenantId &&
              existing.collectionId === input.collectionId && existing.createdBy === ctx.userId &&
              existing.version === input.expectedVersion + 1 &&
              canonicalJsonStringify(existing.policy) === canonicalJsonStringify(policy)
            ? { ok: true, value: existing.id }
            : { ok: false, code: 'conflict' };
        }
        const [latest] = await tx.select().from(organizationSetups).where(
          eq(organizationSetups.collectionId, collection.id),
        ).orderBy(desc(organizationSetups.version)).limit(1);
        if ((latest?.version ?? 0) !== input.expectedVersion) {
          return { ok: false, code: 'conflict' };
        }
        await tx.insert(organizationSetups).values({
          id: input.id,
          tenantId: ctx.tenantId,
          collectionId: collection.id,
          version: input.expectedVersion + 1,
          versionId: policy.versionId,
          policy,
          createdBy: ctx.userId,
          createdAt: now,
        });
        return { ok: true, value: input.id };
      },
    );
  } catch (cause) {
    console.error('Question organization persistence failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

/** Queue an explicitly selected scope with its baseline and outbox in the caller's transaction. */
export async function queueOrganizationInTransaction(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  input: {
    readonly id: string;
    readonly setupId: string;
    readonly mode: 'preview' | 'apply';
    readonly questionIds: readonly string[];
  },
  now: Date,
): Promise<EnrichmentResult<string, OrganizationFailure>> {
  if (
    ![input.id, input.setupId, ...input.questionIds].every(isCanonicalUuid) ||
    !['preview', 'apply'].includes(input.mode) ||
    (input.mode === 'preview' && input.questionIds.length > ORGANIZATION_PREVIEW_POOL_LIMIT) ||
    input.questionIds.length < 1 || input.questionIds.length > ORGANIZATION_QUESTION_LIMIT ||
    new Set(input.questionIds).size !== input.questionIds.length
  ) return { ok: false, code: 'invalid_input' };
  if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
    return { ok: false, code: 'forbidden' };
  }
  const [setup] = await tx.select().from(organizationSetups).where(
    and(eq(organizationSetups.id, input.setupId), eq(organizationSetups.tenantId, ctx.tenantId)),
  );
  if (!setup) return { ok: false, code: 'not_found' };
  const [version] = await tx.select().from(enrichmentSchemeVersions).where(
    and(
      eq(enrichmentSchemeVersions.id, setup.versionId),
      eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
    ),
  );
  const definition = version && parseEnrichmentDefinition(version.definition);
  if (!definition || !parseOrganizationSetup(setup.policy, definition)) {
    throw new Error('Invalid persisted organization setup.');
  }
  const [existing] = await tx.select().from(organizationRuns).where(
    eq(organizationRuns.id, input.id),
  );
  if (existing) {
    if (
      existing.tenantId !== ctx.tenantId || existing.setupId !== setup.id ||
      existing.mode !== input.mode ||
      existing.createdBy !== ctx.userId
    ) return { ok: false, code: 'conflict' };
    const items = await tx.select({ id: organizationItems.questionId }).from(organizationItems)
      .where(eq(organizationItems.runId, input.id));
    return items.length === input.questionIds.length &&
        items.every((item) => input.questionIds.includes(item.id))
      ? { ok: true, value: input.id }
      : { ok: false, code: 'conflict' };
  }
  const sources = await tx.select({
    questionId: questions.id,
    revisionId: questionRevisions.id,
    contentHash: questionRevisions.contentHash,
  }).from(questions).innerJoin(
    questionRevisions,
    eq(questions.latestRevisionId, questionRevisions.id),
  ).where(
    and(
      eq(questions.tenantId, ctx.tenantId),
      eq(questions.lifecycleState, 'active'),
      eq(questionRevisions.draftState, 'published'),
      sql`(EXISTS (SELECT 1 FROM ${organizationOrigins} WHERE
        ${organizationOrigins.questionId} = ${questions.id} AND
        ${organizationOrigins.tenantId} = ${ctx.tenantId} AND
        ${organizationOrigins.collectionId} = ${setup.collectionId}) OR
        EXISTS (SELECT 1 FROM ${bankCollectionItems} WHERE
        ${bankCollectionItems.questionId} = ${questions.id} AND
        ${bankCollectionItems.tenantId} = ${ctx.tenantId} AND
        ${bankCollectionItems.collectionId} = ${setup.collectionId}))`,
      inArray(questions.id, [...input.questionIds]),
    ),
  ).orderBy(questions.id);
  if (sources.length !== input.questionIds.length) return { ok: false, code: 'invalid_input' };
  const executionId = await uuidV5(input.id, 'question-organization');
  await tx.insert(organizationRuns).values({
    id: input.id,
    tenantId: ctx.tenantId,
    setupId: setup.id,
    executionId,
    executionBy: ctx.userId,
    mode: input.mode,
    createdBy: ctx.userId,
    state: 'queued',
    createdAt: now,
  });
  for (let offset = 0; offset < sources.length; offset += 20) {
    const batch = sources.slice(offset, offset + 20);
    const current = await loadCurrentEnrichmentChanges(
      tx,
      ctx.tenantId,
      version.schemeId,
      batch.map((item) => item.questionId),
    );
    const origins = await tx.select().from(organizationOrigins).where(
      and(
        eq(organizationOrigins.tenantId, ctx.tenantId),
        inArray(
          organizationOrigins.questionId,
          batch.map((item) => item.questionId),
        ),
      ),
    );
    await tx.insert(organizationItems).values(batch.map((item) => {
      const values = current.get(item.questionId);
      if (!values) throw new Error('Organization baseline is missing.');
      return {
        ...item,
        tenantId: ctx.tenantId,
        runId: input.id,
        baseline: {
          subject: values.subject?.changeId ?? null,
          topic: values.topic?.changeId ?? null,
          difficulty: values.difficulty?.changeId ?? null,
        },
        source: origins.find((origin) => origin.questionId === item.questionId)?.source ?? null,
        state: 'pending',
      };
    }));
  }
  await tx.insert(workflowDispatches).values({
    id: executionId,
    kind: 'question_organization',
    jobId: input.id,
    tenantId: ctx.tenantId,
    state: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, value: input.id };
}
