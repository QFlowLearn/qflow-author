import type { OrganizationDecision } from './services/question_organization_decision.ts';

/** Keep model work and the instructor's review work separately bounded. */
export const ORGANIZATION_PREVIEW_POOL_LIMIT = 100;
export const ORGANIZATION_REVIEW_LIMIT = 20;

/** Stable seeded ordering is supplied by the persistence boundary. */
export type OrganizationSampleCandidate = {
  readonly questionId: string;
  readonly sourceKey: string;
  readonly orderKey: string;
};
/** Parsed receipts belong to the exact frozen setup and revision. */
export type OrganizationReviewCandidate = OrganizationSampleCandidate & {
  readonly state: string;
  readonly decision: OrganizationDecision | null;
};
export type OrganizationReviewSelection = {
  readonly questionId: string;
  readonly reason: 'uncertain' | 'coverage';
};

/** Round-robin source groups so a large source cannot crowd smaller sources out of the pool. */
export function selectOrganizationPreviewPool(
  candidates: readonly OrganizationSampleCandidate[],
): readonly string[] {
  return acrossGroups(candidates, (item) => item.sourceKey, ORGANIZATION_PREVIEW_POOL_LIMIT)
    .map((item) => item.questionId);
}

/** Half ambiguous model results, then broad source/topic coverage without repeated questions. */
export function selectOrganizationReview(
  candidates: readonly OrganizationReviewCandidate[],
): readonly OrganizationReviewSelection[] {
  const limit = Math.min(ORGANIZATION_REVIEW_LIMIT, candidates.length);
  const uncertain = candidates.filter((c) =>
    c.decision?.kind === 'clef' && ['previewed', 'unassigned'].includes(c.state)
  ).toSorted((a, b) => ambiguity(b) - ambiguity(a) || stableOrder(a, b))
    .slice(0, Math.floor(limit / 2));
  const chosen = new Set(uncertain.map((c) => c.questionId));
  const remaining = candidates.filter((c) => !chosen.has(c.questionId));
  // Coverage includes confident predictions, rather than selecting uncertainty twice.
  const coverage = acrossGroups(
    remaining,
    (c) => {
      const decision = c.decision;
      const topic = decision?.kind === 'clef'
        ? decision.receipt.topicId
        : decision?.kind === 'source' || decision?.kind === 'preserved'
        ? decision.topicId
        : null;
      return JSON.stringify([c.sourceKey, topic, topic === null ? c.state : null]);
    },
    limit - uncertain.length,
    (a, b) => ambiguity(a) - ambiguity(b) || stableOrder(a, b),
  );
  return [
    ...uncertain.map((c) => ({ questionId: c.questionId, reason: 'uncertain' as const })),
    ...coverage.map((c) => ({ questionId: c.questionId, reason: 'coverage' as const })),
  ];
}

function ambiguity(candidate: OrganizationReviewCandidate): number {
  if (candidate.decision?.kind !== 'clef') return 0;
  const values = Object.values(candidate.decision.receipt.probabilities);
  const total = values.reduce((sum, value) => sum + value, 0);
  // Receipts allow a small rounding tolerance; normalize before computing entropy.
  return -values.reduce((sum, value) => {
    const p = value / total;
    return sum + (p > 0 ? p * Math.log(p) : 0);
  }, 0) / Math.log(values.length);
}
function stableOrder(a: OrganizationSampleCandidate, b: OrganizationSampleCandidate): number {
  return a.orderKey.localeCompare(b.orderKey) || a.questionId.localeCompare(b.questionId);
}
function acrossGroups<T extends OrganizationSampleCandidate>(
  candidates: readonly T[],
  key: (item: T) => string,
  limit: number,
  memberOrder: (a: T, b: T) => number = stableOrder,
): T[] {
  const groups = new Map<string, T[]>();
  // Group order is seeded too; alphabetical source/topic identities receive no preference.
  for (const item of candidates.toSorted(stableOrder)) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  for (const group of groups.values()) group.sort(memberOrder);
  const selected: T[] = [];
  for (let round = 0; selected.length < limit; round++) {
    let added = false;
    for (const group of groups.values()) {
      if (selected.length === limit) break;
      if (group[round]) {
        selected.push(group[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}
