import {
  type ParsedQuestionProvenanceHistory,
  parseQuestionProvenanceHistory,
} from '../question_provenance_history.ts';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { db, type DbReadConnection } from '../db.ts';
import { questionRevisions, questions } from '../db/schema.ts';
import {
  normalizePlacementRevisionSelectors,
  type PlacementQuestionView,
  type PlacementRevisionReference,
  projectPlacementQuestionViews,
} from '../placement_question_views.ts';
import { loadPlacementQuestionRevisionRows } from './placement_question_revision_rows.ts';
import { parseTimestamp } from '../persistence_parse.ts';
import {
  hydrateQuestionProvenance,
  parseQuestionProvenanceEntry,
  type QuestionActorSnapshot,
  type QuestionOrigin,
  questionOriginFromEntry,
  type QuestionProvenance,
  type QuestionProvenanceCommand,
  type QuestionProvenanceEntry,
  type QuestionRevisionEvent,
  type VariantQuestionProvenanceCommand,
} from '../question_provenance.ts';
import {
  openVerifiedImportedQuestionRevision,
  type VerifiedImportedQuestionRevision,
} from '../import/imported_question_revision.ts';
import { labelForTypeId } from '../types/registry.ts';
import type { QuestionTypeId } from '../types/registry.ts';
import {
  parseQuestionReviewSuggestions,
  type QuestionReviewSuggestion,
} from '../question_review_types.ts';
import type { RequestContext } from '../tenants.ts';
import {
  compatibleVariantTypes,
  copyQuestionSourceXml,
  isExactQuestionVariantTransformation,
  parseQuestionVariantDraft,
} from '../question_variants.ts';
import { canonicalJsonStringify, projectJsonPersistenceObject } from '../canonical_json.ts';
import { buildItemXmlFromPreparedDraft, prepareDriverDraft } from '../qti_build.ts';
import type { Draft } from '../types/draft.ts';
import {
  parseQuestionCompatibility,
  QUESTION_LIFECYCLE_STATES,
  type QuestionCompatibilityProjection,
  type QuestionLifecycleState,
} from '../question_bank.ts';
import {
  openPreparedQuestionRevision,
  type PreparedQuestionRevision,
} from '../question_revision_preparation.ts';
import {
  persistExplicitQuestionRevisionsInTransaction,
  persistQuestionRevisionInTransaction,
  type QuestionRevisionWriteInput,
  type SavedQuestionRevision,
} from './question_revision_persistence.ts';

export { ArchivedQuestionError } from './question_revision_persistence.ts';

export type QuestionMeta = {
  id: string;
  title: string;
  tags: string[];
  latestRevision: number;
  updatedAt: string;
  questionType?: string;
};

export type { PlacementQuestionView, PlacementRevisionReference };

export type QuestionRevisionRecord = {
  id: string;
  questionId: string;
  revision: number;
  qtiXml: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  draftState: 'draft' | 'ready' | 'published';
  body: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  reviewSuggestions: readonly QuestionReviewSuggestion[];
  provenance: QuestionProvenance;
  contentHash: string;
  compatibility: readonly QuestionCompatibilityProjection[];
};

/** Bounded current-revision facts required to prepare one question publication. */
export type QuestionPublicationBaseline = {
  readonly questionId: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly revision: {
    readonly id: string;
    readonly number: number;
    readonly qtiXml: string;
    readonly event: QuestionRevisionEvent;
  };
};

/** Exact source revision plus current question state used by revision-draft publication. */
export type QuestionRevisionPublicationSource = {
  readonly baseline: QuestionPublicationBaseline;
  readonly latestRevisionId: string;
  readonly lifecycle: QuestionLifecycleState;
};

type SaveQuestionRevisionInput = QuestionRevisionWriteInput & {
  readonly provenance: QuestionProvenanceCommand;
};

type SaveVariantQuestionRevisionInput = Omit<SaveQuestionRevisionInput, 'provenance'>;

/** Authored revision input whose derived bank projection is ready for a transaction. */
export type PreparedSaveQuestionRevisionInput = PreparedQuestionRevision<
  SaveQuestionRevisionInput
>;

type PreparedVariantQuestionRevisionInput = PreparedQuestionRevision<
  SaveVariantQuestionRevisionInput
>;

