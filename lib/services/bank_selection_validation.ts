import type { QflowDatabaseTransaction } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import type { ParsedBankSelectionCommand } from '../assessment_bank_selection.ts';
import type { PlacementQuestionRevisionRow } from '../placement_question_views.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { loadCategorizedBankCandidates } from './bank_question_candidates.ts';
import {
  assessmentSelectionRevisions,
  loadQuestionSelectionIdentities,
} from './bank_question_identity.ts';
import { validBankEnrichmentFilter } from './bank_enrichment_filter_access.ts';

/** Recheck pending automatic choices under the assessment/workspace write locks, before any insert. */
export async function validateAutomaticBankSelection(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  assessmentId: string,
  command: ParsedBankSelectionCommand,
  pending: ParsedBankSelectionCommand['items'],
  rows: readonly PlacementQuestionRevisionRow[],
): Promise<'conflict' | 'unsupported_selection' | null> {
  const existing = await assessmentSelectionRevisions(tx, ctx.tenantId, assessmentId);
  if (!existing) return 'unsupported_selection';
  const identities = await loadQuestionSelectionIdentities(
    tx,
    ctx.tenantId,
    [...existing, ...rows].map((row) => row.revisionId),
  );
  const used = new Set<string>();
  const manualIds = new Set(
    command.items.filter((item) => item.proposal === null).map((item) => item.itemId),
  );
  for (const row of [...existing, ...rows.filter((row) => manualIds.has(row.itemId))]) {
    const identity = identities.get(row.revisionId);
    if (!identity) return 'unsupported_selection';
    used.add(identity);
  }
  const scopes = new Map<string, Awaited<ReturnType<typeof loadCategorizedBankCandidates>>>();
  for (const item of pending) {
    const proposal = item.proposal;
    if (!proposal) continue;
    const row = rows.find((row) => row.itemId === item.itemId && row.revision === item.revision);
    if (!row || row.latestRevisionId !== row.revisionId || !proposal.query.enrichment) {
      return 'conflict';
    }
    const key = canonicalJsonStringify({ query: proposal.query, mode: proposal.mode });
    let candidates = scopes.get(key);
    if (!candidates) {
      if (!await validBankEnrichmentFilter(tx, ctx.tenantId, proposal.query.enrichment)) {
        return 'conflict';
      }
      candidates = await loadCategorizedBankCandidates(tx, ctx, proposal.query, proposal.mode);
      scopes.set(key, candidates);
    }
    if (
      !candidates.some((candidate) =>
        candidate.itemId === item.itemId && candidate.revisionId === row.revisionId &&
        candidate.versionId === proposal.versionId &&
        candidate.categoryId === proposal.categoryId
      )
    ) return 'conflict';
    const identity = identities.get(row.revisionId);
    if (!identity) return 'unsupported_selection';
    if (used.has(identity)) return 'conflict';
    used.add(identity);
  }
  return null;
}
