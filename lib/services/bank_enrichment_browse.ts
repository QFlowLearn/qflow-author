import { parseEnrichmentVocabularyChangeValue } from './bank_enrichment_change_contract.ts';
import { loadEnrichmentOverview } from './bank_enrichment_overview.ts';
import {
  listQuestionBank,
  type QuestionBankFacetPresentation,
  summarizeQuestionBank,
} from './question_bank_read.ts';
import { ENRICHMENT_VOCABULARY_KEYS } from './bank_enrichment_query_sql.ts';
import { validBankEnrichmentFilter } from './bank_enrichment_filter_access.ts';
import { sql } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { canReadEnrichment } from './bank_enrichment_access.ts';
import { type EnrichmentDimension, type EnrichmentResult } from './bank_enrichment_contract.ts';
import type {
  EnrichmentBankPage,
  EnrichmentBrowseCategory,
  EnrichmentBrowseFacet,
  EnrichmentBrowseScheme,
  EnrichmentBrowseValue,
  EnrichmentBrowseView,
  EnrichmentOverviewView,
  EnrichmentQuestionsView,
} from './bank_enrichment_browse_contract.ts';
import {
  enrichmentBrowseRowsSql,
  enrichmentBrowseScope,
  enrichmentBrowseStateCounts,
} from './bank_enrichment_browse_sql.ts';
import type { QuestionBankQuery, QuestionBankQuestionsQuery } from './question_bank_query.ts';
import { bankEnrichmentAlternatives, type BankEnrichmentFilter } from './bank_enrichment_query.ts';

const SCHEME_LIMIT = 100;
const CATEGORY_LIMIT = 1000;
type BrowseFailure = 'invalid_input' | 'forbidden' | 'not_found' | 'storage_failed';

/** Authorized, bounded bank projections with exact SQL-side counts across the entire scope. */
export class BankEnrichmentBrowse {
  constructor(private readonly database: QflowDatabase) {}

