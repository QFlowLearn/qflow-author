import {
  isEnrichmentRecord,
  parseEnrichmentAIConfig,
} from '../../lib/ai/bank_enrichment_config.ts';
import type { EnrichmentAIProvider } from '../../lib/ai/bank_enrichment_provider.ts';
import { parseEnrichmentDefinition } from '../../lib/services/bank_enrichment_contract.ts';
import { enrichmentDefinitionFixture } from '../bank_enrichment_fixture.ts';

const parsed = parseEnrichmentAIConfig({
  provider: 'cloudflare',
  model: '@cf/deepseek-ai/deepseek-v4-flash-0731',
  promptVersion: 'bank-enrichment-v1',
  inputMicrosPerMillion: 440000,
  outputMicrosPerMillion: 1320000,
  previewBudgetMicros: 1000000,
  runBudgetMicros: 25000000,
});
if (!parsed) throw new Error('Invalid enrichment fixture configuration.');
/** Explicit test configuration; this fixture never sends a model request. */
export const enrichmentConfigFixture = parsed;

/** Deterministic external capability for persistence/runtime tests, not a quality reference. */
export const enrichmentProviderFixture: EnrichmentAIProvider = (request) => {
  const data: unknown = JSON.parse(request.data);
  if (!isEnrichmentRecord(data) || !Array.isArray(data.questions)) {
    throw new Error('Invalid fixture provider request.');
  }
  const definition = data.task === 'propose'
    ? enrichmentDefinitionFixture()
    : parseEnrichmentDefinition({
      ...(isEnrichmentRecord(data.definition) ? data.definition : {}),
      replacements: [],
      examples: Array.isArray(data.examples)
        ? data.examples.map((example) => {
          if (!isEnrichmentRecord(example) || !isEnrichmentRecord(example.question)) return null;
          return {
            questionId: example.question.questionId,
            revisionId: example.question.revisionId,
            classification: example.classification,
          };
        })
        : null,
    });
  if (!definition) throw new Error('Fixture provider requires a definition.');
  const topic = definition.topics[0];
  const values = data.task === 'propose' ? data.questions.slice(0, 10) : data.questions;
  const items = values.map((value) => {
    if (
      !isEnrichmentRecord(value) || typeof value.questionId !== 'string' ||
      typeof value.revisionId !== 'string'
    ) throw new Error('Fixture provider requires pinned identities.');
    const example = definition.examples.find((example) =>
      example.questionId === value.questionId && example.revisionId === value.revisionId
    );
    return {
      questionId: value.questionId,
      revisionId: value.revisionId,
      classification: example ? example.classification : {
        subject: { state: 'assigned', valueIds: [topic.subjectId] },
        topic: { state: 'assigned', valueIds: [topic.id] },
        difficulty: { state: 'assigned', valueIds: [definition.difficulty[0].id] },
      },
      rationale: 'Deterministic fixture classification.',
    };
  });
  const { name, instructions, subjects, topics, difficulty } = definition;
  const content = JSON.stringify(
    data.task === 'propose'
      ? { definition: { name, instructions, subjects, topics, difficulty }, items }
      : { items },
  );
  return Promise.resolve({
    ok: true,
    content,
    usage: {
      inputTokens: request.data.length,
      outputTokens: 100 * items.length,
      model: 'deterministic-test-fixture',
      requestId: 'fixture-request',
    },
  });
};
