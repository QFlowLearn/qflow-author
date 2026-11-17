/** Insert placements before a stable anchor; an omitted anchor explicitly means append. */
export function insertAssessmentPlacements<T extends { readonly id: string }>(
  placements: readonly T[],
  additions: readonly T[],
  beforePlacementId?: string,
): T[] {
  const index = beforePlacementId === undefined
    ? placements.length
    : placements.findIndex((placement) => placement.id === beforePlacementId);
  if (index < 0) throw new Error('Insertion placement is missing from the assessment part.');
  return [...placements.slice(0, index), ...additions, ...placements.slice(index)];
}

/** The placement after a known source, or explicit append when the source is last. */
export function assessmentPlacementFollowing(
  placements: readonly { readonly id: string }[],
  sourcePlacementId: string,
): string | undefined {
  const index = placements.findIndex((placement) => placement.id === sourcePlacementId);
  if (index < 0) throw new Error('Duplication source is missing from the assessment part.');
  return placements[index + 1]?.id;
}
