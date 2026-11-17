import {
  hasWorkspaceCapability,
  lockWorkspaceAndRequireAuthority,
} from './workspace_authorization.ts';
import { and, eq } from 'drizzle-orm';
import { db } from '../db.ts';
import { questionRevisions, questions } from '../db/schema.ts';
import { prepareQuestionRevision } from '../question_revision_preparation.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { RequestContext } from '../tenants.ts';
import { saveQuestionRevisionInTransaction } from './questions.ts';

export type RestoreQuestionRevisionResult =
  | { readonly ok: true; readonly revision: number }
  | {
    readonly ok: false;
    readonly code:
      | 'invalid_reference'
      | 'forbidden'
      | 'source_unavailable'
      | 'stale_revision'
      | 'archived'
      | 'invalid_source';
  };

/** Restore immutable content as a new revision, fenced by the latest revision seen by the author. */
export async function restoreQuestionRevision(
  ctx: RequestContext,
  questionId: string,
  sourceRevision: number,
  expectedLatestRevisionId: string,
): Promise<RestoreQuestionRevisionResult> {
  if (
    !isCanonicalUuid(questionId) || !isCanonicalUuid(expectedLatestRevisionId) ||
    !Number.isSafeInteger(sourceRevision) || sourceRevision < 1
  ) return { ok: false, code: 'invalid_reference' };
  if (!await hasWorkspaceCapability(ctx, 'manage_content', db)) {
    return { ok: false, code: 'forbidden' };
  }
  const [source] = await db.select().from(questionRevisions).where(
    and(
      eq(questionRevisions.tenantId, ctx.tenantId),
      eq(questionRevisions.questionId, questionId),
      eq(questionRevisions.revision, sourceRevision),
    ),
  );
  const [current] = await db.select().from(questionRevisions).where(
    and(
      eq(questionRevisions.tenantId, ctx.tenantId),
      eq(questionRevisions.questionId, questionId),
      eq(questionRevisions.id, expectedLatestRevisionId),
    ),
  );
  if (!source) return { ok: false, code: 'source_unavailable' };
  if (!current) return { ok: false, code: 'stale_revision' };
  if (source.revision >= current.revision) return { ok: false, code: 'invalid_reference' };
  if (typeof source.body.title !== 'string') return { ok: false, code: 'invalid_source' };
  const tags = source.body.tags === undefined ? [] : source.body.tags;
  if (!Array.isArray(tags) || !tags.every((tag): tag is string => typeof tag === 'string')) {
    return { ok: false, code: 'invalid_source' };
  }
  const prepared = await prepareQuestionRevision({
    questionId,
    title: source.body.title,
    tags,
    body: source.body,
    qtiXml: source.qtiXml,
    ...(source.metadata === null ? {} : { metadata: source.metadata }),
    rubric: source.rubric,
    scoring: source.scoring,
    note: `Restored from revision ${source.revision}.`,
    draftState: 'published' as const,
    provenance: {
      _tag: 'Revision' as const,
      operation: 'restored' as const,
      expectedParentRevision: current.revision,
      restoredFromRevision: source.revision,
    },
  });
  return await db.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return { ok: false, code: 'forbidden' };
    }
    const [question] = await tx.select().from(questions).where(
      and(eq(questions.id, questionId), eq(questions.tenantId, ctx.tenantId)),
    ).for('update');
    if (!question) return { ok: false, code: 'source_unavailable' };
    if (question.lifecycleState !== 'active') return { ok: false, code: 'archived' };
    if (question.latestRevisionId !== expectedLatestRevisionId) {
      return { ok: false, code: 'stale_revision' };
    }
    const saved = await saveQuestionRevisionInTransaction(tx, ctx, prepared);
    return { ok: true, revision: saved.revision };
  });
}
