import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDefinition,
  type EnrichmentDimension,
  validEnrichmentReplacementMap,
} from './bank_enrichment_contract.ts';

/** Identify merged/removed categories; the affected selection is independent of which fields a run updates. */
export function enrichmentRemovedValues(
  base: EnrichmentDefinition,
  next: EnrichmentDefinition,
): Readonly<Record<EnrichmentDimension, readonly string[]>> | null {
  if (!validEnrichmentReplacementMap(base, next)) return null;
  const values: Record<EnrichmentDimension, string[]> = { subject: [], topic: [], difficulty: [] };
  for (const replacement of next.replacements) {
    values[replacement.dimension].push(replacement.fromId);
  }
  for (const dimension of ENRICHMENT_DIMENSIONS) values[dimension].sort();
  return ENRICHMENT_DIMENSIONS.some((d) => values[d].length > 0) ? values : null;
}
