import { expect, test as testCase } from 'vitest';

import { questionSelectionIdentity } from '../lib/question_selection_identity.ts';
import {
  allocateDistinctQuestions,
  type DistinctQuestionCandidate,
} from '../lib/bank_question_allocation.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

function xml() {
  return exportQti3AssessmentItemXml(
    'single_select',
    prepareDriverDraftForBuild('single_select', {
      ...TYPE_DRIVERS.single_select.defaults(),
      itemLanguage: newAuthoringItemLanguage(),
      title: 'First title',
      bodyHtml: '<p>Passage: there are 5 cells.</p>',
      promptHtml: '<p>How many cells?</p>',
      choices: [{ id: 'A', text: '5' }, { id: 'B', text: '6' }],
      correctId: 'A',
    }),
    { identifier: 'first-item' },
  );
}
testCase(
  'selection equality ignores item identity but retains keys, numbers, scoring and passages',
  async () => {
    const source = xml(), identity = await questionSelectionIdentity(source);
    if (!identity) expect.unreachable(source);
    expect(
      await questionSelectionIdentity(
        source.replace('first-item', 'different-item').replace('First title', 'Renamed title'),
      ),
    ).toStrictEqual(identity);
    for (
      const changed of [
        source.replace('<qti-value>A</qti-value>', '<qti-value>B</qti-value>'),
        source.replace('there are 5 cells', 'there are 6 cells'),
        source.replace('How many cells?', 'How many nuclei?'),
        source.replace(
          /<qti-response-processing[^>]+\/>/,
          '<qti-response-processing><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">2</qti-base-value></qti-set-outcome-value></qti-response-processing>',
        ),
      ]
    ) {
      expect(changed).not.toStrictEqual(source);
      const next = await questionSelectionIdentity(changed);
      if (!next) expect.unreachable('Expected next');
      expect(next).not.toStrictEqual(identity);
    }
  },
);
testCase(
  'selection equality refuses unresolved passage, media and executable content',
  async () => {
    const source = xml();
    for (
      const external of [
        '<img src="same-path.png"/>',
        '<qti-assessment-stimulus-ref identifier="passage" href="passage.xml"/>',
        '<script>differentAtRuntime()</script>',
        '<img src="#missing-image"/>',
        '<p style="background-image: url(image.png)">text</p>',
      ]
    ) {
      expect(
        await questionSelectionIdentity(
          source.replace('<qti-item-body>', `<qti-item-body>${external}`),
        ),
      ).toStrictEqual(null);
    }
    expect(await questionSelectionIdentity('not XML')).toStrictEqual(null);
  },
);
const candidate = (identity: string, categoryId: string): DistinctQuestionCandidate => ({
  itemId: `${identity}-${categoryId}`,
  revisionId: identity,
  versionId: 'version',
  identity,
  categoryId,
});
testCase(
  'distinct allocation reassigns overlap to preserve quotas and computes joint shortfalls',
  () => {
    const candidates = [
      candidate('shared', 'cells'),
      candidate('shared', 'energy'),
      candidate('only-cells', 'cells'),
    ];
    const counts = [{ categoryId: 'cells', count: 1 }, { categoryId: 'energy', count: 1 }];
    const result = allocateDistinctQuestions(candidates, counts, () => 0);
    expect(result.map((c) => [c.identity, c.categoryId])).toStrictEqual([['only-cells', 'cells'], [
      'shared',
      'energy',
    ]]);
    expect(allocateDistinctQuestions(candidates.slice(0, 2), counts, () => 0).length).toStrictEqual(
      1,
    );
    expect(
      allocateDistinctQuestions([...candidates, candidate('only-cells', 'cells')], [{
        categoryId: 'cells',
        count: 3,
      }], () => 0).length,
    ).toStrictEqual(2);
  },
);