export type QuestionRevisionHistoryEntry =
  & {
    readonly id: string;
    readonly questionId: string;
    readonly revision: number;
    readonly note: string | null;
    readonly createdAt: string;
    readonly event: QuestionRevisionEvent;
  }
  & (
    | {
      readonly draftState: 'published';
      readonly publishedAt: string;
    }
    | {
      readonly draftState: 'draft' | 'ready';
      readonly publishedAt: null;
    }
  );

/** One consistent, tenant-scoped history aggregate for the item detail page. */
export type QuestionRevisionHistory = {
  readonly questionId: string;
  readonly origin: QuestionOrigin;
  readonly createdBy: QuestionActorSnapshot;
  readonly latest: {
    readonly revision: number;
    readonly qtiXml: string;
    readonly body: Record<string, unknown>;
  };
  readonly revisions: readonly QuestionRevisionHistoryEntry[];
  readonly beforeRevision: number | null;
  readonly nextBeforeRevision: number | null;
};

const QUESTION_REVISION_HISTORY_PAGE_SIZE = 20;

/** Transaction handle accepted by question persistence operations. */
export type QuestionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Persists one question revision inside a caller-owned transaction. */
export async function saveQuestionRevisionInTransaction(
  tx: QuestionTransaction,
  ctx: RequestContext,
  input: PreparedSaveQuestionRevisionInput,
) {
  const prepared = openPreparedQuestionRevision(input);
  return await persistQuestionRevisionInTransaction(tx, ctx, input, prepared.provenance);
}

/** Persist imported revisions in bounded, set-based batches inside a caller-owned transaction. */
export async function saveImportedQuestionRevisionsInTransaction(
  tx: QuestionTransaction,
  ctx: RequestContext,
  revisions: readonly VerifiedImportedQuestionRevision[],
): Promise<readonly SavedQuestionRevision[]> {
  const requests = revisions.map((revision) => {
    const verified = openVerifiedImportedQuestionRevision(revision);
    return { prepared: verified.input, command: verified.provenance };
  });
  return await persistExplicitQuestionRevisionsInTransaction(tx, ctx, requests);
}

/** Persists a new variant only after verifying its exact source revision and type transform. */
export async function saveVariantQuestionRevisionInTransaction(
  tx: QuestionTransaction,
  ctx: RequestContext,
  input: PreparedVariantQuestionRevisionInput,
  source: { readonly questionId: string; readonly revision: number },
  targetType: QuestionTypeId,
) {
  const prepared = openPreparedQuestionRevision(input);
  const rows = await tx.select({
    body: questionRevisions.body,
    qtiXml: questionRevisions.qtiXml,
    provenance: questionRevisions.provenance,
  })
    .from(questionRevisions)
    .innerJoin(questions, eq(questions.id, questionRevisions.questionId))
    .where(and(
      eq(questionRevisions.questionId, source.questionId),
      eq(questionRevisions.revision, source.revision),
      eq(questionRevisions.tenantId, ctx.tenantId),
      eq(questions.tenantId, ctx.tenantId),
    ))
    .limit(1);
  if (!rows.length) throw new VariantQuestionSourceNotFoundError();

  const sourceDraft = parseQuestionVariantDraft(rows[0].body, 'source');
  const targetDraft = parseQuestionVariantDraft(
    projectJsonPersistenceObject(prepared.body),
    'target',
  );
  if (!compatibleVariantTypes(sourceDraft).includes(targetDraft.type)) {
    throw new IncompatibleQuestionVariantError(sourceDraft.type, targetDraft.type);
  }
  if (!isExactQuestionVariantTransformation(sourceDraft, targetDraft, targetType)) {
    throw new VariantQuestionContentMismatchError();
  }
  const sameType = sourceDraft.type === targetType;
  if (sameType && rows[0].qtiXml === null) throw new VariantQuestionContentMismatchError();
  assertVariantPublication(prepared, targetDraft, targetType, sameType ? rows[0].qtiXml : null);
  const provenance: VariantQuestionProvenanceCommand = {
    _tag: 'Variant',
    contentBasis: sameType
      ? parseQuestionProvenanceEntry(rows[0].provenance).event.contentBasis
      : 'qflow',
    origin: {
      _tag: 'Variant',
      source,
      transformation: {
        kind: sourceDraft.type === targetDraft.type
          ? 'construct_preserving_variant'
          : 'compatible_type_transform',
        fromType: sourceDraft.type,
        toType: targetDraft.type,
      },
    },
  };
  return await persistQuestionRevisionInTransaction(tx, ctx, input, provenance);
}

