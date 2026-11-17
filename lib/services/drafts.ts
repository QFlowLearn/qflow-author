import {
  hasWorkspaceCapability,
  lockWorkspaceAndRequireAuthority,
} from './workspace_authorization.ts';
import { bankCollectionAcceptsIntake } from './bank_intake_access.ts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db.ts';
import { draftSessions, questionRevisions, questions } from '../db/schema.ts';
import { parsePersistedDraft, type PersistedDraft } from '../persisted_draft.ts';
import { parseTimestamp, parseUuid } from '../persistence_parse.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import { hasCapability } from '../roles.ts';
import { isQuestionTypeId } from '../types/registry.ts';
import {
  createDraftSessionId,
  type DraftSessionId,
  parseDraftSessionId,
} from '../draft_session_id.ts';

export type DraftSessionRecord = {
  readonly id: DraftSessionId;
  readonly draft: PersistedDraft;
  readonly binding: { readonly _tag: 'Revision'; readonly questionRevisionId: string } | {
    readonly _tag: 'Bank';
    readonly collectionId: string | null;
    readonly publishedQuestionId: string | null;
  };
  readonly updatedAt: string;
};

/** Result of updating or deleting one author-owned working draft. */
export type DraftSessionMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'forbidden' | 'not_found' };

/** Result of atomically opening the latest editable revision and its author-owned draft. */
export type OpenLatestRevisionDraftSessionResult =
  | {
    readonly ok: true;
    readonly itemId: string;
    readonly sourceRevisionId: string;
    readonly tags: readonly string[];
    readonly session: DraftSessionRecord;
  }
  | {
    readonly ok: false;
    readonly code: 'forbidden' | 'not_found' | 'archived' | 'invalid_content';
  };

/** Finds one draft owned by the current author and parses its persisted content. */
export async function getDraftSession(
  ctx: RequestContext,
  id: DraftSessionId,
): Promise<DraftSessionRecord | null> {
  if (!await hasWorkspaceCapability(ctx, 'manage_content', db)) return null;
  const tenantId = ctx.tenantId;
  const authorId = resolveUserId(ctx);
  const row = await db.select()
    .from(draftSessions)
    .where(and(
      eq(draftSessions.id, id),
      eq(draftSessions.tenantId, tenantId),
      eq(draftSessions.authorId, authorId),
    ))
    .limit(1);
  if (!row.length) return null;
  return mapDraftSession(row[0]);
}

/** Updates an existing author-owned draft without creating a missing session. */
export async function updateDraftSession(
  ctx: RequestContext,
  id: DraftSessionId,
  draft: PersistedDraft,
): Promise<DraftSessionMutationResult> {
  if (!hasCapability(ctx.role, 'manage_content')) return { ok: false, code: 'forbidden' };
  return await db.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return { ok: false, code: 'forbidden' };
    }
    const [session] = await tx.select().from(draftSessions).where(and(
      eq(draftSessions.id, id),
      eq(draftSessions.tenantId, ctx.tenantId),
      eq(draftSessions.authorId, resolveUserId(ctx)),
    )).for('update');
    if (!session) return { ok: false, code: 'not_found' };
    const binding = parseDraftBinding(session);
    if (
      binding._tag === 'Bank' && !await bankCollectionAcceptsIntake(tx, ctx, binding.collectionId)
    ) {
      return { ok: false, code: 'not_found' };
    }
    const rows = await tx.update(draftSessions).set({
      clientState: draft,
      lastHeartbeat: new Date(),
    }).where(and(
      isNull(draftSessions.publishedQuestionId),
      eq(draftSessions.id, id),
      eq(draftSessions.tenantId, ctx.tenantId),
      eq(draftSessions.authorId, resolveUserId(ctx)),
    )).returning({ id: draftSessions.id });
    return rows.length === 1 ? { ok: true } : { ok: false, code: 'not_found' };
  });
}

/** Deletes one author-owned draft and reports whether it existed. */
export async function deleteDraftSession(
  ctx: RequestContext,
  id: DraftSessionId,
): Promise<DraftSessionMutationResult> {
  if (!hasCapability(ctx.role, 'manage_content')) return { ok: false, code: 'forbidden' };
  return await db.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return { ok: false, code: 'forbidden' };
    }
    const tenantId = ctx.tenantId;
    const authorId = resolveUserId(ctx);
    const deleted = await tx.delete(draftSessions)
      .where(and(
        isNull(draftSessions.publishedQuestionId),
        eq(draftSessions.id, id),
        eq(draftSessions.tenantId, tenantId),
        eq(draftSessions.authorId, authorId),
      )).returning({ id: draftSessions.id });
    return deleted.length === 1 ? { ok: true } : { ok: false, code: 'not_found' };
  });
}

/**
 * Opens the item's exact latest published revision and working draft in one transaction.
 * Expected authorization, lookup, lifecycle, and persisted-content failures are returned.
 */
