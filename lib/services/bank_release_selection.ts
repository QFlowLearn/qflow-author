import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db, type DbReadConnection } from '../db.ts';
import { canPublishEditions } from './workspace_authorization.ts';
import { bankCollectionItems, bankCollections } from '../db/bank_schema.ts';
import { bankReleaseRevisions, bankReleases } from '../db/bank_release_schema.ts';
import { questionRevisions, questions } from '../db/question_schema.ts';
import {
  MAX_RELEASE_ITEMS,
  type ReleaseItem,
  type ReleaseManifest,
  type ReleaseResult,
} from '../banks/bank_release.ts';
import { loadRevisionPublicationEligibility } from './publication_evidence.ts';
import type { RequestContext } from '../tenants.ts';

/** Resolve the ordered, deduplicated union once. Later filing changes require a new selection. */
export async function selectReleaseQuestions(
  conn: DbReadConnection,
  ctx: RequestContext,
  collectionIds: readonly string[],
  questionIds: readonly string[],
): Promise<ReleaseResult<{ ids: string[]; collections: ReleaseManifest['collections'] }>> {
  const collections = collectionIds.length
    ? await conn.select().from(bankCollections).where(
      and(
        eq(bankCollections.tenantId, ctx.tenantId),
        inArray(bankCollections.id, [...collectionIds]),
      ),
    )
    : [];
  if (
    collections.length !== collectionIds.length ||
    collections.some((row) => row.archivedAt !== null)
  ) return { ok: false, code: 'invalid_selection' };
  const filed = collectionIds.length
    ? await conn.select().from(bankCollectionItems).where(
      and(
        eq(bankCollectionItems.tenantId, ctx.tenantId),
        inArray(bankCollectionItems.collectionId, [...collectionIds]),
      ),
    ).orderBy(asc(bankCollectionItems.position), asc(bankCollectionItems.questionId))
    : [];
  const ids = [
    ...new Set([
      ...collectionIds.flatMap((id) =>
        filed.filter((row) => row.collectionId === id).map((row) => row.questionId)
      ),
      ...questionIds,
    ]),
  ];
  if (!ids.length || ids.length > MAX_RELEASE_ITEMS) {
    return { ok: false, code: 'invalid_selection' };
  }
  return {
    ok: true,
    value: {
      ids,
      collections: collectionIds.map((id) => {
        const row = collections.find((c) => c.id === id);
        if (!row) throw new Error('Missing selected collection.');
        return { id, name: row.name };
      }),
    },
  };
}
/** Capture exact revision evidence. Refresh substitutes latest only for explicit current selections. */
export async function snapshotReleaseItems(
  conn: DbReadConnection,
  ctx: RequestContext,
  selection: readonly {
    questionId: string;
    revisionId: string | null;
    selection: 'current' | 'historical';
  }[],
): Promise<ReleaseResult<ReleaseItem[]>> {
  const pool = await conn.select().from(questions).where(
    and(
      eq(questions.tenantId, ctx.tenantId),
      inArray(questions.id, selection.map((row) => row.questionId)),
    ),
  );
  if (pool.length !== selection.length) return { ok: false, code: 'invalid_selection' };
  const ids = selection.map((item) => {
    const q = pool.find((row) => row.id === item.questionId);
    return item.revisionId ?? q?.latestRevisionId;
  });
  if (ids.some((id) => !id)) return { ok: false, code: 'invalid_selection' };
  const revisionIds = ids.filter((id): id is string => typeof id === 'string');
  const revisions = await conn.select().from(questionRevisions).where(
    and(eq(questionRevisions.tenantId, ctx.tenantId), inArray(questionRevisions.id, revisionIds)),
  );
  if (revisions.length !== selection.length || revisions.some((row) => !row.qtiXml.trim())) {
    return { ok: false, code: 'technical_blocker' };
  }
  const eligibility = await loadRevisionPublicationEligibility(conn, ctx, revisionIds);
  if (!eligibility.ok) {
    return {
      ok: false,
      code: eligibility.code === 'forbidden' ? 'forbidden' : 'invalid_selection',
    };
  }
  const shipped = await conn.select({ revisionId: bankReleaseRevisions.revisionId }).from(
    bankReleaseRevisions,
  ).innerJoin(bankReleases, eq(bankReleases.id, bankReleaseRevisions.releaseId)).where(
    and(
      eq(bankReleaseRevisions.tenantId, ctx.tenantId),
      eq(bankReleases.state, 'frozen'),
      inArray(bankReleaseRevisions.revisionId, revisionIds),
    ),
  );
  return {
    ok: true,
    value: selection.map((item, index) => {
      const revision = revisions.find((row) =>
        row.id === revisionIds[index] && row.questionId === item.questionId
      );
      const evidence = eligibility.revisions.find((row) => row.revisionId === revisionIds[index]);
      if (!revision || !evidence) throw new Error('Selected revision identity mismatch.');
      const bodyTitle = revision.body.title;
      return {
        questionId: item.questionId,
        revisionId: revision.id,
        revision: revision.revision,
        title: typeof bodyTitle === 'string' ? bodyTitle : '',
        selection: item.selection,
        eligibility: evidence,
        previouslyShipped: shipped.some((row) => row.revisionId === revision.id),
      };
    }),
  };
}

/** Load the authorized collection picker at the release creation boundary. */
export async function loadReleaseCreationOptions(
  ctx: RequestContext,
): Promise<ReleaseResult<readonly { id: string; name: string }[]>> {
  if (!await canPublishEditions(db, ctx)) return { ok: false, code: 'forbidden' };
  const collections = await db.select({ id: bankCollections.id, name: bankCollections.name }).from(
    bankCollections,
  ).where(and(eq(bankCollections.tenantId, ctx.tenantId), isNull(bankCollections.archivedAt)))
    .orderBy(asc(bankCollections.position), asc(bankCollections.id));
  return { ok: true, value: collections };
}
