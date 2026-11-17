import { expect, test as testCase } from 'vitest';

import { planEnrichmentWrites } from '../lib/services/bank_enrichment_apply_policy.ts';
import type { EnrichmentClassification } from '../lib/services/bank_enrichment_contract.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';

testCase(
  'later same-value edits win per dimension and manual topic/subject relationships remain intact',
  () => {
    const definition = enrichmentDefinitionFixture();
    const classification: EnrichmentClassification = {
      subject: { state: 'assigned', valueIds: ['physical'] },
      topic: { state: 'assigned', valueIds: ['energy'] },
      difficulty: { state: 'assigned', valueIds: ['easy'] },
    };
    const input = {
      definition,
      classification,
      dimensions: ['subject', 'topic', 'difficulty'] as const,
      replacement: 'preserve_manual' as const,
      baseline: { subject: null, topic: 'old-topic', difficulty: null },
      current: {
        subject: null,
        topic: {
          changeId: 'old-topic',
          origin: 'human' as const,
          value: { state: 'assigned' as const, valueIds: ['cells'] },
          definition,
        },
        difficulty: {
          changeId: 'later-edit',
          origin: 'human' as const,
          value: classification.difficulty,
          definition,
        },
      },
    };
    const result = planEnrichmentWrites(input);
    expect(result.writes).toStrictEqual({});
    expect(result.protected).toStrictEqual({
      topic: 'manual_value',
      difficulty: 'changed_since_start',
      subject: 'topic_preserved',
    });
    const replace = planEnrichmentWrites({ ...input, replacement: 'replace_captured' });
    expect(replace.writes).toStrictEqual({
      subject: classification.subject,
      topic: classification.topic,
    });
    expect(replace.protected).toStrictEqual({ difficulty: 'changed_since_start' });
  },
);
