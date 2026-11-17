import { expect, test as testCase } from 'vitest';

import { parseQuestionPointEditingAuthority } from '../lib/question_point_authority.ts';

import { parseQuestionPointsInput, questionPointsInputText } from '../lib/question_points.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { questionPointEditingAuthority } from '../lib/services/question_points_editing.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

testCase('point input retains finite zero and full fractions in every supported locale', () => {
  for (const locale of INTERFACE_LOCALES) {
    for (const value of [0, 3, 3.125, 0.00000001, 1e20, 1e100]) {
      const text = questionPointsInputText(value, locale);
      expect(parseQuestionPointsInput(text, locale)).toStrictEqual({ _tag: 'Value', value });
    }
    expect(parseQuestionPointsInput('', locale)).toStrictEqual({ _tag: 'Unset' });
    expect(parseQuestionPointsInput('  ', locale)).toStrictEqual({ _tag: 'Unset' });
    expect(parseQuestionPointsInput('3.125', locale)).toStrictEqual({
      _tag: 'Value',
      value: 3.125,
    });
    for (
      const invalid of ['-', '-3', '0x10', 'Infinity', 'NaN', '1e', '1e309', '1,2,3', '2 cats']
    ) {
      expect(parseQuestionPointsInput(invalid, locale), invalid).toStrictEqual({ _tag: 'Invalid' });
    }
  }
  expect(parseQuestionPointsInput('3,125', 'es-ES')).toStrictEqual({ _tag: 'Value', value: 3.125 });
  expect(parseQuestionPointsInput('3,125', 'sv-SE')).toStrictEqual({ _tag: 'Value', value: 3.125 });
  expect(parseQuestionPointsInput('3,125', 'en-US')).toStrictEqual({ _tag: 'Invalid' });
});

testCase(
  'revision point authority is closed and survives actual JSON serialization without an inferred maximum',
  () => {
    for (
      const source of [
        { _tag: 'Generated' },
        { _tag: 'SourceOnly' },
        { _tag: 'SourceEditable', maximumScore: undefined },
        { _tag: 'SourceEditable', maximumScore: 0 },
        { _tag: 'SourceEditable', maximumScore: 3.125 },
      ] as const
    ) {
      expect(parseQuestionPointEditingAuthority(JSON.parse(JSON.stringify(source)))).toStrictEqual(
        source,
      );
    }
    for (
      const source of [
        undefined,
        null,
        {},
        { _tag: 'Generated', maximumScore: 3 },
        { _tag: 'SourceEditable', maximumScore: -1 },
        { _tag: 'SourceEditable', maximumScore: '3' },
        { _tag: 'SourceEditable', maximumScore: NaN },
        { _tag: 'SourceEditable', unknown: 1 },
      ]
    ) {
      expect(() => parseQuestionPointEditingAuthority(source)).toThrowError(Error);
    }
  },
);

testCase(
  'imported point authority uses source processing and keeps zero rather than granting a generated default',
  async () => {
    const sourceXml = await readQtiFixture('choice-points/practice.xml');
    expect(questionPointEditingAuthority({ contentBasis: 'source', sourceXml })).toStrictEqual({
      _tag: 'SourceEditable',
      maximumScore: 0,
    });
    const weighted = await readQtiFixture('choice-points/single.xml');
    const unmarked = weighted.replace(' normal-maximum="3"', '').replace(
      /\s*<qti-outcome-declaration identifier="MAXSCORE"[\s\S]*?<\/qti-outcome-declaration>/,
      '',
    );
    expect(questionPointEditingAuthority({ contentBasis: 'source', sourceXml: unmarked }))
      .toStrictEqual({
        _tag: 'SourceOnly',
      });
    expect(questionPointEditingAuthority({ contentBasis: 'source', sourceXml: '<bad/>' }))
      .toStrictEqual({
        _tag: 'SourceOnly',
      });
    const generated = questionPointEditingAuthority({ contentBasis: 'qflow', sourceXml: weighted });
    expect(generated).toStrictEqual({ _tag: 'Generated' });
    if (Object.hasOwn(generated, 'maximumScore')) {
      expect.unreachable("Expected !Object.hasOwn(generated, 'maximumScore')");
    }
  },
);
