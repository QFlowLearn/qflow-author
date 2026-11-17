import { expect, test as testCase } from 'vitest';

import { applyAuthoringPreferences } from '../lib/authoring_preferences.ts';
import {
  parseEditorPreferencesForm,
  parseInstructorDefaults,
  resolveAuthoringPreferences,
} from '../lib/instructor_defaults.ts';
import { createRailDraft } from '../islands/drivers/right_rail/rail_draft.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { questionPointsInputText } from '../lib/question_points.ts';

testCase(
  'instructor defaults require explicit supported policy and closed editor form fields',
  () => {
    expect(parseInstructorDefaults(null)).toStrictEqual(null);
    expect(parseInstructorDefaults({ answerChoiceOrder: 'shuffled', maximumScore: null }))
      .toStrictEqual({
        answerChoiceOrder: 'shuffled',
        maximumScore: null,
      });
    for (
      const value of [
        {},
        { answerChoiceOrder: true },
        { answerChoiceOrder: 'shuffle' },
        { answerChoiceOrder: 'authored', assessmentId: 'x' },
      ]
    ) {
      expect(() => parseInstructorDefaults(value)).toThrowError(Error);
    }
    const form = new FormData();
    expect(parseEditorPreferencesForm(form, 'en-US')).toStrictEqual({ _tag: 'InvalidForm' });
    form.set('answerChoiceOrder', 'shuffled');
    form.set('maximumScore', '');
    expect(parseEditorPreferencesForm(form, 'en-US')).toStrictEqual({
      _tag: 'Parsed',
      preferences: {
        choiceRichText: false,
        instructorDefaults: { answerChoiceOrder: 'shuffled', maximumScore: null },
      },
    });
    form.set('choiceRichText', 'on');
    form.set('answerChoiceOrder', 'question-default');
    expect(parseEditorPreferencesForm(form, 'en-US')).toStrictEqual({
      _tag: 'Parsed',
      preferences: { choiceRichText: true, instructorDefaults: null },
    });
    form.append('answerChoiceOrder', 'authored');
    expect(parseEditorPreferencesForm(form, 'en-US')).toStrictEqual({ _tag: 'InvalidForm' });
    form.set('answerChoiceOrder', 'authored');
    form.set('tenantId', 'another-workspace');
    expect(parseEditorPreferencesForm(form, 'en-US')).toStrictEqual({ _tag: 'InvalidForm' });
  },
);

testCase(
  'workspace defaults apply to new supported choices; assessment settings and clears take precedence',
  () => {
    const defaults = { answerChoiceOrder: 'shuffled' as const, maximumScore: null };
    const local = [{
      typeId: 'single_select' as const,
      settings: { shuffle: false, required: true },
    }];
    const effective = resolveAuthoringPreferences(defaults, local, null);
    expect(
      applyAuthoringPreferences(createRailDraft('single_select'), 'single_select', effective)
        .shuffle,
    ).toStrictEqual(false);
    expect(
      applyAuthoringPreferences(createRailDraft('single_select'), 'single_select', effective)
        .required,
    ).toStrictEqual(true);
    expect(
      applyAuthoringPreferences(createRailDraft('multi_select'), 'multi_select', effective).shuffle,
    ).toStrictEqual(true);
    const clear = resolveAuthoringPreferences(defaults, [{
      typeId: 'single_select',
      settings: { shuffle: null },
    }], null);
    expect(
      applyAuthoringPreferences(createRailDraft('single_select'), 'single_select', clear).shuffle,
    ).toStrictEqual(createRailDraft('single_select').shuffle);
    for (const type of ['extended_text', 'order'] as const) {
      const blank = createRailDraft(type);
      expect(applyAuthoringPreferences(blank, type, effective)).toStrictEqual(blank);
    }
    expect(resolveAuthoringPreferences(null, local, null)).toStrictEqual(local);
    expect(local[0].settings).toStrictEqual({ shuffle: false, required: true });
  },
);

testCase(
  'resetting local scope reveals the workspace policy; resetting workspace keeps assessment overrides',
  () => {
    const local = [{ typeId: 'single_select' as const, settings: { shuffle: false } }];
    const defaults = { answerChoiceOrder: 'shuffled' as const, maximumScore: null };
    expect(
      resolveAuthoringPreferences(defaults, [], null).find((p) => p.typeId === 'single_select')
        ?.settings
        .shuffle,
    ).toStrictEqual(true);
    expect(resolveAuthoringPreferences(null, local, null)).toStrictEqual(local);
    expect(resolveAuthoringPreferences(null, [], null)).toStrictEqual([]);
  },
);

