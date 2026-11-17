import { expect, test as testCase } from 'vitest';

import {
  applyAuthoringPreferences,
  changedAuthoringSettings,
  parseAuthoringSettingsPatch,
} from '../lib/authoring_preferences.ts';
import { resolveAuthoringPreferences } from '../lib/instructor_defaults.ts';
import { createRailDraft } from '../islands/drivers/right_rail/rail_draft.ts';
import { toQti3InlineChoiceAuthoringItem } from '../lib/types/inline_choice.ts';
import { createItemSession, parseQtiXml } from '@longsightgroup/qti3-core';
import { writeQflowQti3AssessmentItemResult } from '../lib/types/qti3_writer_adapter.ts';

testCase('workspace answer order applies to actual new dropdown slots and canonical XML', () => {
  const blank = createRailDraft('inline_choice');
  const effective = resolveAuthoringPreferences(
    {
      answerChoiceOrder: 'shuffled',
      maximumScore: null,
    },
    [],
    null,
  );
  const draft = applyAuthoringPreferences(blank, 'inline_choice', effective);
  expect(draft.inlineChoices?.map((slot) => slot.shuffle)).toStrictEqual([true]);
  expect(blank.inlineChoices?.map((slot) => slot.shuffle)).toStrictEqual([false]);
  // Dropdown ordering belongs to the slots, not the generic flat-choice field.
  expect(draft.shuffle).toStrictEqual(false);
  const written = writeQflowQti3AssessmentItemResult(
    toQti3InlineChoiceAuthoringItem({
      ...draft,
      title: 'Dropdown default',
      inlineChoices: draft.inlineChoices ?? [],
    }, { lang: draft.itemLanguage }),
  );
  if (!written.ok) throw new Error('Expected usable dropdown default.');
  const parsed = parseQtiXml(written.xml);
  if (!parsed.ok || !parsed.document) throw new Error('Expected canonical dropdown XML.');
  expect(parsed.document.item.interactions[0]?.attributes.shuffle).toStrictEqual('true');
  const session = createItemSession(parsed.document);
  session.respond('RESPONSE_1', 'B');
  expect(session.score().outcomes.SCORE).toStrictEqual(1);
});

testCase(
  'dropdown assessment override and explicit reset take precedence without changing other settings',
  () => {
    for (const override of [false, null]) {
      const effective = resolveAuthoringPreferences({
        answerChoiceOrder: 'shuffled',
        maximumScore: null,
      }, [{
        typeId: 'inline_choice',
        settings: { shuffle: override, responseMode: 'partial' },
      }], null);
      const blank = createRailDraft('inline_choice');
      const next = applyAuthoringPreferences(blank, 'inline_choice', effective);
      expect(next.inlineChoices?.map((slot) => slot.shuffle)).toStrictEqual([false]);
      expect(next.responseMode).toStrictEqual('partial');
      expect(next.inlineChoices?.[0]?.options).toStrictEqual(blank.inlineChoices?.[0]?.options);
    }
    expect(parseAuthoringSettingsPatch('inline_choice', { shuffle: true })).toStrictEqual({
      shuffle: true,
    });
    expect(parseAuthoringSettingsPatch('inline_choice', { shuffle: 'true' })).toStrictEqual(null);
    expect(parseAuthoringSettingsPatch('inline_choice', { orientation: 'horizontal' }))
      .toStrictEqual(null);
  },
);

testCase(
  'uniform dropdown slot changes are remembered; mixed slot policies never invent a question-wide default',
  () => {
    const blank = createRailDraft('inline_choice');
    const first = blank.inlineChoices?.[0];
    if (!first) throw new Error('Expected a dropdown slot.');
    const before = {
      ...blank,
      inlineChoices: [first, { ...first, id: 'SECOND', label: 'Second' }],
    };
    const mixed = {
      ...before,
      inlineChoices: [{ ...first, shuffle: true }, before.inlineChoices[1]],
    };
    expect(changedAuthoringSettings('inline_choice', before, mixed)).toStrictEqual({});
    const uniform = {
      ...before,
      inlineChoices: before.inlineChoices.map((slot) => ({ ...slot, shuffle: true })),
    };
    expect(changedAuthoringSettings('inline_choice', before, uniform)).toStrictEqual({
      shuffle: true,
    });
    expect(changedAuthoringSettings('inline_choice', uniform, before)).toStrictEqual({
      shuffle: false,
    });
    const applied = applyAuthoringPreferences(before, 'inline_choice', [{
      typeId: 'inline_choice',
      settings: { shuffle: true },
    }]);
    expect(applied.inlineChoices?.map((slot) => slot.shuffle)).toStrictEqual([true, true]);
    expect(before.inlineChoices.map((slot) => slot.shuffle)).toStrictEqual([false, false]);
    expect(applied.inlineChoices?.map((slot) => slot.id)).toStrictEqual(['RESPONSE_1', 'SECOND']);
  },
);