function assertVariantPublication(
  input: SaveVariantQuestionRevisionInput,
  targetDraft: Draft & { readonly type: QuestionTypeId },
  targetType: QuestionTypeId,
  sourceXml: string | null,
): void {
  const identifier = input.metadata?.identifier;
  if (typeof identifier !== 'string' || !identifier) {
    throw new VariantQuestionContentMismatchError();
  }
  const expectedMetadata = {
    identifier,
    type: targetType,
    responseMode: targetDraft.responseMode ?? 'all_or_nothing',
    preservedSourceXml: sourceXml !== null,
  };
  if (
    canonicalJsonStringify(projectJsonPersistenceObject(input.metadata ?? {})) !==
      canonicalJsonStringify(expectedMetadata)
  ) {
    throw new VariantQuestionContentMismatchError();
  }
  if (sourceXml !== null) {
    const copied = copyQuestionSourceXml(sourceXml, identifier);
    if (!copied.ok || copied.xml !== input.qtiXml) throw new VariantQuestionContentMismatchError();
    return;
  }
  const prepared = prepareDriverDraft(targetDraft);
  if (!prepared.ok) throw new VariantQuestionContentMismatchError();
  const built = buildItemXmlFromPreparedDraft(prepared.prepared, {
    identifier,
    scoring: targetDraft.responseMode === 'partial' ? 'map_response' : 'match_correct',
  });
  if (!built.ok || built.xml !== input.qtiXml) {
    throw new VariantQuestionContentMismatchError();
  }
}

/** Raised when the exact source revision for a requested variant is unavailable. */
export class VariantQuestionSourceNotFoundError extends Error {
  constructor() {
    super('Variant source question revision not found.');
    this.name = 'VariantQuestionSourceNotFoundError';
  }
}

/** Raised when a requested type transform would change the question construct. */
export class IncompatibleQuestionVariantError extends Error {
  constructor(readonly fromType: QuestionTypeId, readonly toType: QuestionTypeId) {
    super(`No construct-preserving transform exists from ${fromType} to ${toType}.`);
    this.name = 'IncompatibleQuestionVariantError';
  }
}

/** Raised when caller-supplied target content is not the exact server-owned variant. */
export class VariantQuestionContentMismatchError extends Error {
  constructor() {
    super('QFlowLearn could not verify this variant against its source revision.');
    this.name = 'VariantQuestionContentMismatchError';
  }
}

export async function getQuestionMeta(
  ctx: RequestContext,
  id: string,
): Promise<QuestionMeta | null> {
  const tenantId = ctx.tenantId;
  const row = await db.select({
    id: questions.id,
    title: questions.title,
    tags: questions.tags,
    updatedAt: questions.updatedAt,
    latestRevision: questionRevisions.revision,
    body: questionRevisions.body,
  })
    .from(questions)
    .leftJoin(questionRevisions, eq(questionRevisions.id, questions.latestRevisionId))
    .where(and(eq(questions.id, id), eq(questions.tenantId, tenantId)))
    .limit(1);
  if (!row.length) return null;
  return mapMetaRow(row[0]);
}

export async function getQuestionMetas(
  ctx: RequestContext,
  ids: string[],
): Promise<QuestionMeta[]> {
  const rows = await selectQuestionMetaRows(ctx, ids);
  return rows.map(mapMetaRow);
}

/** Loads the exact pinned or latest revision displayed by each assessment placement. */
export async function getPlacementQuestionViews(
  ctx: RequestContext,
  references: ReadonlyArray<PlacementRevisionReference>,
): Promise<Record<string, PlacementQuestionView>> {
  if (references.length === 0) return {};
  const selection = normalizePlacementRevisionSelectors(references);
  const rows = await loadPlacementQuestionRevisionRows(db, ctx.tenantId, selection);
  return projectPlacementQuestionViews(references, rows);
}

