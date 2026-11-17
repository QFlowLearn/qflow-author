import { expect, test as testCase } from 'vitest';

import {
  parseEnrichmentClassification,
  parseEnrichmentDefinition,
  validEnrichmentReplacementMap,
} from '../lib/services/bank_enrichment_contract.ts';
import { parseEnrichmentScope } from '../lib/services/bank_enrichment_scope.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import {
  parsePrepareEnrichmentRun,
  transitionEnrichmentRun,
} from '../lib/services/bank_enrichment_run_contract.ts';

testCase(
  'enrichment definition rejects unknown fields, ambiguous categories and invalid hierarchy',
  () => {
    const definition = enrichmentDefinitionFixture();
    expect(parseEnrichmentDefinition(definition)).toStrictEqual(definition);
    const topicOnly = { ...definition, difficulty: [] };
    expect(parseEnrichmentDefinition(topicOnly)).toStrictEqual(topicOnly);
    for (
      const invalid of [
        { ...definition, standards: [] },
        { ...definition, audience: ' ' },
        { ...definition, difficulty: [definition.difficulty[0]] },
        { ...definition, subjects: [definition.subjects[0], definition.subjects[0]] },
        {
          ...definition,
          subjects: [definition.subjects[0], { ...definition.subjects[1], label: 'LIFE SCIENCE' }],
        },
        { ...definition, topics: [{ ...definition.topics[0], subjectId: 'missing' }] },
        {
          ...definition,
          difficulty: [
            { ...definition.difficulty[0], id: 'invalid category' },
            definition.difficulty[1],
          ],
        },
      ]
    ) expect(parseEnrichmentDefinition(invalid)).toStrictEqual(null);
  },
);

testCase(
  'classification uses only the frozen vocabulary and enforces cardinality and topic parent',
  () => {
    const definition = enrichmentDefinitionFixture();
    const assigned = (id: string) => ({ state: 'assigned', valueIds: [id] });
    const classification = {
      subject: assigned('life'),
      topic: assigned('cells'),
      difficulty: assigned('moderate'),
    };
    if (!(parseEnrichmentClassification(classification, definition))) {
      expect.unreachable('Expected parseEnrichmentClassification(classification, definition)');
    }
    for (
      const invalid of [
        { ...classification, confidence: 1 },
        { ...classification, subject: assigned('invented') },
        { ...classification, topic: assigned('energy') },
        { ...classification, difficulty: { state: 'assigned', valueIds: ['easy', 'hard'] } },
        { ...classification, topic: { state: 'assigned', valueIds: ['cells', 'cells'] } },
        { ...classification, subject: { state: 'unassigned', reason: 'outside_scheme' } },
        { ...classification, topic: { state: 'assigned', valueIds: [] } },
        { ...classification, topic: { state: 'unassigned', reason: 'guess' } },
      ]
    ) expect(parseEnrichmentClassification(invalid, definition)).toStrictEqual(null);
    if (
      !(parseEnrichmentClassification({
        ...classification,
        topic: { state: 'unassigned', reason: 'insufficient_context' },
      }, definition))
    ) {
      expect.unreachable(
        "Expected parseEnrichmentClassification({ ...classification, topic: { state: 'unassigned', reason: '",
      );
    }
  },
);

testCase('scheme merges explicitly account for removed identities without guessing', () => {
  const previous = enrichmentDefinitionFixture();
  const removed = parseEnrichmentDefinition({
    ...previous,
    difficulty: previous.difficulty.slice(0, 2),
    replacements: [{ dimension: 'difficulty', fromId: 'hard', toId: 'moderate' }],
  });
  if (!removed) expect.unreachable('Expected removed');
  if (!(validEnrichmentReplacementMap(previous, removed))) {
    expect.unreachable('Expected validEnrichmentReplacementMap(previous, removed)');
  }
  expect(validEnrichmentReplacementMap(null, removed)).toStrictEqual(false);
  expect(validEnrichmentReplacementMap(previous, { ...removed, replacements: [] })).toStrictEqual(
    false,
  );
  expect(parseEnrichmentDefinition({
    ...removed,
    replacements: [{ dimension: 'difficulty', fromId: 'hard', toId: 'imaginary' }],
  })).toStrictEqual(null);
});

