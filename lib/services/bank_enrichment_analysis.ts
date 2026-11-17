import type { EnrichmentAIConfig } from '../ai/bank_enrichment_config.ts';
import type { EnrichmentAIProvider, EnrichmentAIUsage } from '../ai/bank_enrichment_provider.ts';
import type { RequestContext } from '../tenants.ts';
import type { EnrichmentDefinition, EnrichmentResult } from './bank_enrichment_contract.ts';
import {
  classificationRequest,
  type EnrichmentClassifiedQuestion,
  type EnrichmentProposal,
  parseClassificationOutput,
  parseProposalOutput,
  proposalRequest,
} from './bank_enrichment_classifier.ts';
import type { EnrichmentQuestion } from './bank_enrichment_input.ts';
import type { BankEnrichmentUsage } from './bank_enrichment_usage.ts';

type AnalysisFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'operation_conflict'
  | 'request_changed'
  | 'storage_failed'
  | 'budget_exceeded'
  | 'in_flight'
  | 'aborted'
  | 'input_too_large'
  | 'provider_failed'
  | 'invalid_response';
/** Validated results include usage for a measured estimate, separate from request reserves. */
export type EnrichmentAnalysis<T> = { readonly result: T; readonly usage: EnrichmentAIUsage };

/** Proposal and classifier share one budgeted provider path; neither writes question assignments. */
export class BankEnrichmentAnalysis {
  constructor(
    private readonly usage: BankEnrichmentUsage,
    private readonly provider: (config: EnrichmentAIConfig) => EnrichmentAIProvider,
  ) {}

  /** Propose a scheme and ten examples from the bounded varied sample. */
  async propose(
    ctx: RequestContext,
    budgetId: string,
    attemptId: string,
    audience: string,
    questions: readonly EnrichmentQuestion[],
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<EnrichmentResult<EnrichmentAnalysis<EnrichmentProposal>, AnalysisFailure>> {
    const request = proposalRequest(audience, questions);
    if (!request) return { ok: false, code: 'invalid_input' };
    const receipt = await this.usage.execute(
      ctx,
      budgetId,
      attemptId,
      request,
      this.provider,
      options,
    );
    if (!receipt.ok) return receipt;
    if (!receipt.value.ok) return { ok: false, code: receipt.value.code };
    const result = parseProposalOutput(receipt.value.content, audience, questions);
    return result
      ? { ok: true, value: { result, usage: receipt.value.usage } }
      : { ok: false, code: 'invalid_response' };
  }

  /** Classify at most twenty questions; every provider result must match the exact source revision. */
  async classify(
    ctx: RequestContext,
    budgetId: string,
    attemptId: string,
    definition: EnrichmentDefinition,
    questions: readonly EnrichmentQuestion[],
    options: { readonly signal?: AbortSignal; readonly examples?: readonly EnrichmentQuestion[] } =
      {},
  ): Promise<
    EnrichmentResult<EnrichmentAnalysis<readonly EnrichmentClassifiedQuestion[]>, AnalysisFailure>
  > {
    const request = classificationRequest(definition, questions, options.examples ?? []);
    if (!request) return { ok: false, code: 'invalid_input' };
    const receipt = await this.usage.execute(
      ctx,
      budgetId,
      attemptId,
      request,
      this.provider,
      { signal: options.signal },
    );
    if (!receipt.ok) return receipt;
    if (!receipt.value.ok) return { ok: false, code: receipt.value.code };
    const result = parseClassificationOutput(receipt.value.content, definition, questions);
    return result
      ? { ok: true, value: { result, usage: receipt.value.usage } }
      : { ok: false, code: 'invalid_response' };
  }
}

/** Estimate full classification from measured classifier calls, excluding proposal and retry costs. */
export function estimateEnrichmentRunMicros(
  measuredMicros: number,
  classifiedCount: number,
  scopeCount: number,
): number | null {
  if (
    !Number.isSafeInteger(measuredMicros) || measuredMicros < 0 ||
    !Number.isSafeInteger(classifiedCount) || classifiedCount < 1 ||
    !Number.isSafeInteger(scopeCount) || scopeCount < classifiedCount
  ) return null;
  return Math.ceil(measuredMicros * scopeCount / classifiedCount);
}
