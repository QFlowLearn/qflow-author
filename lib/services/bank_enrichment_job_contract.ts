import { isEnrichmentRecord } from '../ai/bank_enrichment_config.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { EnrichmentBaseline } from './bank_enrichment_apply_policy.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDefinition,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';

/** Expected job/control failures, suitable for localized status messages. */
export type EnrichmentJobFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'operation_conflict'
  | 'storage_failed'
  | 'active_run'
  | 'invalid_transition'
  | 'lease_lost';
/** Setup work is either a new proposal or a preview against an edited/reused scheme. */
export type EnrichmentPreviewInput = {
  readonly baseVersionId: string | null;
  readonly seed: string;
  readonly audience: string;
  readonly definition: EnrichmentDefinition | null;
};
/** Durable steps return progress only; full responses and question data remain in PostgreSQL. */
export type EnrichmentBatchProgress =
  | { readonly state: 'more' | 'retry' | 'busy'; readonly completed: number }
  | { readonly state: 'completed' | 'failed' | 'cancelled'; readonly completed: number };

/** Parse setup input before it is frozen. */
export function parseEnrichmentPreviewInput(value: unknown): EnrichmentPreviewInput | null {
  if (
    !isEnrichmentRecord(value) ||
    Object.keys(value).sort().join(',') !== 'audience,baseVersionId,definition,seed' ||
    (value.baseVersionId !== null &&
      (typeof value.baseVersionId !== 'string' || !isCanonicalUuid(value.baseVersionId))) ||
    typeof value.seed !== 'string' || !isCanonicalUuid(value.seed) ||
    typeof value.audience !== 'string' || !value.audience.trim() || value.audience.length > 1000
  ) return null;
  const definition = value.definition === null ? null : parseEnrichmentDefinition(value.definition);
  if (value.baseVersionId !== null && definition === null) return null;
  if (value.definition !== null && (!definition || definition.audience !== value.audience.trim())) {
    return null;
  }
  return {
    baseVersionId: value.baseVersionId,
    seed: value.seed,
    audience: value.audience.trim(),
    definition,
  };
}

/** Source change tokens cannot be inferred or refreshed on resume. */
export function parseEnrichmentBaseline(value: unknown): EnrichmentBaseline | null {
  if (
    !isEnrichmentRecord(value) || Object.keys(value).sort().join(',') !== 'difficulty,subject,topic'
  ) return null;
  const output: Record<'subject' | 'topic' | 'difficulty', string | null> = {
    subject: null,
    topic: null,
    difficulty: null,
  };
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const id = value[dimension];
    if (id !== null && (typeof id !== 'string' || !isCanonicalUuid(id))) return null;
    output[dimension] = id;
  }
  return output;
}
