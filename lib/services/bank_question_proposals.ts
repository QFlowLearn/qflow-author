import { parseTimestamp } from '../persistence_parse.ts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { assessments, questionRevisions, questions } from '../db/schema.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import type { RequestContext } from '../tenants.ts';
import type {
  BankProposalFailure,
  BankProposalResponse,
  ParsedBankProposalCommand,
  ProposalVersion,
} from '../bank_question_proposal.ts';
import { type LibraryItem, parseLibraryItem } from '../question_bank_picker.ts';
import {
  allocateDistinctQuestions,
  type DistinctQuestionCandidate as Candidate,
} from '../bank_question_allocation.ts';
import { loadQuestionSelectionIdentities, proposalExclusions } from './bank_question_identity.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { hasWorkspaceCapability } from './workspace_authorization.ts';
import { loadCategorizedBankCandidates } from './bank_question_candidates.ts';
import { validBankEnrichmentFilter } from './bank_enrichment_filter_access.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentResult,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import { questionBankExcerpt } from './question_bank_read.ts';

/** Counts and sampling share one authorized snapshot and the complete bank predicate. */
export class BankQuestionProposals {
  constructor(
    private readonly database: QflowDatabase,
    private readonly randomIndex: (limit: number) => number,
  ) {}

  async run(
    ctx: RequestContext,
    assessmentId: string,
    command: ParsedBankProposalCommand,
  ): Promise<EnrichmentResult<BankProposalResponse, BankProposalFailure>> {
    const filter = command.query.enrichment;
    if (!filter) return { ok: false, code: 'scheme_required' };
    const categoryFilter = filter[command.mode];
    if (categoryFilter && categoryFilter.kind !== 'value') {
      return { ok: false, code: 'category_required' };
    }
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<BankProposalResponse, BankProposalFailure>> => {
          if (!await hasWorkspaceCapability(ctx, 'manage_content', tx)) {
            return { ok: false, code: 'forbidden' };
          }
          const [assessment] = await tx.select({ id: assessments.id }).from(assessments).where(
            and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)),
          );
          if (!assessment) return { ok: false, code: 'not_found' };
          if (!await validBankEnrichmentFilter(tx, ctx.tenantId, filter)) {
            return { ok: false, code: 'invalid_input' };
          }
          const definitions = await tx.select().from(enrichmentSchemeVersions)
            .where(
              and(
                eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
                eq(enrichmentSchemeVersions.schemeId, filter.schemeId),
              ),
            )
            .orderBy(desc(enrichmentSchemeVersions.version));
          if (!definitions.length) return { ok: false, code: 'not_found' };
          // Resolve version conflicts before querying the full candidate scope.
          const selectedVersions = new Set(ENRICHMENT_DIMENSIONS.flatMap((dimension) => {
            const value = filter[dimension];
            return value?.kind === 'value' ? [value.versionId] : [];
          }));
          if (selectedVersions.size > 1) return { ok: false, code: 'invalid_input' };
          const excluded = await proposalExclusions(
            tx,
            ctx.tenantId,
            assessmentId,
            command.excludedQuestions,
          );
          if (!excluded) return { ok: false, code: 'unsupported_selection' };
          const categorized = await loadCategorizedBankCandidates(
            tx,
            ctx,
            command.query,
            command.mode,
          );
          const identities = await loadQuestionSelectionIdentities(
            tx,
            ctx.tenantId,
            categorized.map((c) => c.revisionId),
          );
          const candidates: Candidate[] = [];
          const unsupported = new Map<string, Set<string>>();
          for (const candidate of categorized) {
            if (excluded.itemIds.has(candidate.itemId)) continue;
            const identity = identities.get(candidate.revisionId);
            if (!identity) {
              const ids = unsupported.get(candidate.versionId) ?? new Set<string>();
              ids.add(candidate.itemId);
              unsupported.set(candidate.versionId, ids);
            } else if (!excluded.identities.has(identity)) {
              candidates.push({ ...candidate, identity });
            }
          }
          const buckets = new Map<string, Map<string, Candidate[]>>();
          for (const candidate of candidates) {
            let version = buckets.get(candidate.versionId);
            if (!version) {
              version = new Map();
              buckets.set(candidate.versionId, version);
            }
            const level = version.get(candidate.categoryId);
            if (level) level.push(candidate);
            else version.set(candidate.categoryId, [candidate]);
          }
          const versions: ProposalVersion[] = definitions.filter((row, index) =>
            selectedVersions.size
              ? selectedVersions.has(row.id)
              : index === 0 || buckets.has(row.id) || unsupported.has(row.id) ||
                command.kind !== 'inspect' && row.id === command.versionId
          ).map((row) => {
            const definition = parseEnrichmentDefinition(row.definition);
            if (!definition) throw new Error('Invalid proposal category definition.');
            return {
              id: row.id,
              version: row.version,
              audience: definition.audience,
              unsupported: unsupported.get(row.id)?.size ?? 0,
              levels: (command.mode === 'topic' ? definition.topics : definition.difficulty).filter(
                (level) =>
                  !categoryFilter ||
                  categoryFilter.kind === 'value' && level.id === categoryFilter.valueId,
              ).map((level) => ({
                id: level.id,
                label: level.label,
                available:
                  new Set((buckets.get(row.id)?.get(level.id) ?? []).map((c) => c.identity)).size,
              })),
            };
          });
          if (command.kind === 'inspect') {
            return { ok: true, value: { kind: 'availability', mode: command.mode, versions } };
          }
          const version = versions.find((row) => row.id === command.versionId);
          if (!version) return { ok: false, code: 'invalid_input' };
          if (
            command.counts.some((count) =>
              !version.levels.some((level) => level.id === count.categoryId)
            )
          ) {
            return { ok: false, code: 'invalid_input' };
          }
          const chosen = allocateDistinctQuestions(
            candidates.filter((c) => c.versionId === version.id),
            command.counts,
            this.randomIndex,
          );
          if (chosen.length < command.counts.reduce((sum, c) => sum + c.count, 0)) {
            return {
              ok: true,
              value: { kind: 'shortfall', mode: command.mode, version, available: chosen.length },
            };
          }
          const summaries = await loadSummaries(tx, ctx, chosen);
          return {
            ok: true,
            value: {
              kind: 'proposal',
              mode: command.mode,
              version,
              items: chosen.map((candidate) => {
                const question = summaries.get(candidate.itemId);
                if (!question) throw new Error('Proposal revision summary is missing.');
                return { question, categoryId: candidate.categoryId };
              }),
            },
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (cause: unknown) {
      console.error('Bank question proposal failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }
}

async function loadSummaries(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  chosen: readonly Candidate[],
): Promise<ReadonlyMap<string, LibraryItem>> {
  const rows = await tx.select({
    id: questions.id,
    title: questions.title,
    tags: questions.tags,
    updatedAt: questions.updatedAt,
    latestRev: questionRevisions.revision,
    body: questionRevisions.body,
  })
    .from(questions).innerJoin(
      questionRevisions,
      and(
        eq(questionRevisions.questionId, questions.id),
        eq(questionRevisions.tenantId, ctx.tenantId),
      ),
    )
    .where(
      and(
        eq(questions.tenantId, ctx.tenantId),
        inArray(questionRevisions.id, chosen.map((row) => row.revisionId)),
      ),
    );
  return new Map(rows.map((row) => {
    const question = parseLibraryItem({
      id: row.id,
      title: row.title,
      tags: row.tags,
      updatedAt: parseTimestamp(row.updatedAt, 'Invalid question update timestamp.'),
      latestRev: row.latestRev,
      type: row.body.type,
      excerpt: questionBankExcerpt(row.body),
    });
    if (!question) throw new Error('Invalid proposal question summary.');
    return [question.id, question];
  }));
}
