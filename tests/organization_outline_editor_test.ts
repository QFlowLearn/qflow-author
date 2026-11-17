import { expect, test as testCase } from 'vitest';

import { addOutlineTopics } from '../lib/organization_outline_editor.ts';
import { parseEnrichmentDefinition } from '../lib/services/bank_enrichment_contract.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';

const fixture = () => ({
  definition: enrichmentDefinitionFixture(),
  subjectId: 'life',
  collectionName: 'Science',
  newId: () => crypto.randomUUID(),
});

testCase(
  'paste adds editable titles without replacing existing IDs, definitions or ratings',
  () => {
    const input = fixture();
    const before = structuredClone(input.definition);
    const result = addOutlineTopics({
      ...input,
      text: '1. Genetics .... 12\r\n• Ecosystems\n cells \nGenetics',
    });
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect([result.added, result.skipped]).toStrictEqual([2, 2]);
    expect(result.definition.topics.slice(0, 2)).toStrictEqual(before.topics);
    expect(result.definition.topics.slice(2).map((t) => [t.label, t.definition, t.subjectId]))
      .toStrictEqual([
        ['Genetics', 'Genetics', 'life'],
        ['Ecosystems', 'Ecosystems', 'life'],
      ]);
    expect(result.definition.difficulty).toStrictEqual(before.difficulty);
    expect(input.definition).toStrictEqual(before);
    if (!(parseEnrichmentDefinition(result.definition))) {
      expect.unreachable('Expected parseEnrichmentDefinition(result.definition)');
    }
    const repeated = addOutlineTopics({
      ...input,
      definition: result.definition,
      text: 'Genetics\nEcosystems',
    });
    if (!(repeated.ok)) expect.unreachable('Expected repeated.ok');
    expect([repeated.added, repeated.skipped]).toStrictEqual([0, 2]);
    expect(repeated.definition).toStrictEqual(result.definition);
  },
);

testCase(
  'paste preserves meaningful numbers and treats Unicode-equivalent names as repeats',
  () => {
    const result = addOutlineTopics({
      ...fixture(),
      text: '3.14 and pi\n2026 climate\nÅngström\nA\u030angström\n2) Waves ... xiv',
    });
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(result.definition.topics.slice(2).map((t) => t.label)).toStrictEqual([
      '3.14 and pi',
      '2026 climate',
      'Ångström',
      'Waves',
    ]);
    expect(result.skipped).toStrictEqual(1);
  },
);

testCase('paste rejects invalid input atomically with the original line number', () => {
  for (
    const [text, expected] of [
      [' \n•\n1.', { ok: false, code: 'empty' }],
      ['x'.repeat(30001), { ok: false, code: 'too_long' }],
      ['Genetics\n\n' + 'x'.repeat(81), { ok: false, code: 'label_length', line: 3 }],
    ] as const
  ) {
    const input = fixture();
    expect(addOutlineTopics({
      ...input,
      text,
      newId: () => {
        throw new Error('Invalid paste must not create IDs');
      },
    })).toStrictEqual(expected);
    expect(input.definition).toStrictEqual(enrichmentDefinitionFixture());
  }
  expect(addOutlineTopics({ ...fixture(), subjectId: 'deleted', text: 'Genetics' })).toStrictEqual({
    ok: false,
    code: 'subject_missing',
  });
});

testCase('paste counts only new topics toward the whole-vocabulary limit', () => {
  const input = fixture();
  const result = addOutlineTopics({
    ...input,
    text: Array.from({ length: 248 }, (_, i) => `Topic ${i}`).join('\n'),
  });
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.definition.topics.length).toStrictEqual(250);
  expect(addOutlineTopics({ ...input, definition: result.definition, text: 'New topic' }))
    .toStrictEqual({
      ok: false,
      code: 'topic_limit',
    });
  const repeat = addOutlineTopics({ ...input, definition: result.definition, text: 'Cells' });
  if (!(repeat.ok)) expect.unreachable('Expected repeat.ok');
  expect(repeat.added).toStrictEqual(0);
});

testCase('paste fills a new setup without inventing an audience or source mappings', () => {
  const input = fixture();
  const result = addOutlineTopics({
    ...input,
    subjectId: 'subject',
    text: '- Genetics',
    definition: {
      ...input.definition,
      name: '',
      audience: '',
      difficulty: [],
      subjects: [{ id: 'subject', label: '', definition: '' }],
      topics: [{ id: 'topic', subjectId: 'subject', label: '', definition: '' }],
    },
  });
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.definition.name).toStrictEqual('Science');
  expect(result.definition.subjects).toStrictEqual([{
    id: 'subject',
    label: 'Science',
    definition: 'Science',
  }]);
  expect(result.definition.audience).toStrictEqual('');
  expect(result.definition.topics.length).toStrictEqual(1);
});
