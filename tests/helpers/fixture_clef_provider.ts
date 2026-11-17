import type {
  ClefOrganizationFailure,
  ClefOrganizationProvider,
  ClefTeachingExample,
  ClefTopicDecision,
} from '../../lib/ai/clef_organization_provider.ts';
import type { EnrichmentQuestion } from '../../lib/services/bank_enrichment_input.ts';
import type {
  EnrichmentDefinition,
  EnrichmentResult,
} from '../../lib/services/bank_enrichment_contract.ts';

/** Deterministic per-item fixture decisions exposed through the production batch seam.
 * Usage here describes independent fixture receipts, not a real provider request.
 */
export function fixtureClefProvider(
  decide: (
    question: EnrichmentQuestion,
    definition: EnrichmentDefinition,
    examples: readonly ClefTeachingExample[],
  ) => Promise<EnrichmentResult<ClefTopicDecision, ClefOrganizationFailure>>,
): ClefOrganizationProvider {
  return async (questions, definition, examples) => {
    const results = await Promise.all(questions.map((q) => decide(q, definition, examples)));
    const decisions = [];
    for (const [index, result] of results.entries()) {
      if (!result.ok) return result;
      decisions.push({
        questionId: questions[index].questionId,
        receipt: result.value,
        chargedMicros: Math.ceil(result.value.inputTokens * 240000 / 1_000_000),
      });
    }
    return { ok: true, value: decisions };
  };
}