export async function getQuestionRevision(
  ctx: RequestContext,
  id: string,
  revision?: number,
): Promise<QuestionRevisionRecord | null> {
  const tenantId = ctx.tenantId;
  const conditions = [
    eq(questionRevisions.questionId, id),
    eq(questionRevisions.tenantId, tenantId),
  ];
  if (revision !== undefined) conditions.push(eq(questionRevisions.revision, revision));
  const rows = await db.select().from(questionRevisions)
    .where(and(...conditions))
    .orderBy(desc(questionRevisions.revision))
    .limit(1);
  if (!rows.length) return null;
  const row = rows[0];
  const history = await loadQuestionProvenanceHistory(ctx, row.questionId);
  return mapRevisionRow(row, history);
}

/** Loads the current revision through one bounded projection for publication preparation. */
export async function getQuestionPublicationBaseline(
  ctx: RequestContext,
  questionId: string,
): Promise<QuestionPublicationBaseline | null> {
  const rows = await db.select({
    questionId: questions.id,
    title: questions.title,
    tags: questions.tags,
    revisionId: questionRevisions.id,
    revision: questionRevisions.revision,
    qtiXml: questionRevisions.qtiXml,
    draftState: questionRevisions.draftState,
    provenance: questionRevisions.provenance,
  }).from(questions)
    .leftJoin(
      questionRevisions,
      and(
        eq(questionRevisions.id, questions.latestRevisionId),
        eq(questionRevisions.tenantId, questions.tenantId),
      ),
    )
    .where(and(eq(questions.id, questionId), eq(questions.tenantId, ctx.tenantId)))
    .limit(1);
  if (!rows.length) return null;
  return parseQuestionPublicationBaseline(rows[0]);
}

/** Loads one exact source revision without hydrating its complete immutable history. */
export async function getQuestionRevisionPublicationSource(
  ctx: RequestContext,
  revisionId: string,
): Promise<QuestionRevisionPublicationSource | null> {
  const rows = await db.select({
    questionId: questions.id,
    title: questions.title,
    tags: questions.tags,
    latestRevisionId: questions.latestRevisionId,
    lifecycle: questions.lifecycleState,
    revisionId: questionRevisions.id,
    revision: questionRevisions.revision,
    qtiXml: questionRevisions.qtiXml,
    draftState: questionRevisions.draftState,
    provenance: questionRevisions.provenance,
  }).from(questionRevisions)
    .innerJoin(
      questions,
      and(
        eq(questions.id, questionRevisions.questionId),
        eq(questions.tenantId, questionRevisions.tenantId),
      ),
    )
    .where(and(
      eq(questionRevisions.id, revisionId),
      eq(questionRevisions.tenantId, ctx.tenantId),
    ))
    .limit(1);
  if (!rows.length) return null;
  const row = rows[0];
  if (!row.latestRevisionId) throw new Error('Question is missing its latest revision.');
  return {
    baseline: parseQuestionPublicationBaseline(row),
    latestRevisionId: row.latestRevisionId,
    lifecycle: parseQuestionLifecycleState(row.lifecycle),
  };
}

function parseQuestionPublicationBaseline(row: {
  readonly questionId: string;
  readonly title: string;
  readonly tags: string[];
  readonly revisionId: string | null;
  readonly revision: number | null;
  readonly qtiXml: string | null;
  readonly draftState: string | null;
  readonly provenance: Record<string, unknown> | null;
}): QuestionPublicationBaseline {
  if (
    !row.revisionId || row.revision === null || row.qtiXml === null || row.provenance === null ||
    row.draftState !== 'published'
  ) {
    throw new Error('Question is missing its current published revision.');
  }
  const entry = parseQuestionProvenanceEntry(row.provenance);
  validatePagedProvenanceEntry(row.revision, entry);
  return {
    questionId: row.questionId,
    title: row.title,
    tags: [...row.tags],
    revision: {
      id: row.revisionId,
      number: row.revision,
      qtiXml: row.qtiXml,
      event: entry.event,
    },
  };
}

function parseQuestionLifecycleState(value: string): QuestionLifecycleState {
  const state = QUESTION_LIFECYCLE_STATES.find((candidate) => candidate === value);
  if (!state) throw new Error('Question lifecycle state is invalid.');
  return state;
}

/** Load the exact immutable body and QTI used by a revision comparison in its authorized snapshot. */
export async function getQuestionRevisionSnapshot(
  ctx: RequestContext,
  questionId: string,
  revision: number,
  conn: DbReadConnection = db,
): Promise<{ readonly body: Record<string, unknown>; readonly qtiXml: string } | null> {
  const [row] = await conn.select({
    body: questionRevisions.body,
    qtiXml: questionRevisions.qtiXml,
  }).from(questionRevisions)
    .where(
      and(
        eq(questionRevisions.questionId, questionId),
        eq(questionRevisions.revision, revision),
        eq(questionRevisions.tenantId, ctx.tenantId),
      ),
    ).limit(1);
  return row ?? null;
}

