import { ContentAssetUnavailableError } from './owned_content_assets.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { and, eq } from 'drizzle-orm';
import { db } from '../db.ts';
import { draftSessions, questions } from '../db/schema.ts';
import type { PersistedDraft } from '../persisted_draft.ts';
import type { RequestContext } from '../tenants.ts';
import { resolveUserId } from '../tenants.ts';
import type { DraftSessionId } from '../draft_session_id.ts';
import { StaleQuestionRevisionError } from '../question_provenance.ts';
import {
  ArchivedQuestionError,
  getQuestionRevisionPublicationSource,
  saveQuestionRevisionInTransaction,
} from './questions.ts';
import {
  archivedQuestionFailure,
  prepareQuestionPublicationFromSource,
  publishFailure,
  type PublishQuestionResult,
  staleSourceRevisionFailure,
} from './publish.ts';

/** Input for publishing and consuming one revision-bound working draft. */
export type PublishRevisionDraftInput = {
  readonly draftSessionId: DraftSessionId;
  readonly sourceRevisionId: string;
  readonly draft: PersistedDraft;
};

/** Publishes one exact source revision and deletes its working draft in the same transaction. */
export async function publishRevisionDraft(
  ctx: RequestContext,
  input: PublishRevisionDraftInput,
): Promise<PublishQuestionResult> {
  const source = await getQuestionRevisionPublicationSource(ctx, input.sourceRevisionId);
  if (!source) {
    return publishFailure(404, 'source_revision_not_found', 'The source revision is unavailable.', [
      {
        field: 'itemId',
        message: 'Return to the item and open a new working draft.',
      },
    ]);
  }
  if (input.draft.itemId !== source.baseline.questionId) {
    return publishFailure(409, 'draft_binding_mismatch', 'This draft belongs to another item.', [{
      field: 'itemId',
      message: 'Return to the item and open its working draft.',
    }]);
  }
  if (source.latestRevisionId !== source.baseline.revision.id) {
    return staleSourceRevisionFailure();
  }
  if (source.lifecycle === 'archived') return archivedQuestionFailure();
  const preparation = await prepareQuestionPublicationFromSource(input.draft, {
    _tag: 'Revision',
    baseline: source.baseline,
  });
  if (!preparation.ok) return preparation.error;
  if (
    preparation.prepared.itemId !== source.baseline.questionId ||
    preparation.prepared.revision !== source.baseline.revision.number + 1
  ) {
    return staleSourceRevisionFailure();
  }

  try {
    return await db.transaction(async (tx) => {
      if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
        return publishFailure(404, 'draft_not_found', 'The working draft is unavailable.', []);
      }
      const questionRows = await tx.select({
        latestRevisionId: questions.latestRevisionId,
        lifecycleState: questions.lifecycleState,
      }).from(questions).where(and(
        eq(questions.id, source.baseline.questionId),
        eq(questions.tenantId, ctx.tenantId),
      )).for('update').limit(1);
      if (!questionRows.length) {
        return publishFailure(404, 'item_not_found', 'The item is unavailable.', []);
      }
      if (questionRows[0].lifecycleState === 'archived') {
        return archivedQuestionFailure();
      }
      if (questionRows[0].latestRevisionId !== input.sourceRevisionId) {
        return staleSourceRevisionFailure();
      }

      const sessionRows = await tx.select({
        questionRevisionId: draftSessions.questionRevisionId,
      }).from(draftSessions).where(and(
        eq(draftSessions.id, input.draftSessionId),
        eq(draftSessions.tenantId, ctx.tenantId),
        eq(draftSessions.authorId, resolveUserId(ctx)),
      )).for('update').limit(1);
      if (!sessionRows.length) {
        return publishFailure(404, 'draft_not_found', 'The working draft is unavailable.', [{
          field: 'general',
          message: 'Return to the item and open a new working draft.',
        }]);
      }
      if (sessionRows[0].questionRevisionId !== input.sourceRevisionId) {
        return publishFailure(409, 'draft_binding_mismatch', 'The working draft source changed.', [{
          field: 'general',
          message: 'Return to the item and open a new working draft.',
        }]);
      }

      const saved = await saveQuestionRevisionInTransaction(
        tx,
        ctx,
        preparation.prepared.saveInput,
      );
      if (saved.revision !== preparation.prepared.revision) {
        throw new Error('Saved question revision does not match its prepared identifier.');
      }
      const deleted = await tx.delete(draftSessions).where(and(
        eq(draftSessions.id, input.draftSessionId),
        eq(draftSessions.tenantId, ctx.tenantId),
        eq(draftSessions.authorId, resolveUserId(ctx)),
        eq(draftSessions.questionRevisionId, input.sourceRevisionId),
      )).returning({ id: draftSessions.id });
      if (deleted.length !== 1) {
        throw new Error('Published revision draft was not deleted exactly once.');
      }
      return {
        ok: true,
        status: 201,
        body: {
          itemId: saved.questionId,
          rev: saved.revision,
          identifier: preparation.prepared.identifier,
        },
      };
    });
  } catch (cause: unknown) {
    if (cause instanceof ContentAssetUnavailableError) {
      return {
        ok: false,
        status: 422,
        body: {
          error: cause.code,
          message: cause.message,
          issues: [{ field: 'general', message: cause.message }],
        },
      };
    }
    if (cause instanceof StaleQuestionRevisionError) return staleSourceRevisionFailure();
    if (cause instanceof ArchivedQuestionError) return archivedQuestionFailure();
    throw cause;
  }
}
