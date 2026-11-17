import { parseAnswerFeedback, parseAnswerFeedbackDraft } from '../answer_feedback.ts';
import { requireOwnedContentAssets } from './owned_content_assets.ts';
import { queueSavedQuestionOrganization } from './question_organization_intake.ts';
import { parseQuestionProvenanceHistory } from '../question_provenance_history.ts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { QflowDatabaseTransaction } from '../db.ts';
import { questionRevisions, questions } from '../db/schema.ts';
import type { QuestionBankRevisionProjection } from '../question_bank.ts';
import {
  type QuestionProvenanceHistoryState,
  type QuestionProvenanceResolutionCommand,
  type QuestionRevisionProvenanceIntent,
  resolveQuestionRevisionProvenance,
} from '../question_provenance.ts';
import type { QuestionReviewSuggestion } from '../question_review_types.ts';
import {
  openPreparedQuestionRevision,
  type PreparedQuestionRevision,
} from '../question_revision_preparation.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import { loadQuestionActorSnapshotInTransaction } from './question_provenance.ts';

/** Content and metadata accepted by the canonical question-revision persistence engine. */
export type QuestionRevisionWriteInput = {
  readonly questionId?: string;
  readonly stableKey?: string;
  readonly title: string;
  readonly tags?: readonly string[];
  readonly body: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly reviewSuggestions?: readonly QuestionReviewSuggestion[];
  readonly rubric?: Record<string, unknown> | null;
  readonly scoring?: Record<string, unknown> | null;
  readonly qtiXml: string;
  readonly note?: string | null;
  readonly draftState?: 'draft' | 'ready' | 'published';
};

/** Identity facts returned after one immutable question revision is persisted. */
export type SavedQuestionRevision = {
  readonly questionId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly title: string;
  readonly tags: readonly string[];
};

/** Raised when a revision command targets an item whose lifecycle is locked. */
export class ArchivedQuestionError extends Error {
  readonly _tag = 'ArchivedQuestionError' as const;

  constructor(readonly questionId: string) {
    super('Restore this item before publishing another revision.');
    this.name = 'ArchivedQuestionError';
  }
}

type OpenedWrite<Input extends QuestionRevisionWriteInput> = {
  readonly input: Input & { readonly bankProjection: QuestionBankRevisionProjection };
  readonly questionId: string;
  readonly intent: QuestionRevisionProvenanceIntent;
};

type QuestionRevisionPersistenceRequest<Input extends QuestionRevisionWriteInput> = {
  readonly prepared: PreparedQuestionRevision<Input>;
  readonly intent: QuestionRevisionProvenanceIntent;
};

/** One prepared revision plus the explicit provenance command authorized by its caller. */
export type ExplicitQuestionRevisionPersistenceRequest<
  Input extends QuestionRevisionWriteInput,
> = {
  readonly prepared: PreparedQuestionRevision<Input>;
  readonly command: QuestionProvenanceResolutionCommand;
};

type PersistedProvenanceRow = {
  readonly id: string;
  readonly questionId: string;
  readonly revision: number;
  readonly provenance: unknown;
};

const MAX_AUTHORED_QUESTION_REFRESH_BATCH_SIZE = 100;
const MAX_EXPLICIT_QUESTION_REVISION_BATCH_SIZE = 100;

/** Persist one explicitly authorized question revision inside a caller-owned transaction. */
export async function persistQuestionRevisionInTransaction<
  Input extends QuestionRevisionWriteInput,
>(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  prepared: PreparedQuestionRevision<Input>,
  command: QuestionProvenanceResolutionCommand,
): Promise<SavedQuestionRevision> {
  const saved = await persistExplicitQuestionRevisionsInTransaction(tx, ctx, [{
    prepared,
    command,
  }]);
  const result = saved[0];
  if (!result) throw new Error('Question revision persistence returned no result.');
  return result;
}

/** Persist prepared revisions with explicit provenance through one set-based transaction engine. */
export async function persistExplicitQuestionRevisionsInTransaction<
  Input extends QuestionRevisionWriteInput,
