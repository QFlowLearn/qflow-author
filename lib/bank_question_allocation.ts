import { sampleQuestions } from './bank_question_sampling.ts';
import type { ProposalCount } from './bank_question_proposal.ts';

/** One category-eligible representative of an exact-content group. */
export type DistinctQuestionCandidate = {
  readonly itemId: string;
  readonly revisionId: string;
  readonly versionId: string;
  readonly categoryId: string;
  readonly identity: string;
};

/**
 * Maximum matching across category quotas. Augmenting paths reassign flexible groups instead
 * of reporting a false shortage after a greedy draw. Each content group fills at most one slot.
 */
export function allocateDistinctQuestions(
  candidates: readonly DistinctQuestionCandidate[],
  counts: readonly ProposalCount[],
  randomIndex: (limit: number) => number,
): readonly DistinctQuestionCandidate[] {
  const pools = new Map<string, readonly DistinctQuestionCandidate[]>();
  for (const { categoryId } of counts) {
    const groups = new Map<string, DistinctQuestionCandidate[]>();
    for (const candidate of candidates) {
      if (candidate.categoryId !== categoryId) continue;
      const group = groups.get(candidate.identity);
      if (group) group.push(candidate);
      else groups.set(candidate.identity, [candidate]);
    }
    // Copies do not give their content extra weight in the draw.
    pools.set(
      categoryId,
      sampleQuestions([...groups.values()], groups.size, randomIndex)
        .map((group) => group[randomIndex(group.length)]),
    );
  }
  const slots = counts.flatMap((count) =>
    Array.from({ length: count.count }, () => count.categoryId)
  );
  const owners = new Map<string, number>();
  const chosen = new Map<number, DistinctQuestionCandidate>();
  function fill(slot: number, visited: Set<string>): boolean {
    for (const candidate of pools.get(slots[slot]) ?? []) {
      if (visited.has(candidate.identity)) continue;
      visited.add(candidate.identity);
      const prior = owners.get(candidate.identity);
      if (prior !== undefined && !fill(prior, visited)) continue;
      owners.set(candidate.identity, slot);
      chosen.set(slot, candidate);
      return true;
    }
    return false;
  }
  for (let slot = 0; slot < slots.length; slot++) fill(slot, new Set());
  return [...chosen.entries()].sort(([a], [b]) => a - b).map(([, candidate]) => candidate);
}
