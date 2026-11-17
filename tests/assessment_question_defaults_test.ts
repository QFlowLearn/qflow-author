import { expect, test as testCase } from 'vitest';

import { applyAuthoringPreferences } from '../lib/authoring_preferences.ts';
import { resolveAuthoringPreferences } from '../lib/instructor_defaults.ts';
import { createRailDraft } from '../islands/drivers/right_rail/rail_draft.ts';

import {
  parseAssessmentQuestionPointDefaultCommand,
  parseAssessmentQuestionPointDefaultResponse,
  parseStoredAssessmentQuestionPointDefault,
} from '../lib/assessment_question_defaults.ts';

testCase(
  'assessment point-default commands preserve explicit unset, zero and exact fractions',
  () => {
    for (const expected of [null, 0, 3.125]) {
      for (const desired of [null, 0, 3.125]) {
        expect(parseAssessmentQuestionPointDefaultCommand({ expected, desired })).toStrictEqual({
          _tag: 'Parsed',
          command: { expected, desired },
        });
      }
    }
  },
);

testCase(
  'default acknowledgements are closed projections preserving fractions and explicit unset',
  () => {
    for (const tag of ['Found', 'Saved'] as const) {
      for (const value of [null, 0, 3.125]) {
        expect(parseAssessmentQuestionPointDefaultResponse({ _tag: tag, value }, tag))
          .toStrictEqual({
            _tag: 'Parsed',
            value,
          });
      }
      for (
        const body of [
          null,
          [],
          {},
          { _tag: tag },
          { _tag: tag, value: '3' },
          { _tag: tag, value: -1 },
          { _tag: tag, value: Infinity },
          { _tag: tag, value: 3, extra: true },
          { _tag: 'Rejected', value: 3 },
        ]
      ) {
        expect(parseAssessmentQuestionPointDefaultResponse(body, tag)).toStrictEqual({
          _tag: 'Invalid',
        });
      }
    }
  },
);

testCase(
  'assessment point defaults reject missing, extra, coercible and nonfinite request fields',
  () => {
    for (
      const value of [undefined, {}, [], null, { expected: null }, {
        expected: null,
        desired: 2,
        extra: true,
      }, { desired: 0 }]
    ) {
      expect(parseAssessmentQuestionPointDefaultCommand(value)).toStrictEqual({ _tag: 'Invalid' });
    }
    for (const value of [undefined, '', '2', true, -1, NaN, Infinity, -Infinity, {}, []]) {
      expect(parseAssessmentQuestionPointDefaultCommand({ expected: null, desired: value }))
        .toStrictEqual({
          _tag: 'Invalid',
        });
      expect(parseAssessmentQuestionPointDefaultCommand({ expected: value, desired: 0 }))
        .toStrictEqual({
          _tag: 'Invalid',
        });
      expect(() => parseStoredAssessmentQuestionPointDefault(value)).toThrowError(Error);
    }
    expect(parseStoredAssessmentQuestionPointDefault(null)).toStrictEqual(null);
    expect(parseStoredAssessmentQuestionPointDefault(0)).toStrictEqual(0);
    expect(parseStoredAssessmentQuestionPointDefault(3.125)).toStrictEqual(3.125);
  },
);

testCase(
  'shared point defaults override personal point presets while preserving answer policies and explicit question values',
  () => {
    const personal = [{
      typeId: 'single_select' as const,
      settings: { maximumScore: 5, shuffle: false },
    }, {
      typeId: 'multi_select' as const,
      settings: { maximumScore: null, responseMode: 'partial' as const },
    }];
    for (const maximumScore of [0, 3.125]) {
      const effective = resolveAuthoringPreferences(
        {
          maximumScore: 2,
          answerChoiceOrder: 'shuffled',
        },
        personal,
        maximumScore,
      );
      for (const type of ['single_select', 'multi_select'] as const) {
        const fresh = applyAuthoringPreferences(createRailDraft(type), type, effective);
        expect(fresh.maximumScore).toStrictEqual(maximumScore);
        const explicit = applyAuthoringPreferences(
          { ...createRailDraft(type), maximumScore: 7.5 },
          type,
          effective,
        );
        expect(explicit.maximumScore).toStrictEqual(7.5);
      }
      expect(effective.find((p) => p.typeId === 'single_select')?.settings.shuffle).toStrictEqual(
        false,
      );
      expect(effective.find((p) => p.typeId === 'multi_select')?.settings.responseMode)
        .toStrictEqual('partial');
      expect(effective.find((p) => p.typeId === 'inline_choice')?.settings.maximumScore)
        .toStrictEqual(undefined);
    }
    const unset = resolveAuthoringPreferences(
      {
        maximumScore: 2,
        answerChoiceOrder: null,
      },
      personal,
      null,
    );
    expect(
      applyAuthoringPreferences(createRailDraft('single_select'), 'single_select', unset)
        .maximumScore,
    ).toStrictEqual(5);
    expect(
      applyAuthoringPreferences(createRailDraft('multi_select'), 'multi_select', unset)
        .maximumScore,
    ).toStrictEqual(undefined);
  },
);