>(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  requests: readonly ExplicitQuestionRevisionPersistenceRequest<Input>[],
): Promise<readonly SavedQuestionRevision[]> {
  const saved: SavedQuestionRevision[] = [];
  for (
    let offset = 0;
    offset < requests.length;
    offset += MAX_EXPLICIT_QUESTION_REVISION_BATCH_SIZE
  ) {
    const batch = requests
      .slice(offset, offset + MAX_EXPLICIT_QUESTION_REVISION_BATCH_SIZE)
      .map(({ prepared, command }) => ({
        prepared,
        intent: { _tag: 'Explicit' as const, command },
      }));
    saved.push(...await persistQuestionRevisionsInTransaction(tx, ctx, batch));
  }
  return saved;
}

/** Refresh a bounded set of trusted authored questions inside one transaction. */
export function refreshAuthoredQuestionRevisionsInTransaction<
  Input extends QuestionRevisionWriteInput,
>(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  prepared: readonly PreparedQuestionRevision<Input>[],
): Promise<readonly SavedQuestionRevision[]> {
  if (prepared.length > MAX_AUTHORED_QUESTION_REFRESH_BATCH_SIZE) {
    throw new Error(
      `Authored question refresh exceeds the ${MAX_AUTHORED_QUESTION_REFRESH_BATCH_SIZE}-item limit.`,
    );
  }
  return persistQuestionRevisionsInTransaction(
    tx,
    ctx,
    prepared.map((revision) => ({
      prepared: revision,
      intent: { _tag: 'EnsureAuthoredRevision' as const },
    })),
  );
}

/**
 * Persist a bounded revision set through one canonical transaction engine. The same complete-history
 * validation, provenance policy, and row projection apply to single writes and set-based batches.
 */
async function persistQuestionRevisionsInTransaction<
  Input extends QuestionRevisionWriteInput,