/** Load one bounded history page plus the item's immutable origin and latest content. */
export async function getQuestionRevisionHistory(
  ctx: RequestContext,
  questionId: string,
  options: { readonly beforeRevision?: number } = {},
  conn: DbReadConnection = db,
): Promise<QuestionRevisionHistory | null> {
  if (
    options.beforeRevision !== undefined &&
    (!Number.isInteger(options.beforeRevision) || options.beforeRevision < 2)
  ) {
    return null;
  }
  const pageConditions = [
    eq(questionRevisions.questionId, questionId),
    eq(questionRevisions.tenantId, ctx.tenantId),
  ];
  if (options.beforeRevision !== undefined) {
    pageConditions.push(lt(questionRevisions.revision, options.beforeRevision));
  }
  const historyColumns = {
    id: questionRevisions.id,
    questionId: questionRevisions.questionId,
    revision: questionRevisions.revision,
    note: questionRevisions.note,
    createdAt: questionRevisions.createdAt,
    publishedAt: questionRevisions.publishedAt,
    draftState: questionRevisions.draftState,
    provenance: questionRevisions.provenance,
  } as const;
  const [firstRows, latestRows, pageRows] = await Promise.all([
    conn.select({ revision: questionRevisions.revision, provenance: questionRevisions.provenance })
      .from(questionRevisions)
      .where(and(
        eq(questionRevisions.questionId, questionId),
        eq(questionRevisions.revision, 1),
        eq(questionRevisions.tenantId, ctx.tenantId),
      ))
      .limit(1),
    conn.select({
      revision: questionRevisions.revision,
      qtiXml: questionRevisions.qtiXml,
      body: questionRevisions.body,
      provenance: questionRevisions.provenance,
    })
      .from(questions)
      .innerJoin(
        questionRevisions,
        and(
          eq(questionRevisions.id, questions.latestRevisionId),
          eq(questionRevisions.tenantId, questions.tenantId),
        ),
      )
      .where(and(eq(questions.id, questionId), eq(questions.tenantId, ctx.tenantId)))
      .limit(1),
    conn.select(historyColumns)
      .from(questionRevisions)
      .where(and(...pageConditions))
      .orderBy(desc(questionRevisions.revision))
      .limit(QUESTION_REVISION_HISTORY_PAGE_SIZE + 1),
  ]);
  if (latestRows.length === 0) return null;
  if (firstRows.length !== 1) throw new Error('Question history is missing its first revision.');
  const firstRevision = firstRows[0];
  const firstEntry = parseQuestionProvenanceEntry(firstRevision.provenance);
  if (
    Number(firstRevision.revision) !== 1 || firstEntry.event.operation !== 'created' ||
    !('origin' in firstEntry)
  ) {
    throw new Error('Question history has an invalid first revision.');
  }
  const hasOlderRevisions = pageRows.length > QUESTION_REVISION_HISTORY_PAGE_SIZE;
  const page = pageRows.slice(0, QUESTION_REVISION_HISTORY_PAGE_SIZE);
  const revisions = page.map((row) => {
    const entry = parseQuestionProvenanceEntry(row.provenance);
    validatePagedProvenanceEntry(Number(row.revision), entry);
    return mapHistoryRow(row, entry);
  });
  const latest = latestRows[0];
  validatePagedProvenanceEntry(
    Number(latest.revision),
    parseQuestionProvenanceEntry(latest.provenance),
  );
  return {
    questionId,
    origin: questionOriginFromEntry(firstEntry),
    createdBy: firstEntry.event.author,
    latest: {
      revision: Number(latest.revision),
      qtiXml: latest.qtiXml,
      body: latest.body,
    },
    revisions,
    beforeRevision: options.beforeRevision ?? null,
    nextBeforeRevision: hasOlderRevisions ? revisions.at(-1)?.revision ?? null : null,
  };
}