export async function openLatestRevisionDraftSession(
  ctx: RequestContext,
  itemId: string,
): Promise<OpenLatestRevisionDraftSessionResult> {
  if (!hasCapability(ctx.role, 'manage_content')) return { ok: false, code: 'forbidden' };
  return await db.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return { ok: false, code: 'forbidden' };
    }
    const questionRows = await tx.select({
      id: questions.id,
      title: questions.title,
      tags: questions.tags,
      lifecycleState: questions.lifecycleState,
      latestRevisionId: questions.latestRevisionId,
    }).from(questions).where(and(
      eq(questions.id, itemId),
      eq(questions.tenantId, ctx.tenantId),
    )).for('update').limit(1);
    if (!questionRows.length) return { ok: false, code: 'not_found' } as const;
    const question = questionRows[0];
    if (question.lifecycleState === 'archived') return { ok: false, code: 'archived' } as const;
    if (question.lifecycleState !== 'active' || !question.latestRevisionId) {
      return { ok: false, code: 'invalid_content' } as const;
    }

    const revisionRows = await tx.select({
      id: questionRevisions.id,
      body: questionRevisions.body,
      draftState: questionRevisions.draftState,
    }).from(questionRevisions).where(and(
      eq(questionRevisions.id, question.latestRevisionId),
      eq(questionRevisions.questionId, question.id),
      eq(questionRevisions.tenantId, ctx.tenantId),
    )).for('update').limit(1);
    if (!revisionRows.length || revisionRows[0].draftState !== 'published') {
      return { ok: false, code: 'invalid_content' } as const;
    }
    const revision = revisionRows[0];
    const type = revision.body.type;
    if (!isQuestionTypeId(type)) return { ok: false, code: 'invalid_content' } as const;
    let seed: PersistedDraft;
    try {
      seed = parsePersistedDraft(revision.body, type);
    } catch (_cause: unknown) {
      return { ok: false, code: 'invalid_content' } as const;
    }
    if (seed.title !== question.title) return { ok: false, code: 'invalid_content' } as const;
    const sourceRevisionId = parseUuid(
      revision.id,
      'Latest question revision identifier is invalid.',
    );
    const session = await getOrCreateRevisionDraftSessionInTransaction(
      tx,
      ctx,
      sourceRevisionId,
      seed,
    );
    return {
      ok: true,
      itemId: question.id,
      sourceRevisionId,
      tags: question.tags,
      session,
    } as const;
  });
}

function mapDraftSession(row: typeof draftSessions.$inferSelect): DraftSessionRecord {
  const id = parseDraftSessionId(row.id);
  if (!id) throw new Error('Persisted working-draft identifier is invalid.');
  return {
    id,
    draft: parseDraftSessionState(row.clientState),
    binding: parseDraftBinding(row),
    updatedAt: parseTimestamp(
      row.lastHeartbeat,
      'Persisted working-draft timestamp is invalid.',
    ),
  };
}

type DraftTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getOrCreateRevisionDraftSessionInTransaction(
  tx: DraftTransaction,
  ctx: RequestContext,
  questionRevisionId: string,
  seed: PersistedDraft,
): Promise<DraftSessionRecord> {
  const authorId = resolveUserId(ctx);
  const existing = await tx.select()
    .from(draftSessions)
    .where(and(
      eq(draftSessions.tenantId, ctx.tenantId),
      eq(draftSessions.authorId, authorId),
      eq(draftSessions.questionRevisionId, questionRevisionId),
    )).limit(1);
  if (existing.length) return mapDraftSession(existing[0]);
  const id = createDraftSessionId();
  const inserted = await tx.insert(draftSessions).values({
    kind: 'Revision',
    id,
    questionRevisionId,
    tenantId: ctx.tenantId,
    authorId,
    clientState: seed,
    lastHeartbeat: new Date(),
  }).returning();
  if (!inserted.length) throw new Error('Working draft was not created.');
  return mapDraftSession(inserted[0]);
}

function parseDraftSessionState(value: unknown): PersistedDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted draft session state is invalid.');
  }
  const typeValue = Reflect.get(value, 'type');
  if (!isQuestionTypeId(typeValue)) throw new Error('Persisted draft session type is invalid.');
  return parsePersistedDraft(value, typeValue);
}

function parseDraftBinding(row: typeof draftSessions.$inferSelect): DraftSessionRecord['binding'] {
  if (row.kind === 'Revision' && row.collectionId === null && row.publishedQuestionId === null) {
    return {
      _tag: 'Revision',
      questionRevisionId: parseUuid(row.questionRevisionId, 'Invalid draft revision binding.'),
    };
  }
  if (row.kind === 'Bank' && row.questionRevisionId === null) {
    return {
      _tag: 'Bank',
      collectionId: row.collectionId,
      publishedQuestionId: row.publishedQuestionId,
    };
  }
  throw new Error('Invalid persisted draft binding.');
}

/** Load this author's resumable bank drafts without creating any content on reads. */
export async function listBankDraftSessions(
  ctx: RequestContext,
): Promise<readonly DraftSessionRecord[]> {
  if (!await hasWorkspaceCapability(ctx, 'manage_content', db)) return [];
  const rows = await db.select().from(draftSessions).where(and(
    eq(draftSessions.tenantId, ctx.tenantId),
    eq(draftSessions.authorId, ctx.userId),
    eq(draftSessions.kind, 'Bank'),
    isNull(draftSessions.publishedQuestionId),
  )).orderBy(desc(draftSessions.lastHeartbeat)).limit(100);
  return rows.map(mapDraftSession);
}
