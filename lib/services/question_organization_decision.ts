import { isEnrichmentRecord } from '../ai/bank_enrichment_config.ts';
import {
  CLEF_NO_MATCH,
  type ClefTopicDecision,
  parseClefTopicDecision,
} from '../ai/clef_organization_provider.ts';
import type { EnrichmentDefinition } from './bank_enrichment_contract.ts';
import type { OrganizationSetup } from './question_organization_contract.ts';

/** Only interpreted, validated decisions enter the receipt column. */
export type OrganizationDecision =
  | { readonly kind: 'source'; readonly topicId: string }
  | { readonly kind: 'preserved'; readonly topicId: string }
  | { readonly kind: 'clef'; readonly receipt: ClefTopicDecision }
  | { readonly kind: 'unassigned' | 'unsupported' | 'protected' };

export function parseOrganizationDecision(
  raw: unknown,
  definition: EnrichmentDefinition,
  setup: OrganizationSetup,
): OrganizationDecision | null {
  if (!isEnrichmentRecord(raw)) return null;
  switch (raw.kind) {
    case 'source':
    case 'preserved':
      return Object.keys(raw).sort().join(',') === 'kind,topicId' &&
          typeof raw.topicId === 'string' &&
          definition.topics.some((topic) => topic.id === raw.topicId)
        ? { kind: raw.kind, topicId: raw.topicId }
        : null;
    case 'unassigned':
    case 'unsupported':
    case 'protected':
      return Object.keys(raw).join(',') === 'kind' ? { kind: raw.kind } : null;
    case 'clef': {
      if (
        Object.keys(raw).sort().join(',') !== 'kind,receipt' || !isEnrichmentRecord(raw.receipt) ||
        setup.classifier.kind !== 'clef'
      ) return null;
      const value = raw.receipt;
      // Stored receipts retain the actual model that produced them, independently of current policy.
      if (typeof value.model !== 'string' || !/^[a-z0-9][a-z0-9._/-]{0,99}$/.test(value.model)) {
        return null;
      }
      const receipt = parseClefTopicDecision(
        {
          model: value.model,
          answers: {
            topic: {
              type: 'choice',
              choice: value.topicId === null ? CLEF_NO_MATCH : value.topicId,
              confidence: value.confidence,
              probabilities: value.probabilities,
            },
          },
          usage: { input_tokens: value.inputTokens, output_tokens: value.outputTokens },
        },
        definition.topics.map((topic) => topic.id),
        value.model,
      );
      return receipt ? { kind: 'clef', receipt } : null;
    }
    default:
      return null;
  }
}

export function organizationTopic(decision: OrganizationDecision): string | null {
  switch (decision.kind) {
    case 'source':
    case 'preserved':
      return decision.topicId;
    case 'clef':
      return decision.receipt.topicId;
    case 'unassigned':
    case 'unsupported':
    case 'protected':
      return null;
  }
}
