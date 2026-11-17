import { ContentAssetUnavailableError } from './owned_content_assets.ts';
import { registerOrganizationIntake } from './question_organization_intake.ts';
import { BankFilingFailure, filePublishedBankQuestionsInTransaction } from './bank_collections.ts';
import { and, eq } from 'drizzle-orm';
import { db } from '../db.ts';
import { draftSessions } from '../db/schema.ts';
import { canonicalJsonStringify, projectJsonPersistenceObject } from '../canonical_json.ts';
import type { DraftSessionId } from '../draft_session_id.ts';
import { parsePersistedDraft, type PersistedDraft } from '../persisted_draft.ts';
import type { RequestContext } from '../tenants.ts';
import { type QuestionTypeId, TYPE_DRIVERS } from '../types/registry.ts';
import { newAuthoringItemLanguage } from '../types/item_language.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { authorizeBankIntakeInTransaction } from './bank_intake_access.ts';
import { getDraftSession } from './drafts.ts';
import {
  prepareQuestionPublicationFromSource,
  publishFailure,
  type PublishQuestionResult,
  questionPublicationIdentifier,
} from './publish.ts';
import { saveQuestionRevisionInTransaction } from './questions.ts';

type BankDraftCreationResult =
  | { readonly ok: true; readonly id: DraftSessionId }
  | { readonly ok: false; readonly code: 'forbidden' | 'conflict' };

/** Create one author-owned bank draft without persisting a question or an assessment. */
export async function createBankDraft(ctx: RequestContext, input: {
  readonly id: DraftSessionId;
  readonly collectionId: string | null;
  readonly type: QuestionTypeId;
}): Promise<BankDraftCreationResult> {
  const draft = parsePersistedDraft({
    ...TYPE_DRIVERS[input.type].defaults(),
    type: input.type,
    itemLanguage: newAuthoringItemLanguage(),
  }, input.type);
  return await db.transaction(async (tx) => {
    if (!await authorizeBankIntakeInTransaction(tx, ctx, input.collectionId)) {
      return { ok: false, code: 'forbidden' };
    }
    await tx.insert(draftSessions).values({
      id: input.id,
      kind: 'Bank',
      tenantId: ctx.tenantId,
      authorId: ctx.userId,
      collectionId: input.collectionId,
      clientState: draft,
      lastHeartbeat: new Date(),
    }).onConflictDoNothing();
    const [row] = await tx.select().from(draftSessions).where(
      and(
        eq(draftSessions.id, input.id),
        eq(draftSessions.tenantId, ctx.tenantId),
        eq(draftSessions.authorId, ctx.userId),
      ),
    );
    if (
      !row || row.kind !== 'Bank' || row.collectionId !== input.collectionId ||
      row.clientState.type !== input.type
    ) return { ok: false, code: 'conflict' };
    return { ok: true, id: input.id };
  });
}

/** Publish a new question and optional filing atomically, retaining its draft as an exact retry receipt. */
export async function publishBankDraft(ctx: RequestContext, input: {
  readonly id: DraftSessionId;
  readonly draft: PersistedDraft;
}): Promise<PublishQuestionResult> {
  if (input.draft.itemId !== undefined) {
    return publishFailure(
      400,
      'invalid_draft',
      'A new bank draft cannot select an existing question.',
      [],
    );
  }
  const session = await getDraftSession(ctx, input.id);
  if (!session || session.binding._tag !== 'Bank') {
    return publishFailure(404, 'draft_not_found', 'The working draft is unavailable.', []);
  }
  const itemId = await uuidV5(input.id, 'bank-question');
  const prepared = session.binding.publishedQuestionId === null
    ? await prepareQuestionPublicationFromSource(input.draft, { _tag: 'New', itemId })
    : null;
  if (prepared && !prepared.ok) return prepared.error;
  const collectionId = session.binding.collectionId;
  try {
    return await db.transaction(async (tx) => {
      if (!await authorizeBankIntakeInTransaction(tx, ctx, collectionId)) {
        return publishFailure(
          404,
          'draft_not_found',
          'The working draft destination is unavailable.',
          [],
        );
      }
      const [row] = await tx.select().from(draftSessions).where(
        and(
          eq(draftSessions.id, input.id),
          eq(draftSessions.tenantId, ctx.tenantId),
          eq(draftSessions.authorId, ctx.userId),
        ),
      ).for('update');
      if (!row || row.kind !== 'Bank' || row.collectionId !== collectionId) {
        return publishFailure(404, 'draft_not_found', 'The working draft is unavailable.', []);
      }
      if (row.publishedQuestionId !== null) {
        if (
          canonicalJsonStringify(row.clientState) !==
            canonicalJsonStringify(projectJsonPersistenceObject(input.draft))
        ) {
          return publishFailure(
            409,
            'draft_already_published',
            'This draft was already published with different content.',
            [],
          );
        }
        return {
          ok: true,
          status: 201,
          body: {
            itemId: row.publishedQuestionId,
            rev: 1,
            identifier: questionPublicationIdentifier(row.publishedQuestionId, 1),
          },
        };
      }
      if (!prepared || !prepared.ok) {
        throw new Error('Published bank draft unexpectedly returned to an unpublished state.');
      }
      const saved = await saveQuestionRevisionInTransaction(tx, ctx, prepared.prepared.saveInput);
      if (saved.revision !== 1 || saved.questionId !== itemId) {
        throw new Error('New bank question identity disagrees with its prepared revision.');
      }
      if (collectionId !== null) {
        await filePublishedBankQuestionsInTransaction(
          tx,
          ctx,
          collectionId,
          [saved.questionId],
          new Date(),
        );
        await registerOrganizationIntake(tx, ctx, collectionId, [{
          questionId: saved.questionId,
          source: null,
        }], new Date());
      }
      await tx.update(draftSessions).set({
        clientState: projectJsonPersistenceObject(input.draft),
        publishedQuestionId: saved.questionId,
        lastHeartbeat: new Date(),
      }).where(eq(draftSessions.id, input.id));
      return {
        ok: true,
        status: 201,
        body: {
          itemId: saved.questionId,
          rev: saved.revision,
          identifier: prepared.prepared.identifier,
        },
      };
    });
  } catch (cause: unknown) {
    if (cause instanceof ContentAssetUnavailableError) {
      return publishFailure(cause.status, cause.code, cause.message, [{
        field: 'general',
        message: cause.message,
      }]);
    }
    if (cause instanceof BankFilingFailure) {
      return publishFailure(
        409,
        'filing_failed',
        'The question could not be filed in its collection.',
        [],
      );
    }
    throw cause;
  }
}
