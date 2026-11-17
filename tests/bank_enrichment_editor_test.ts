import { expect, test as testCase } from 'vitest';

import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import {
  changeEnrichmentExample,
  enrichmentDraftForSave,
  keepEnrichmentExample,
  regroupEnrichmentTopic,
  removeEnrichmentCategory,
  updateEnrichmentCategory,
} from '../lib/bank_enrichment_editor.ts';
import {
  parseEnrichmentDefinition,
  validEnrichmentReplacementMap,
} from '../lib/services/bank_enrichment_contract.ts';

function fixture() {
  return keepEnrichmentExample(enrichmentDefinitionFixture(), {
    questionId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    classification: {
      subject: { state: 'assigned', valueIds: ['life'] },
      topic: { state: 'assigned', valueIds: ['cells'] },
      difficulty: { state: 'assigned', valueIds: ['easy'] },
    },
  });
}
testCase(
  'vocabulary edits preserve identities and map merges against the producing predecessor',
  () => {
    const base = fixture();
    const renamed = updateEnrichmentCategory(base, 'subject', 'life', { label: 'Biology' });
    expect(renamed.subjects[0].id).toStrictEqual('life');
    expect(renamed.subjects[0].label).toStrictEqual('Biology');
    const merged = removeEnrichmentCategory(renamed, 'subject', 'life', 'physical');
    expect(merged.examples[0].classification.subject).toStrictEqual({
      state: 'assigned',
      valueIds: ['physical'],
    });
    expect(merged.topics[0].subjectId).toStrictEqual('physical');
    const mergedTopics = removeEnrichmentCategory(merged, 'topic', 'cells', 'energy');
    expect(mergedTopics.examples[0].classification.topic).toStrictEqual({
      state: 'assigned',
      valueIds: ['energy'],
    });
    if (!(parseEnrichmentDefinition(mergedTopics))) {
      expect.unreachable('Expected parseEnrichmentDefinition(mergedTopics)');
    }
    if (!(validEnrichmentReplacementMap(base, enrichmentDraftForSave(mergedTopics, base)))) {
      expect.unreachable(
        'Expected validEnrichmentReplacementMap(base, enrichmentDraftForSave(mergedTopics, base))',
      );
    }
    expect(enrichmentDraftForSave(mergedTopics, null).replacements).toStrictEqual([]);
    expect(base.subjects[0].label).toStrictEqual('Life science');
  },
);
testCase('regrouping and example changes never keep topics from a different subject', () => {
  const base = fixture();
  expect(removeEnrichmentCategory(base, 'topic', 'cells', 'energy')).toStrictEqual(base);
  const moved = regroupEnrichmentTopic(base, 'cells', 'physical');
  expect(moved.examples[0].classification.subject).toStrictEqual(
    base.examples[0].classification.subject,
  );
  expect(moved.examples[0].classification.topic?.state).toStrictEqual('unassigned');
  if (!(parseEnrichmentDefinition(moved))) {
    expect.unreachable('Expected parseEnrichmentDefinition(moved)');
  }
  const changed = changeEnrichmentExample(base, base.examples[0].questionId, 'subject', [
    'physical',
  ]);
  expect(changed.examples[0].classification.topic?.state).toStrictEqual('unassigned');
  if (!(parseEnrichmentDefinition(changed))) {
    expect.unreachable('Expected parseEnrichmentDefinition(changed)');
  }
  const removed = removeEnrichmentCategory(base, 'subject', 'life', null);
  expect(removed.examples[0].classification.subject?.state).toStrictEqual('unassigned');
  expect(removed.examples[0].classification.topic?.state).toStrictEqual('unassigned');
  if (!(validEnrichmentReplacementMap(base, enrichmentDraftForSave(removed, base)))) {
    expect.unreachable(
      'Expected validEnrichmentReplacementMap(base, enrichmentDraftForSave(removed, base))',
    );
  }
});
testCase(
  'explicit example adoption preserves instructor feedback and rejects stale sample categories',
  () => {
    const base = fixture();
    const original = base.examples[0];
    const corrected = changeEnrichmentExample(base, original.questionId, 'difficulty', ['hard']);
    expect(keepEnrichmentExample(corrected, original)).toStrictEqual(corrected);
    const stale = {
      ...original,
      questionId: crypto.randomUUID(),
      classification: {
        ...original.classification,
        difficulty: { state: 'assigned' as const, valueIds: ['obsolete'] },
      },
    };
    expect(keepEnrichmentExample(corrected, stale)).toStrictEqual(corrected);
    let full = corrected;
    for (let n = 0; n < 25; n++) {
      full = keepEnrichmentExample(full, {
        ...original,
        questionId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
      });
    }
    expect(full.examples.length).toStrictEqual(20);
    expect(full.examples[0].classification.difficulty).toStrictEqual({
      state: 'assigned',
      valueIds: ['hard'],
    });
  },
);