function validatePagedProvenanceEntry(
  revision: number,
  entry: QuestionProvenanceEntry,
): void {
  if (revision === 1) {
    if (entry.event.operation !== 'created' || !('origin' in entry)) {
      throw new Error('Question history has an invalid first revision.');
    }
    return;
  }
  if (
    entry.event.operation === 'created' || 'origin' in entry ||
    entry.event.parentRevision !== revision - 1
  ) {
    throw new Error('Question history contains a contradictory revision.');
  }
}

async function loadQuestionProvenanceHistory(
  ctx: RequestContext,
  questionId: string,
): Promise<ParsedQuestionProvenanceHistory> {
  const rows = await db.select({
    revision: questionRevisions.revision,
    provenance: questionRevisions.provenance,
  })
    .from(questionRevisions)
    .where(and(
      eq(questionRevisions.questionId, questionId),
      eq(questionRevisions.tenantId, ctx.tenantId),
    ));
  return parseQuestionProvenanceHistory(rows);
}

function requireProvenanceEntry(
  history: ParsedQuestionProvenanceHistory,
  revision: number,
): QuestionProvenanceEntry {
  const entry = history.entries.get(revision);
  if (!entry) throw new Error('Question history contains a missing revision.');
  return entry;
}

function mapMetaRow(row: any): QuestionMeta {
  return {
    id: row.id,
    title: row.title ?? 'Untitled',
    tags: Array.isArray(row.tags) ? row.tags : [],
    latestRevision: Number(row.latestRevision ?? 0),
    updatedAt: toIso(row.updatedAt),
    questionType: labelForTypeId((row as any).body?.type),
  };
}

async function selectQuestionMetaRows(ctx: RequestContext, ids: string[]) {
  if (!ids.length) return [];
  return await db.select({
    id: questions.id,
    title: questions.title,
    tags: questions.tags,
    updatedAt: questions.updatedAt,
    latestRevision: questionRevisions.revision,
    body: questionRevisions.body,
  })
    .from(questions)
    .leftJoin(questionRevisions, eq(questionRevisions.id, questions.latestRevisionId))
    .where(and(eq(questions.tenantId, ctx.tenantId), inArray(questions.id, ids)));
}

type QuestionRevisionRow = typeof questionRevisions.$inferSelect;

function mapHistoryRow(row: {
  readonly id: string;
  readonly questionId: string;
  readonly revision: number;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
  readonly draftState: string;
}, provenance: QuestionProvenanceEntry): QuestionRevisionHistoryEntry {
  const event = provenance.event;
  const createdAt = toIso(row.createdAt);
  const draftState = parseDraftState(row.draftState);
  const base = {
    id: row.id,
    questionId: row.questionId,
    revision: Number(row.revision),
    note: row.note ?? null,
    createdAt,
    event,
  };
  if (draftState === 'published') {
    if (!row.publishedAt) {
      throw new Error('Published question revision is missing its publication timestamp.');
    }
    return {
      ...base,
      draftState,
      publishedAt: toIso(row.publishedAt),
    };
  }
  if (row.publishedAt) {
    throw new Error('Unpublished question revision cannot have a publication timestamp.');
  }
  return { ...base, draftState, publishedAt: null };
}

function mapRevisionRow(
  row: QuestionRevisionRow,
  history: ParsedQuestionProvenanceHistory,
): QuestionRevisionRecord {
  const provenance = requireProvenanceEntry(history, row.revision);
  const draftState = parseDraftState(row.draftState);
  if (
    (draftState === 'published' && !row.publishedAt) ||
    (draftState !== 'published' && row.publishedAt)
  ) {
    throw new Error('Question revision contains contradictory publication timestamps.');
  }
  return {
    id: row.id,
    questionId: row.questionId,
    revision: Number(row.revision),
    qtiXml: row.qtiXml,
    note: row.note ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    draftState,
    body: row.body,
    metadata: row.metadata,
    reviewSuggestions: parseQuestionReviewSuggestions(row.reviewSuggestions),
    provenance: hydrateQuestionProvenance(history.origin, provenance),
    contentHash: row.contentHash,
    compatibility: parseQuestionCompatibility(row.compatibility),
  };
}

function parseDraftState(value: string): QuestionRevisionRecord['draftState'] {
  if (value === 'draft' || value === 'ready' || value === 'published') return value;
  throw new Error(`Unsupported question revision state: ${value}`);
}

function toIso(value: unknown): string {
  return parseTimestamp(value, 'Persisted timestamp is invalid.');
}
