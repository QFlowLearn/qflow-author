import { expect, test as testCase } from 'vitest';

import {
  applyLabelSuffix,
  choiceLabel,
  choiceLabelOptionsFromVocabulary,
  defaultChoiceLabel,
  nextChoiceId,
  qtiListMarker,
} from '../lib/choice_labels.ts';

testCase('qtiListMarker maps supported label styles', () => {
  expect(qtiListMarker(0, 'decimal')).toStrictEqual('1');
  expect(qtiListMarker(2, 'decimal')).toStrictEqual('3');
  expect(qtiListMarker(0, 'lower-alpha')).toStrictEqual('a');
  expect(qtiListMarker(25, 'lower-alpha')).toStrictEqual('z');
  expect(qtiListMarker(26, 'lower-alpha')).toStrictEqual('aa');
  expect(qtiListMarker(0, 'upper-alpha')).toStrictEqual('A');
  expect(qtiListMarker(1, 'upper-alpha')).toStrictEqual('B');
  expect(qtiListMarker(0, 'cjk-ideographic')).toStrictEqual('一');
  expect(qtiListMarker(9, 'cjk-ideographic')).toStrictEqual('十');
  expect(qtiListMarker(10, 'cjk-ideographic')).toStrictEqual('十一');
  expect(qtiListMarker(0, 'none')).toStrictEqual('');
});

testCase(
  'nextChoiceId uses the first free alphabetic identifier without changing existing ids',
  () => {
    const ids = new Set(['A', 'C', 'custom-id']);
    expect(nextChoiceId(ids)).toStrictEqual('B');
    expect([...ids]).toStrictEqual(['A', 'C', 'custom-id']);
    expect(nextChoiceId(new Set())).toStrictEqual('A');
  },
);

testCase('nextChoiceId allocates beyond Z and reuses gaps in long lists', () => {
  const ids = new Set(
    Array.from({ length: 26 }, (_, index) => qtiListMarker(index, 'upper-alpha')),
  );
  expect(nextChoiceId(ids)).toStrictEqual('AA');
  ids.add('AA');
  expect(nextChoiceId(ids)).toStrictEqual('AB');
  ids.delete('Z');
  expect(nextChoiceId(ids)).toStrictEqual('Z');
});

testCase('applyLabelSuffix formats period and parenthesis markers', () => {
  expect(applyLabelSuffix('A', 'period')).toStrictEqual('A.');
  expect(applyLabelSuffix('A', 'parenthesis')).toStrictEqual('(A)');
  expect(applyLabelSuffix('A', 'none')).toStrictEqual('A');
  expect(applyLabelSuffix('A')).toStrictEqual('A');
});

testCase('defaultChoiceLabel uses the choice id when style is unset', () => {
  expect(defaultChoiceLabel({ id: 'choice-a' }, 4)).toStrictEqual('choice-a');
  expect(defaultChoiceLabel({ id: 'A' }, 1)).toStrictEqual('A');
  expect(defaultChoiceLabel({}, 1)).toStrictEqual('B');
});

testCase('choiceLabel honors shared vocabulary style and suffix', () => {
  const options = choiceLabelOptionsFromVocabulary({
    labelStyle: 'lower-alpha',
    labelSuffix: 'parenthesis',
  });
  expect(choiceLabel({ id: 'ignored' }, 2, options)).toStrictEqual('(c)');
  expect(choiceLabel({ label: 'Custom' }, 2, options)).toStrictEqual('(Custom)');
});

testCase('decimal style ignores choice id in favor of list position', () => {
  expect(defaultChoiceLabel({ id: 'A' }, 0, { style: 'decimal' })).toStrictEqual('1');
});
