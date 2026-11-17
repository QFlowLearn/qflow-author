import type { EnrichmentDimension } from './bank_enrichment_contract.ts';
import { parseEnrichmentDimensions } from './bank_enrichment_run_contract.ts';

/** Preview either the current selection or categories affected by the instructor's edits. */
export type EnrichmentPreviewChoice = {
  readonly selection: 'current' | 'affected';
  readonly dimensions: readonly EnrichmentDimension[];
};
/** Parse the scope choice and field selection together, without guessing missing options. */
export function parseEnrichmentPreviewChoice(input: unknown): EnrichmentPreviewChoice | null {
  if (
    typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'dimensions,selection' ||
    !('selection' in input) || (input.selection !== 'current' && input.selection !== 'affected') ||
    !('dimensions' in input)
  ) return null;
  const dimensions = parseEnrichmentDimensions(input.dimensions);
  return dimensions ? { selection: input.selection, dimensions } : null;
}
