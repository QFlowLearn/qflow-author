import { expect, test as testCase } from 'vitest';

import { proposeSectionTopics } from '../lib/organization_source_editor.ts';
import { parseEnrichmentDefinition } from '../lib/services/bank_enrichment_contract.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';

testCase(
  'same-named import sections remain separate editable topics and keep artifact identities',
  () => {
    const sections = ['first', 'second'].map((sectionKey) => ({
      sourceId: crypto.randomUUID(),
      sectionKey,
      title: 'Cells',
      filename: 'chapter.zip',
      count: 50,
    }));
    const result = proposeSectionTopics({
      definition: enrichmentDefinitionFixture(),
      mappings: [],
      sections,
      collectionName: 'Biology',
      audience: 'Biology students',
      newId: () => crypto.randomUUID(),
    });
    if (!result) expect.unreachable('Expected result');
    if (!(parseEnrichmentDefinition(result.definition))) {
      expect.unreachable('Expected parseEnrichmentDefinition(result.definition)');
    }
    expect(result.definition.topics.slice(-2).map((t) => t.label)).toStrictEqual([
      'Cells (2)',
      'Cells (3)',
    ]);
    expect(result.mappings.map((m) => [m.sourceId, m.sectionKey])).toStrictEqual(
      sections.map((s) => [s.sourceId, s.sectionKey]),
    );
    expect(
      proposeSectionTopics({
        definition: result.definition,
        mappings: result.mappings,
        sections,
        collectionName: 'Biology',
        audience: 'Biology students',
        newId: () => crypto.randomUUID(),
      }),
      'The same sections must not create more topics',
    ).toStrictEqual(null);
  },
);
