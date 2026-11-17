import type { EnrichmentDefinition } from './bank_enrichment_contract.ts';
import {
  type EnrichmentCorrectionValues,
  parseEnrichmentCorrectionValues,
} from './bank_enrichment_change_contract.ts';

/** Human operations have their own immutable inputs and never carry provider configuration. */
export type EnrichmentMutationConfiguration =
  | { readonly kind: 'correct'; readonly values: EnrichmentCorrectionValues }
  | { readonly kind: 'undo' };

/** Validate stored or submitted mutation configuration without inferring the operation kind. */
export function parseEnrichmentMutationConfiguration(
  input: unknown,
  definition: EnrichmentDefinition,
): EnrichmentMutationConfiguration | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || !('kind' in input)) {
    return null;
  }
  if (input.kind === 'undo') {
    return Object.keys(input).join(',') === 'kind' ? { kind: 'undo' } : null;
  }
  if (
    input.kind !== 'correct' || Object.keys(input).sort().join(',') !== 'kind,values' ||
    !('values' in input)
  ) return null;
  const values = parseEnrichmentCorrectionValues(input.values, definition);
  return values ? { kind: 'correct', values } : null;
}
