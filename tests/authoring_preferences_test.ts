import { expect, test as testCase } from 'vitest';

import {
  applyAuthoringPreferences,
  changedAuthoringSettings,
  mergeAuthoringPreferences,
  parseAuthoringPreferences,
  parseAuthoringSettingsPatch,
} from '../lib/authoring_preferences.ts';
import { createRailDraft } from '../islands/drivers/right_rail/rail_draft.ts';

testCase('remembered settings reject content, incompatible types and custom scoring', () => {
  expect(parseAuthoringSettingsPatch('single_select', { correctId: 'A' })).toStrictEqual(null);
  expect(parseAuthoringSettingsPatch('single_select', { responseMode: 'custom' })).toStrictEqual(
    null,
  );
  expect(parseAuthoringSettingsPatch('single_select', { expectedLines: 4 })).toStrictEqual(null);
  expect(parseAuthoringSettingsPatch('extended_text', { expectedLines: -1 })).toStrictEqual(null);
  expect(parseAuthoringSettingsPatch('extended_text', { expectedLines: 201 })).toStrictEqual(null);
  expect(parseAuthoringSettingsPatch('extended_text', { expectedLength: 10001 })).toStrictEqual(
    null,
  );
  expect(parseAuthoringSettingsPatch('extended_text', { format: 'html' })).toStrictEqual(null);
  expect(parseAuthoringSettingsPatch('single_select', { shuffle: 'true' })).toStrictEqual(null);
  expect(parseAuthoringSettingsPatch('single_select', { shuffle: false })).toStrictEqual({
    shuffle: false,
  });
  expect(
    parseAuthoringPreferences([
      { typeId: 'single_select', settings: {} },
      { typeId: 'single_select', settings: {} },
    ]),
  ).toStrictEqual(null);
});
testCase(
  'explicit differences remember cosmetic settings without copying content or unchanged imported settings',
  () => {
    const before = {
      ...createRailDraft('single_select'),
      shuffle: false,
      sharedVocabulary: { orientation: 'horizontal' as const },
    };
    const after = { ...before, title: 'Edited imported question', correctId: 'B', shuffle: true };
    expect(changedAuthoringSettings('single_select', before, after)).toStrictEqual({
      shuffle: true,
    });
    const memory = mergeAuthoringPreferences([], 'single_select', {
      shuffle: true,
      orientation: 'horizontal',
    });
    const blank = createRailDraft('multi_select');
    const inherited = applyAuthoringPreferences(blank, 'multi_select', memory);
    expect(inherited.shuffle).toStrictEqual(true);
    expect(inherited.sharedVocabulary?.orientation).toStrictEqual('horizontal');
    expect(inherited.title).toStrictEqual(blank.title);
    expect(inherited.choices).toStrictEqual(blank.choices);
    expect(inherited.correctIds).toStrictEqual(blank.correctIds);
    expect(applyAuthoringPreferences(createRailDraft('extended_text'), 'extended_text', memory))
      .toStrictEqual(createRailDraft('extended_text'));
  },
);
testCase(
  'clearing a setting restores the type default and independent patches retain previous choices',
  () => {
    const remembered = mergeAuthoringPreferences([], 'extended_text', {
      expectedLines: 15,
      format: 'xhtml',
    });
    const cleared = mergeAuthoringPreferences(remembered, 'extended_text', { expectedLines: null });
    const blank = createRailDraft('extended_text');
    const next = applyAuthoringPreferences(blank, 'extended_text', cleared);
    expect(next.expectedLines).toStrictEqual(blank.expectedLines);
    expect(next.format).toStrictEqual('xhtml');
  },
);
