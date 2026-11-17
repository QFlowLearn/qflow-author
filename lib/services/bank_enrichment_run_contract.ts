import { isCanonicalUuid } from '../uuid.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDimension,
  type EnrichmentResult,
} from './bank_enrichment_contract.ts';

/** Durable run lifecycle, including resumable terminal failures and cancellation. */
export type EnrichmentRunState =
  | 'prepared'
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_issues'
  | 'failed'
  | 'cancelled';
/** A complete classification command; queue/provider configuration is bound at dispatch. */
export type PrepareEnrichmentRun = {
  readonly snapshotId: string;
  readonly versionId: string;
  readonly dimensions: readonly EnrichmentDimension[];
  readonly replacement: 'preserve_manual' | 'replace_captured';
};
/** Parse the start command, requiring subject edits to also validate dependent topics. */
export function parsePrepareEnrichmentRun(input: unknown): PrepareEnrichmentRun | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  if (Object.keys(input).sort().join(',') !== 'dimensions,replacement,snapshotId,versionId') {
    return null;
  }
  if (
    !('snapshotId' in input) || typeof input.snapshotId !== 'string' ||
    !isCanonicalUuid(input.snapshotId)
  ) return null;
  if (
    !('versionId' in input) || typeof input.versionId !== 'string' ||
    !isCanonicalUuid(input.versionId)
  ) return null;
  if (
    !('replacement' in input) ||
    (input.replacement !== 'preserve_manual' && input.replacement !== 'replace_captured')
  ) return null;
  if (!('dimensions' in input)) return null;
  const dimensions = parseEnrichmentDimensions(input.dimensions);
  if (!dimensions) return null;
  return {
    snapshotId: input.snapshotId,
    versionId: input.versionId,
    dimensions,
    replacement: input.replacement,
  };
}

/** Choose dimensions explicitly; changing a subject also requires its dependent topics. */
export function parseEnrichmentDimensions(input: unknown): readonly EnrichmentDimension[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) return null;
  const dimensions: EnrichmentDimension[] = [];
  for (const dimension of input) {
    if (dimension !== 'subject' && dimension !== 'topic' && dimension !== 'difficulty') return null;
    dimensions.push(dimension);
  }
  if (
    new Set(dimensions).size !== dimensions.length ||
    (dimensions.includes('subject') && !dimensions.includes('topic'))
  ) return null;
  return ENRICHMENT_DIMENSIONS.filter((d) => dimensions.includes(d));
}

/** Reject illegal transitions; persistence must compare the prior state atomically. */
export function transitionEnrichmentRun(
  from: EnrichmentRunState,
  to: EnrichmentRunState,
): EnrichmentResult<EnrichmentRunState, 'invalid_transition'> {
  const allowed: Readonly<Record<EnrichmentRunState, readonly EnrichmentRunState[]>> = {
    prepared: ['queued', 'cancelled'],
    queued: ['running', 'cancelled', 'failed'],
    running: ['completed', 'completed_with_issues', 'failed', 'cancelled'],
    failed: ['queued'],
    cancelled: ['queued'],
    completed: [],
    completed_with_issues: ['queued'],
  };
  return allowed[from].includes(to)
    ? { ok: true, value: to }
    : { ok: false, code: 'invalid_transition' };
}