  /** A vocabulary selection supplies context; only its dimension filters narrow the bank. */
  async read(
    ctx: RequestContext,
    query: QuestionBankQuery,
    pageIds: readonly string[],
  ): Promise<EnrichmentResult<EnrichmentQuestionsView, BrowseFailure>> {
    if (
      pageIds.length > 100 || pageIds.some((id) => !isCanonicalUuid(id)) ||
      new Set(pageIds).size !== pageIds.length
    ) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<EnrichmentQuestionsView, BrowseFailure>> => {
          if (!await canReadEnrichment(tx, ctx, 'view_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const view = await this.load(tx, ctx, query);
          return view.ok
            ? { ok: true, value: await withQuestionRows(tx, ctx, view.value, pageIds) }
            : view;
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (cause: unknown) {
      console.error('Enrichment bank read failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }
  /** Table rows, totals and classification facets share one database snapshot while batches finish. */
  page(
    ctx: RequestContext,
    query: QuestionBankQuestionsQuery,
    presentation: QuestionBankFacetPresentation,
  ): Promise<EnrichmentResult<Extract<EnrichmentBankPage, { kind: 'questions' }>, BrowseFailure>>;
  page(
    ctx: RequestContext,
    query: QuestionBankQuery,
    presentation: QuestionBankFacetPresentation,
  ): Promise<EnrichmentResult<EnrichmentBankPage, BrowseFailure>>;
  async page(
    ctx: RequestContext,
    query: QuestionBankQuery,
    presentation: QuestionBankFacetPresentation,
  ): Promise<EnrichmentResult<EnrichmentBankPage, BrowseFailure>> {
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<EnrichmentBankPage, BrowseFailure>> => {
          if (!await canReadEnrichment(tx, ctx, 'view_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const view = await this.load(tx, ctx, query);
          if (!view.ok) return view;
          if (query.view === 'overview') {
            const [bank, enrichment] = await Promise.all([
              summarizeQuestionBank(ctx, query, presentation, tx),
              withOverview(tx, ctx, query, view.value),
            ]);
            return { ok: true, value: { kind: 'overview', bank, enrichment } };
          }
          const bank = await listQuestionBank(ctx, query, presentation, tx);
          const enrichment = await withQuestionRows(
            tx,
            ctx,
            view.value,
            bank.items.map((q) => q.id),
          );
          return { ok: true, value: { kind: 'questions', bank, enrichment } };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (cause: unknown) {
      console.error('Enrichment bank page failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }

  private async load(
    tx: QflowDatabaseTransaction,
    ctx: RequestContext,
    query: QuestionBankQuery,
  ): Promise<EnrichmentResult<EnrichmentBrowseView, BrowseFailure>> {
    const filter = query.enrichment;
    const schemeRows = await tx.execute<EnrichmentBrowseScheme>(sql`
          SELECT * FROM (
            SELECT DISTINCT ON (scheme_id) scheme_id AS id, id AS "versionId", version,
              definition ->> 'name' AS name, definition ->> 'audience' AS audience
            FROM bank_enrichment_scheme_versions WHERE tenant_id = ${ctx.tenantId}
            ORDER BY scheme_id, version DESC
          ) schemes
          ORDER BY (id = ${filter?.schemeId ?? null}::uuid) DESC NULLS LAST, name, id
          LIMIT ${SCHEME_LIMIT + 1}
        `);
    const schemes = schemeRows.slice(0, SCHEME_LIMIT).map(parseScheme);
    const view = { schemes, schemesTruncated: schemeRows.length > SCHEME_LIMIT };
    if (!filter) return { ok: true, value: { ...view, selection: null } };
    const scheme = schemes.find((row) => row.id === filter.schemeId);
    if (!scheme) return { ok: false, code: 'not_found' };
    if (!await validBankEnrichmentFilter(tx, ctx.tenantId, filter)) {
      return { ok: false, code: 'invalid_input' };
    }
    const [subject, topic, difficulty] = await Promise.all(
      (['subject', 'topic', 'difficulty'] as const).map((dimension) =>
        loadFacet(tx, ctx, query, scheme, filter, dimension)
      ),
    );
    return {
      ok: true,
      value: { ...view, selection: { scheme, facets: { subject, topic, difficulty } } },
    };
  }
}

async function withOverview(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  view: EnrichmentBrowseView,
): Promise<EnrichmentOverviewView> {
  const selection = view.selection;
  if (!selection) return { ...view, selection: null };
  const overview = await loadEnrichmentOverview(tx, ctx, query, selection.scheme);
  return { ...view, selection: { ...selection, overview } };
}

async function withQuestionRows(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  view: EnrichmentBrowseView,
  pageIds: readonly string[],
): Promise<EnrichmentQuestionsView> {
  const selection = view.selection;
  if (!selection) return { ...view, selection: null };
  const load = async (dimension: EnrichmentDimension) => {
    const values = pageIds.length
      ? await tx.execute<BrowseRow>(
        enrichmentBrowseRowsSql(ctx.tenantId, selection.scheme.id, pageIds, dimension),
      )
      : [];
    if (values.length !== pageIds.length) throw new Error('Missing enrichment page question.');
    const rows = new Map<string, EnrichmentBrowseValue>();
    for (const row of values) {
      if (!pageIds.includes(row.id) || rows.has(row.id)) {
        throw new Error('Invalid enrichment page identity.');
      }
      rows.set(row.id, parseRow(row, dimension));
    }
    return rows;
  };
  const [subject, topic, difficulty] = await Promise.all([
    load('subject'),
    load('topic'),
    load('difficulty'),
  ]);
  const rows = Object.fromEntries(pageIds.map((id) => {
    const s = subject.get(id), t = topic.get(id), d = difficulty.get(id);
    if (!s || !t || !d) throw new Error('Missing enrichment page dimension.');
    return [id, { subject: s, topic: t, difficulty: d }];
  }));
  return { ...view, selection: { ...selection, rows } };
}

async function loadFacet(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  query: QuestionBankQuery,
  scheme: EnrichmentBrowseScheme,
  filter: BankEnrichmentFilter,
  dimension: EnrichmentDimension,
): Promise<EnrichmentBrowseFacet> {
  const selected = filter[dimension];
  const alternatives = {
    ...query,
    enrichment: { ...filter, [dimension]: bankEnrichmentAlternatives(selected) },
  };
  const isSelected = selected?.kind === 'value'
    ? sql`ev.id = ${selected.versionId} AND category ->> 'id' = ${selected.valueId}`
    : sql`false::boolean`;
  const rows = await tx.execute<EnrichmentBrowseCategory>(sql`
    WITH bank AS (${enrichmentBrowseScope(tx, ctx, alternatives)}), counts AS (
      SELECT ec.version_id, value_id, count(*)::int AS total
      FROM bank
      JOIN bank_enrichment_assignments ea ON ea.tenant_id = ${ctx.tenantId} AND ea.scheme_id = ${scheme.id} AND ea.question_id = bank.id AND ea.dimension = ${dimension}
      JOIN bank_enrichment_changes ec ON ec.id = ea.change_id
      CROSS JOIN LATERAL jsonb_array_elements_text(ec.value -> 'valueIds') value_id
      WHERE ec.value ->> 'state' = 'assigned'
      GROUP BY ec.version_id, value_id
    )
    SELECT ev.id AS "versionId", ev.version, ev.definition ->> 'audience' AS audience,
      category ->> 'id' AS id, category ->> 'label' AS label, COALESCE(counts.total, 0)::int AS count
    FROM bank_enrichment_scheme_versions ev
    CROSS JOIN LATERAL jsonb_array_elements(ev.definition -> ${
    ENRICHMENT_VOCABULARY_KEYS[dimension]
  }) WITH ORDINALITY vocab(category, position)
    LEFT JOIN counts ON counts.version_id = ev.id AND counts.value_id = category ->> 'id'
    WHERE ev.tenant_id = ${ctx.tenantId} AND ev.scheme_id = ${scheme.id}
      AND (counts.total IS NOT NULL OR ev.id = ${scheme.versionId} OR (${isSelected}))
    ORDER BY (${isSelected}) DESC, ev.version DESC, position
    LIMIT ${CATEGORY_LIMIT + 1}
  `);
  const counts = await enrichmentBrowseStateCounts(tx, ctx, alternatives, scheme.id, dimension);
  if (Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error('Invalid enrichment counts.');
  }
  return {
    ...counts,
    categories: rows.slice(0, CATEGORY_LIMIT).map(parseCategory),
    truncated: rows.length > CATEGORY_LIMIT,
  };
}

function parseScheme(row: EnrichmentBrowseScheme): EnrichmentBrowseScheme {
  if (
    !isCanonicalUuid(row.id) || !isCanonicalUuid(row.versionId) || !positive(row.version) ||
    !text(row.name, 160) || !text(row.audience, 1000)
  ) throw new Error('Invalid enrichment bank vocabulary.');
  return row;
}
function parseCategory(row: EnrichmentBrowseCategory): EnrichmentBrowseCategory {
  if (
    !isCanonicalUuid(row.versionId) || !positive(row.version) || !text(row.audience, 1000) ||
    !parseLabel(row) || !Number.isSafeInteger(row.count) || row.count < 0
  ) throw new Error('Invalid enrichment bank category.');
  return row;
}
type BrowseRow = {
  id: string;
  value: unknown;
  versionId: string | null;
  version: number | null;
  audience: string | null;
  outdated: boolean | null;
  participated: boolean;
  vocabulary: unknown;
};
function parseRow(row: BrowseRow, dimension: EnrichmentDimension): EnrichmentBrowseValue {
  if (typeof row.participated !== 'boolean') throw new Error('Invalid enrichment participation.');
  if (row.value === null) return { state: row.participated ? 'pending' : 'outside' };
  if (
    !isCanonicalUuid(row.versionId) || !positive(row.version) || !text(row.audience, 1000) ||
    typeof row.outdated !== 'boolean' ||
    !Array.isArray(row.vocabulary) || row.vocabulary.length > 3
  ) throw new Error('Invalid enrichment bank assignment.');
  const vocabulary: { id: string; label: string }[] = [];
  for (const category of row.vocabulary) {
    const parsed = parseLabel(category);
    if (!parsed) throw new Error('Invalid enrichment bank label.');
    vocabulary.push(parsed);
  }
  const value = parseEnrichmentVocabularyChangeValue(row.value, dimension, vocabulary);
  if (!value) throw new Error('Invalid enrichment bank value.');
  if (value.state === 'absent') return { state: row.participated ? 'pending' : 'outside' };
  return {
    state: 'classified',
    value,
    versionId: row.versionId,
    categories: vocabulary,
    version: row.version,
    audience: row.audience,
    outdated: row.outdated,
  };
}
function parseLabel(value: unknown): { readonly id: string; readonly label: string } | null {
  if (
    typeof value !== 'object' || value === null || !('id' in value) || !('label' in value) ||
    typeof value.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.id) ||
    !text(value.label, 80)
  ) return null;
  return { id: value.id, label: value.label };
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && value.trim().length > 0;
}
