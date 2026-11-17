import { isEnrichmentRecord } from '../ai/bank_enrichment_config.ts';
import { isCanonicalUuid } from '../uuid.ts';
import {
  type EnrichmentDefinition,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import {
  type EnrichmentClassifiedQuestion,
  type EnrichmentProposal,
  parseClassificationOutput,
} from './bank_enrichment_classifier.ts';
import { prepareEnrichmentQuestion } from './bank_enrichment_input.ts';
import type { EnrichmentSample } from './bank_enrichment_sample.ts';

/** A completed preview separates measured sample cost from its full-scope estimate. */
export type EnrichmentPreviewResult = {
  readonly definition: EnrichmentDefinition;
  readonly examples: readonly EnrichmentClassifiedQuestion[];
  readonly measuredQuestionCount: number;
  readonly measuredCostMicros: number;
  readonly estimatedRunMicros: number;
  readonly elapsedMs: number;
};

/** Restore only a complete, bounded and internally reconciled sample from PostgreSQL. */
export function parseStoredEnrichmentSample(value: unknown): EnrichmentSample | null {
  if (
    !isEnrichmentRecord(value) ||
    Object.keys(value).sort().join(',') !==
      'excluded,questions,scopeCount,seed,selectedCount,snapshotId'
  ) return null;
  if (
    typeof value.snapshotId !== 'string' || !isCanonicalUuid(value.snapshotId) ||
    typeof value.seed !== 'string' || !isCanonicalUuid(value.seed) ||
    !integer(value.scopeCount, 1, 1_000_000) || !integer(value.selectedCount, 0, 100) ||
    !Array.isArray(value.questions) || !Array.isArray(value.excluded) ||
    value.questions.length + value.excluded.length !== value.selectedCount ||
    value.scopeCount < value.selectedCount
  ) return null;
  const questions: EnrichmentSample['questions'][number][] = [];
  const excluded: EnrichmentSample['excluded'][number][] = [];
  for (const question of value.questions) {
    if (
      !isEnrichmentRecord(question) || typeof question.questionId !== 'string' ||
      typeof question.revisionId !== 'string'
    ) return null;
    const parsed = prepareEnrichmentQuestion(question.questionId, question.revisionId, {
      title: question.title,
      bodyHtml: question.bodyHtml,
      promptHtml: question.promptHtml,
      choices: question.choices,
      correctId: question.correctId,
      type: 'single_select',
    });
    if (!parsed.ok) return null;
    questions.push(parsed.value);
  }
  for (const entry of value.excluded) {
    if (
      !isEnrichmentRecord(entry) || typeof entry.questionId !== 'string' ||
      !isCanonicalUuid(entry.questionId) || typeof entry.revisionId !== 'string' ||
      !isCanonicalUuid(entry.revisionId) ||
      (entry.reason !== 'unsupported_content' && entry.reason !== 'invalid_question' &&
        entry.reason !== 'input_too_large')
    ) return null;
    excluded.push({
      questionId: entry.questionId,
      revisionId: entry.revisionId,
      reason: entry.reason,
    });
  }
  if (new Set([...questions, ...excluded].map((q) => q.questionId)).size !== value.selectedCount) {
    return null;
  }
  return {
    snapshotId: value.snapshotId,
    scopeCount: value.scopeCount,
    seed: value.seed,
    selectedCount: value.selectedCount,
    questions,
    excluded,
  };
}

/** Provisional definitions and examples remain tied to their sampled source revisions. */
export function parseStoredEnrichmentProposal(
  value: unknown,
  sample: EnrichmentSample,
): EnrichmentProposal | null {
  if (!isEnrichmentRecord(value) || Object.keys(value).sort().join(',') !== 'definition,examples') {
    return null;
  }
  const definition = parseEnrichmentDefinition(value.definition);
  if (!definition) return null;
  const examples = parseClassificationOutput(
    JSON.stringify({ items: value.examples }),
    definition,
    sample.questions.slice(0, 10),
  );
  return examples ? { definition, examples } : null;
}

/** Parse measured results before exposing a preview to the instructor. */
export function parseStoredEnrichmentPreviewResult(
  value: unknown,
  sample: EnrichmentSample,
): EnrichmentPreviewResult | null {
  if (
    !isEnrichmentRecord(value) ||
    Object.keys(value).sort().join(',') !==
      'definition,elapsedMs,estimatedRunMicros,examples,measuredCostMicros,measuredQuestionCount'
  ) return null;
  const parsed = parseStoredEnrichmentProposal({
    definition: value.definition,
    examples: value.examples,
  }, sample);
  if (
    !parsed || !integer(value.measuredQuestionCount, 1, 20) ||
    value.measuredQuestionCount > sample.questions.length ||
    !integer(value.measuredCostMicros, 0, 100_000_000_000) ||
    !integer(value.estimatedRunMicros, 0, 100_000_000_000) ||
    !integer(value.elapsedMs, 0, 1_000_000_000_000)
  ) return null;
  return {
    ...parsed,
    measuredQuestionCount: value.measuredQuestionCount,
    measuredCostMicros: value.measuredCostMicros,
    estimatedRunMicros: value.estimatedRunMicros,
    elapsedMs: value.elapsedMs,
  };
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