testCase('saved examples pin a source revision and reject moving question-only references', () => {
  const definition = enrichmentDefinitionFixture();
  const questionId = '00000000-0000-4000-8000-000000000001';
  const revisionId = '00000000-0000-4000-8000-000000000002';
  const classification = {
    subject: { state: 'assigned', valueIds: ['life'] },
    topic: { state: 'assigned', valueIds: ['cells'] },
    difficulty: { state: 'assigned', valueIds: ['easy'] },
  };
  expect(parseEnrichmentDefinition({ ...definition, examples: [{ questionId, classification }] }))
    .toStrictEqual(null);
  if (
    !(parseEnrichmentDefinition({
      ...definition,
      examples: [{ questionId, revisionId, classification }],
    }))
  ) {
    expect.unreachable(
      'Expected parseEnrichmentDefinition({ ...definition, examples: [{ questionId, revisionId, classifica',
    );
  }
});

testCase('enrichment scope ignores presentation but rejects unknown and duplicate filters', () => {
  const scope = parseEnrichmentScope({
    _tag: 'Filtered',
    queryString: 'tags=biology&page=2&pageSize=10&sort=title&direction=desc',
  });
  if (!(scope?._tag === 'Filtered')) expect.unreachable("Expected scope?._tag === 'Filtered'");
  expect(scope.query.tags).toStrictEqual(['biology']);
  expect(scope.queryString).toStrictEqual('tags=biology');
  expect(scope.query.page).toStrictEqual(1);
  for (const queryString of ['tags=biology&surprise=true', 'q=x&q=y', 'page=wrong']) {
    expect(parseEnrichmentScope({ _tag: 'Filtered', queryString })).toStrictEqual(null);
  }
  const id = '00000000-0000-4000-8000-000000000001';
  expect(parseEnrichmentScope({ _tag: 'Selected', questionIds: [id, id] })).toStrictEqual(null);
  expect(parseEnrichmentScope({ _tag: 'Selected', questionIds: ['not-an-id'] })).toStrictEqual(
    null,
  );
});

testCase(
  'full-run commands freeze an explicit policy and enforce legal lifecycle transitions',
  () => {
    const command = {
      snapshotId: '00000000-0000-4000-8000-000000000001',
      versionId: '00000000-0000-4000-8000-000000000002',
      dimensions: ['subject', 'topic', 'difficulty'],
      replacement: 'preserve_manual',
    };
    if (!(parsePrepareEnrichmentRun(command))) {
      expect.unreachable('Expected parsePrepareEnrichmentRun(command)');
    }
    expect(parsePrepareEnrichmentRun({ ...command, dimensions: ['subject'] })).toStrictEqual(null);
    expect(parsePrepareEnrichmentRun({ ...command, dimensions: ['difficulty', 'difficulty'] }))
      .toStrictEqual(null);
    expect(parsePrepareEnrichmentRun({ ...command, replacement: 'overwrite_all' })).toStrictEqual(
      null,
    );
    expect(transitionEnrichmentRun('prepared', 'running')).toStrictEqual({
      ok: false,
      code: 'invalid_transition',
    });
    expect(transitionEnrichmentRun('completed', 'queued')).toStrictEqual({
      ok: false,
      code: 'invalid_transition',
    });
    expect(transitionEnrichmentRun('prepared', 'queued')).toStrictEqual({
      ok: true,
      value: 'queued',
    });
    expect(transitionEnrichmentRun('cancelled', 'queued')).toStrictEqual({
      ok: true,
      value: 'queued',
    });
  },
);

testCase(
  'teaching examples distinguish unknown dimensions from protected unassigned values',
  () => {
    const definition = enrichmentDefinitionFixture();
    const example = {
      questionId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      classification: {
        subject: { state: 'assigned' as const, valueIds: ['life'] },
        topic: { state: 'assigned' as const, valueIds: ['cells'] },
        difficulty: null,
      },
    };
    expect(parseEnrichmentDefinition({ ...definition, examples: [example] })?.examples)
      .toStrictEqual([
        example,
      ]);
    expect(parseEnrichmentDefinition({
      ...definition,
      examples: [{
        ...example,
        classification: { subject: null, topic: null, difficulty: null },
      }],
    })).toStrictEqual(null);
    expect(parseEnrichmentDefinition({
      ...definition,
      examples: [{ ...example, classification: { ...example.classification, subject: null } }],
    })).toStrictEqual(null);
  },
);