>(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  requests: readonly QuestionRevisionPersistenceRequest<Input>[],
): Promise<readonly SavedQuestionRevision[]> {
  if (requests.length === 0) return [];

  const writes: readonly OpenedWrite<Input>[] = requests.map((request) => {
    const input = openPreparedQuestionRevision(request.prepared);
    return {
      input,
      questionId: input.questionId ?? crypto.randomUUID(),
      intent: request.intent,
    };
  });
  for (const write of writes) {
    if (write.input.body.answerFeedback === undefined) continue;
    const unfinished = write.input.draftState === 'draft';
    const feedback = (unfinished ? parseAnswerFeedbackDraft : parseAnswerFeedback)(
      write.input.body.answerFeedback,
    );
    if (!feedback.ok) throw new Error('Invalid answer feedback.');
    await requireOwnedContentAssets(
      tx,
      ctx,
      [feedback.value.correct?.media, feedback.value.incorrect?.media].filter((media) =>
        media !== null && media !== undefined
      ),
      undefined,
      { allowIncompleteDraftReferences: unfinished },
    );
  }
  const questionIds = writes.map((write) => write.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    throw new Error('Question revision batch contains duplicate question IDs.');
  }

  const tenantId = ctx.tenantId;
  const ownerUserId = resolveUserId(ctx);
  const now = new Date();
  const initialQuestionRows: Array<typeof questions.$inferInsert> = writes.map((write) => ({
    id: write.questionId,
    tenantId,
    stableKey: write.input.stableKey ?? write.questionId,
    title: write.input.title,
    tags: normalizeQuestionTags(write.input.tags),
    ownerUserId,
    lifecycleState: 'active',
    createdAt: now,
    updatedAt: now,
  }));
  await tx.insert(questions).values(initialQuestionRows).onConflictDoNothing();

  const lockedQuestions = await tx.select({
    id: questions.id,
    tenantId: questions.tenantId,
    lifecycleState: questions.lifecycleState,
    latestRevisionId: questions.latestRevisionId,
  }).from(questions)
    .where(inArray(questions.id, questionIds))
    .orderBy(asc(questions.id))
    .for('update');
  if (lockedQuestions.length !== questionIds.length) {
    throw new Error('Question revision batch could not resolve every question.');
  }
  const questionsById = new Map(lockedQuestions.map((question) => [question.id, question]));
  for (const questionId of questionIds) {
    const question = questionsById.get(questionId);
    if (!question || question.tenantId !== tenantId) throw new Error('Question not found');
    if (question.lifecycleState === 'archived') throw new ArchivedQuestionError(questionId);
  }

  const persistedRows = await tx.select({
    id: questionRevisions.id,
    questionId: questionRevisions.questionId,
    revision: questionRevisions.revision,
    provenance: questionRevisions.provenance,
  }).from(questionRevisions).where(and(
    eq(questionRevisions.tenantId, tenantId),
    inArray(questionRevisions.questionId, questionIds),
  )).orderBy(asc(questionRevisions.questionId), asc(questionRevisions.revision));
  const historyRowsByQuestionId = groupProvenanceRows(persistedRows);
  const author = await loadQuestionActorSnapshotInTransaction(tx, ownerUserId);

  const revisionRows: Array<typeof questionRevisions.$inferInsert> = [];
  const questionUpdateRows: Array<typeof questions.$inferInsert> = [];
  const results: SavedQuestionRevision[] = [];
  for (const write of writes) {
    const question = questionsById.get(write.questionId);
    if (!question) throw new Error('Question not found');
    const history = parseQuestionHistoryState(
      historyRowsByQuestionId.get(write.questionId) ?? [],
      question.latestRevisionId,
    );
    const provenance = resolveQuestionRevisionProvenance(author, write.intent, history);
    const revision = (history.parent?.revision ?? 0) + 1;
    const revisionId = crypto.randomUUID();
    const draftState = write.input.draftState ?? 'published';
    const tags = normalizeQuestionTags(write.input.tags);

    revisionRows.push({
      id: revisionId,
      questionId: write.questionId,
      tenantId,
      draftState,
      revision,
      body: write.input.body,
      rubric: write.input.rubric ?? null,
      scoring: write.input.scoring ?? null,
      metadata: write.input.metadata ?? null,
      reviewSuggestions: (write.input.reviewSuggestions ?? []) as unknown as Array<
        Record<string, unknown>
      >,
      // SAFETY: provenance is produced by the canonical domain resolver above.
      provenance: provenance as unknown as Record<string, unknown>,
      contentHash: write.input.bankProjection.contentHash,
      searchText: write.input.bankProjection.searchText,
      compatibility: write.input.bankProjection.compatibility.map((entry) => ({
        targetId: entry.targetId,
        targetContractId: entry.targetContractId,
        outcome: entry.outcome,
        diagnosticCodes: [...entry.diagnosticCodes],
      })),
      qtiXml: write.input.qtiXml,
      note: write.input.note ?? null,
      createdAt: now,
      updatedAt: now,
      publishedAt: draftState === 'published' ? now : null,
    });
    questionUpdateRows.push({
      id: write.questionId,
      tenantId,
      stableKey: write.input.stableKey ?? write.questionId,
      title: write.input.title,
      tags,
      ownerUserId,
      lifecycleState: 'active',
      latestRevisionId: revisionId,
      createdAt: now,
      updatedAt: now,
    });
    results.push({
      questionId: write.questionId,
      revision,
      revisionId,
      title: write.input.title,
      tags,
    });
  }

  await tx.insert(questionRevisions).values(revisionRows);
  await tx.insert(questions).values(questionUpdateRows).onConflictDoUpdate({
    target: questions.id,
    set: {
      latestRevisionId: sql`excluded.latest_revision_id`,
      title: sql`excluded.title`,
      tags: sql`excluded.tags`,
      updatedAt: now,
    },
  });
  const published = revisionRows.filter((row) => row.draftState === 'published').map((row) =>
    row.questionId
  );
  await queueSavedQuestionOrganization(tx, ctx, published, now);
  return results;
}

function groupProvenanceRows(
  rows: readonly PersistedProvenanceRow[],
): ReadonlyMap<string, readonly PersistedProvenanceRow[]> {
  const grouped = new Map<string, PersistedProvenanceRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.questionId);
    if (group) group.push(row);
    else grouped.set(row.questionId, [row]);
  }
  return grouped;
}

function parseQuestionHistoryState(
  rows: readonly PersistedProvenanceRow[],
  latestRevisionId: string | null,
): QuestionProvenanceHistoryState {
  if (rows.length === 0) {
    if (latestRevisionId !== null) {
      throw new Error('Question latest revision pointer has no matching history.');
    }
    return { origin: null, parent: null, entries: new Map() };
  }
  const history = parseQuestionProvenanceHistory(rows);
  const latest = rows.at(-1);
  if (!latest || latest.id !== latestRevisionId) {
    throw new Error('Question latest revision pointer does not match its complete history.');
  }
  const entry = history.entries.get(latest.revision);
  if (!entry) throw new Error('Question history contains a missing revision.');
  return {
    entries: history.entries,
    origin: history.origin,
    parent: { revision: latest.revision, event: entry.event },
  };
}

function normalizeQuestionTags(tags?: readonly string[] | null): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)));
}