testCase(
  'point-only instructor policy retains zero and exact fractions without opting into answer order',
  () => {
    for (const maximumScore of [0, 3.125, 1e100]) {
      const policy = parseInstructorDefaults({ answerChoiceOrder: null, maximumScore });
      expect(policy).toStrictEqual({ answerChoiceOrder: null, maximumScore });
      const effective = resolveAuthoringPreferences(policy, [], null);
      for (const type of ['single_select', 'multi_select'] as const) {
        const blank = createRailDraft(type);
        const started = applyAuthoringPreferences(blank, type, effective);
        expect(started.maximumScore).toStrictEqual(maximumScore);
        expect(started.shuffle).toStrictEqual(blank.shuffle);
        expect(blank.maximumScore).toStrictEqual(undefined);
        const override = { ...blank, maximumScore: 5 };
        expect(applyAuthoringPreferences(override, type, effective).maximumScore).toStrictEqual(5);
        const source = { ...blank, preserveSourceXml: true };
        expect(applyAuthoringPreferences(source, type, effective)).toStrictEqual(source);
        const custom = { ...blank, responseMode: 'custom' as const };
        expect(applyAuthoringPreferences(custom, type, effective)).toStrictEqual(custom);
      }
      for (const type of ['inline_choice', 'extended_text', 'order'] as const) {
        const blank = createRailDraft(type);
        expect(applyAuthoringPreferences(blank, type, effective)).toStrictEqual(blank);
      }
    }
    for (const maximumScore of [-1, Infinity, NaN, '2']) {
      expect(() => parseInstructorDefaults({ answerChoiceOrder: null, maximumScore })).toThrowError(
        Error,
      );
    }
    expect(() => parseInstructorDefaults({ answerChoiceOrder: null, maximumScore: null }))
      .toThrowError(Error);
  },
);

testCase(
  'localized preference forms retain invalid point spelling and save explicit clears independently',
  () => {
    for (const locale of INTERFACE_LOCALES) {
      const form = new FormData();
      form.set('answerChoiceOrder', 'question-default');
      form.set('choiceRichText', 'on');
      for (const value of [0, 3.125]) {
        form.set('maximumScore', questionPointsInputText(value, locale));
        expect(parseEditorPreferencesForm(form, locale)).toStrictEqual({
          _tag: 'Parsed',
          preferences: {
            choiceRichText: true,
            instructorDefaults: { answerChoiceOrder: null, maximumScore: value },
          },
        });
      }
      for (const text of ['-', '-1', '1e309']) {
        form.set('maximumScore', text);
        expect(parseEditorPreferencesForm(form, locale)).toStrictEqual({
          _tag: 'InvalidPoints',
          form: { choiceRichText: true, answerChoiceOrder: 'question-default', pointText: text },
        });
      }
      form.set('maximumScore', '');
      expect(parseEditorPreferencesForm(form, locale)).toStrictEqual({
        _tag: 'Parsed',
        preferences: { choiceRichText: true, instructorDefaults: null },
      });
      form.set('answerChoiceOrder', 'authored');
      expect(parseEditorPreferencesForm(form, locale)).toStrictEqual({
        _tag: 'Parsed',
        preferences: {
          choiceRichText: true,
          instructorDefaults: { answerChoiceOrder: 'authored', maximumScore: null },
        },
      });
      form.append('maximumScore', '2');
      expect(parseEditorPreferencesForm(form, locale)).toStrictEqual({ _tag: 'InvalidForm' });
    }
  },
);

testCase(
  'assessment point preferences and explicit clears override workspace policy only for subsequent drafts',
  () => {
    const global = { answerChoiceOrder: null, maximumScore: 2 };
    const local = [{ typeId: 'single_select' as const, settings: { maximumScore: 0 } }];
    const effective = resolveAuthoringPreferences(global, local, null);
    expect(
      applyAuthoringPreferences(createRailDraft('single_select'), 'single_select', effective)
        .maximumScore,
    ).toStrictEqual(0);
    expect(
      applyAuthoringPreferences(createRailDraft('multi_select'), 'multi_select', effective)
        .maximumScore,
    ).toStrictEqual(2);
    const cleared = resolveAuthoringPreferences(global, [{
      typeId: 'single_select',
      settings: { maximumScore: null },
    }], null);
    expect(
      applyAuthoringPreferences(createRailDraft('single_select'), 'single_select', cleared)
        .maximumScore,
    ).toStrictEqual(undefined);
    expect(local).toStrictEqual([{ typeId: 'single_select', settings: { maximumScore: 0 } }]);
    expect(global).toStrictEqual({ answerChoiceOrder: null, maximumScore: 2 });
  },
);
