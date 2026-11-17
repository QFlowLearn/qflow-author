import { expect, test as testCase } from 'vitest';

import {
  applyPersistedSettingsChange,
  applySettingsChange,
  buildRightRailControls,
  createRailDraft,
  settingsFromRailDraft,
} from '../islands/drivers/right_rail.tsx';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import type { QuestionTypeId } from '../lib/types/registry.ts';
import { stripRailOnlyDraftFields } from '../lib/types/draft_utils.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage, parseItemLanguage } from '../lib/types/item_language.ts';
import type { RailDraft } from '../islands/drivers/right_rail/rail_draft.ts';

function pick<T extends Record<string, unknown>>(value: T, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

type NewRailSeed = Omit<Draft, 'itemLanguage'>;
const ITEM_LANGUAGE_MESSAGES = {
  label: 'Item language',
  help: 'Enter any valid BCP 47 tag, such as en-US, es-419, or fr-CA.',
  required: 'Item language is required.',
  invalid: 'Enter a valid BCP 47 language tag.',
} as const;

function createTestRailDraft(typeId: QuestionTypeId, seed?: NewRailSeed): RailDraft {
  return createRailDraft(typeId, {
    ...(seed ?? {}),
    itemLanguage: newAuthoringItemLanguage(),
  });
}

testCase('reapplying a settled single-selection limit leaves the persisted draft untouched', () => {
  for (const typeId of ['hottext', 'hotspot', 'select_point', 'position_object'] as const) {
    const update = { typeId, values: { maxChoices: 1 } };
    const settled = applyPersistedSettingsChange(createTestRailDraft(typeId), update);
    expect(applyPersistedSettingsChange(settled, update), typeId).toBe(settled);
  }
});

testCase(
  'settled portable modules preserve the draft while replacements remain independent',
  () => {
    for (const modules of [[], [{ id: 'module', primaryPath: 'modules/module.js' }]]) {
      const draft = createTestRailDraft('portable_custom', { portableInteractionModules: modules });
      const settled = applyPersistedSettingsChange(
        draft,
        settingsFromRailDraft('portable_custom', draft),
      );
      const reopened = createRailDraft('portable_custom', settled);
      expect(
        applyPersistedSettingsChange(settled, settingsFromRailDraft('portable_custom', reopened)),
      ).toBe(settled);
      const replacement = [{ id: 'replacement', primaryPath: 'modules/replacement.js' }];
      const changed = applyPersistedSettingsChange(settled, {
        typeId: 'portable_custom',
        values: { portableInteractionModules: replacement },
      });
      expect(changed.portableInteractionModules).toStrictEqual(replacement);
      expect(changed.portableInteractionModules === replacement).toStrictEqual(false);
      expect(settled.portableInteractionModules).toStrictEqual(modules);
    }
  },
);

function sectionIds(typeId: QuestionTypeId) {
  const driver = TYPE_DRIVERS[typeId];
  const controls = buildRightRailControls(
    typeId,
    driver.capabilities,
    createTestRailDraft(typeId),
    () => {},
    {
      scoringTemplates: driver.scoringTemplates,
      itemLanguageMessages: ITEM_LANGUAGE_MESSAGES,
      t: (id) => id,
    },
  );
  return controls.sections.map((section) => section.id);
}

testCase('right rail exposes generic selection constraints for min/max choice types', () => {
  expect(createTestRailDraft('single_select').itemLanguage).toStrictEqual('en-US');
  for (
    const typeId of [
      'multi_select',
      'hottext',
      'hotspot',
      'graphic_order',
      'select_point',
      'position_object',
    ] as const
  ) {
    expect(sectionIds(typeId).includes('selection'), typeId).toStrictEqual(true);
  }
});

testCase('right rail keeps ordering constraints in the order section', () => {
  const ids = sectionIds('order');
  expect(ids.includes('order')).toStrictEqual(true);
  expect(ids.includes('selection')).toStrictEqual(false);
});

testCase('right rail exposes shared vocabulary controls for supported interaction types', () => {
  expect(sectionIds('single_select').includes('shared_vocabulary')).toStrictEqual(true);
  expect(sectionIds('match').includes('shared_vocabulary')).toStrictEqual(true);
  expect(sectionIds('gap_match').includes('shared_vocabulary')).toStrictEqual(true);

  const driver = TYPE_DRIVERS.single_select;
  const draft = createTestRailDraft('single_select', {
    type: 'single_select',
    sharedVocabulary: { labelStyle: 'decimal' },
  });
  let nextDraft = draft;
  const controls = buildRightRailControls(
    'single_select',
    driver.capabilities,
    draft,
    (next) => {
      nextDraft = next;
    },
    {
      scoringTemplates: driver.scoringTemplates,
      itemLanguageMessages: ITEM_LANGUAGE_MESSAGES,
      t: (id) => id,
    },
  );

  expect(controls.sharedLabelStyle?.value).toStrictEqual('decimal');
  controls.sharedSelectionTone?.onChange('dark');
  expect(nextDraft.sharedVocabulary?.selectionTone).toStrictEqual('dark');
  controls.sharedInputControlHidden?.onChange(true);
  expect(nextDraft.sharedVocabulary?.inputControlHidden).toStrictEqual(true);
});

testCase('right rail stores orientation in shared vocabulary for order', () => {
  const driver = TYPE_DRIVERS.order;
  const draft = createTestRailDraft('order', {
    type: 'order',
    sharedVocabulary: { orientation: 'horizontal' },
  });
  let nextDraft = draft;
  const controls = buildRightRailControls(
    'order',
    driver.capabilities,
    draft,
    (next) => {
      nextDraft = next;
    },
    {
      scoringTemplates: driver.scoringTemplates,
      itemLanguageMessages: ITEM_LANGUAGE_MESSAGES,
      t: (id) => id,
    },
  );

  expect(controls.sharedOrientation?.value).toStrictEqual('horizontal');
  controls.sharedOrientation?.onChange('vertical');
  expect(nextDraft.sharedVocabulary?.orientation).toStrictEqual('vertical');

  const updated = applySettingsChange(createTestRailDraft('order'), {
    typeId: 'order',
    values: { sharedVocabulary: { orientation: 'horizontal' } },
  });
  expect(updated.sharedVocabulary?.orientation).toStrictEqual('horizontal');
});

testCase('slider rail exposes slider behavior toggles and syncs them both directions', () => {
  const ids = sectionIds('slider');
  expect(ids.includes('slider')).toStrictEqual(true);

  const draft = createTestRailDraft('slider', {
    type: 'slider',
    sliderStepLabel: true,
    sliderReverse: false,
  });

  expect(pick(settingsFromRailDraft('slider', draft).values, [
    'allowPins',
    'sliderStepLabel',
    'sliderReverse',
  ])).toStrictEqual({
    allowPins: false,
    sliderStepLabel: true,
    sliderReverse: false,
  });

  const changed = applySettingsChange(draft, {
    typeId: 'slider',
    values: { sliderStepLabel: false, sliderReverse: true },
  });

  expect(changed.sliderStepLabel).toStrictEqual(false);
  expect(changed.sliderReverse).toStrictEqual(true);
});

testCase('hotspot rail settings use canonical selection fields', () => {
  const draft = createTestRailDraft('hotspot', {
    type: 'hotspot',
    minChoices: 1,
    maxChoices: 3,
    minChoicesMessage: 'Pick one',
    maxChoicesMessage: 'Too many',
    correctIds: ['A', 'B'],
  });

  expect(pick(settingsFromRailDraft('hotspot', draft).values, [
    'allowPins',
    'minChoices',
    'maxChoices',
    'selectionMinMessage',
    'selectionMaxMessage',
  ])).toStrictEqual({
    allowPins: false,
    minChoices: 1,
    maxChoices: 3,
    selectionMinMessage: 'Pick one',
    selectionMaxMessage: 'Too many',
  });

  const changed = applySettingsChange(draft, {
    typeId: 'hotspot',
    values: {
      minChoices: 2,
      maxChoices: 1,
      selectionMinMessage: 'Select two',
      selectionMaxMessage: 'Only one allowed',
    },
  });

  expect(changed.minChoices).toStrictEqual(2);
  expect(changed.maxChoices).toStrictEqual(1);
  expect(changed.minChoicesMessage).toStrictEqual('Select two');
  expect(changed.maxChoicesMessage).toStrictEqual('Only one allowed');
  expect(changed.correctIds).toStrictEqual(['A']);
});

testCase('right rail max choice updates trim response sets when switching to single', () => {
  const hotspotDraft = createTestRailDraft('hotspot', {
    type: 'hotspot',
    maxChoices: 3,
    correctIds: ['A', 'B'],
  });
  let hotspotNext = hotspotDraft;
  const hotspotControls = buildRightRailControls(
    'hotspot',
    TYPE_DRIVERS.hotspot.capabilities,
    hotspotDraft,
    (next) => {
      hotspotNext = next;
    },
    { itemLanguageMessages: ITEM_LANGUAGE_MESSAGES, t: (id) => id },
  );
  hotspotControls.maxChoices?.onChange(1);
  expect(hotspotNext.maxChoices).toStrictEqual(1);
  expect(hotspotNext.correctIds).toStrictEqual(['A']);

  const selectPointDraft = createTestRailDraft('select_point', {
    type: 'select_point',
    maxChoices: 3,
    selectPointCorrectPoints: ['10 10', '20 20'],
  });
  let selectPointNext = selectPointDraft;
  const selectPointControls = buildRightRailControls(
    'select_point',
    TYPE_DRIVERS.select_point.capabilities,
    selectPointDraft,
    (next) => {
      selectPointNext = next;
    },
    { itemLanguageMessages: ITEM_LANGUAGE_MESSAGES, t: (id) => id },
  );
  selectPointControls.maxChoices?.onChange(1);
  expect(selectPointNext.maxChoices).toStrictEqual(1);
  expect(selectPointNext.selectPointCorrectPoints).toStrictEqual(['10 10']);
});

testCase('select point preserves zero as an unlimited maximum', () => {
  const draft = createTestRailDraft('select_point', {
    type: 'select_point',
    maxChoices: 2,
    selectPointCorrectPoints: ['10 10', '20 20'],
  });
  let nextDraft = draft;
  const controls = buildRightRailControls(
    'select_point',
    TYPE_DRIVERS.select_point.capabilities,
    draft,
    (next) => {
      nextDraft = next;
    },
    { itemLanguageMessages: ITEM_LANGUAGE_MESSAGES, t: (id) => id },
  );

  controls.maxChoices?.onChange(0);

  expect(nextDraft.maxChoices).toStrictEqual(0);
  expect(nextDraft.selectPointCorrectPoints).toStrictEqual(['10 10', '20 20']);
});

testCase('extended text rail settings map advanced fields both directions', () => {
  const draft = createTestRailDraft('extended_text', {
    type: 'extended_text',
    expectedLength: 200,
    expectedLines: 6,
    placeholderText: 'Start here',
    format: 'xhtml',
    heightClass: 'qti-height-lines-6',
    counterType: 'down',
    minStrings: 1,
    maxStrings: 3,
    patternMask: '[A-Z]+',
    patternMessage: 'Uppercase only',
    stringIdentifier: 'shared_id',
  });

  expect(pick(settingsFromRailDraft('extended_text', draft).values, [
    'allowPins',
    'extendedExpectedLength',
    'extendedExpectedLines',
    'extendedPlaceholderText',
    'extendedFormat',
    'extendedHeightClass',
    'extendedCounterType',
    'extendedMinStrings',
    'extendedMaxStrings',
    'extendedPatternMask',
    'extendedPatternMessage',
    'extendedStringIdentifier',
  ])).toStrictEqual({
    allowPins: false,
    extendedExpectedLength: 200,
    extendedExpectedLines: 6,
    extendedPlaceholderText: 'Start here',
    extendedFormat: 'xhtml',
    extendedHeightClass: 'qti-height-lines-6',
    extendedCounterType: 'down',
    extendedMinStrings: 1,
    extendedMaxStrings: 3,
    extendedPatternMask: '[A-Z]+',
    extendedPatternMessage: 'Uppercase only',
    extendedStringIdentifier: 'shared_id',
  });

  const changed = applySettingsChange(draft, {
    typeId: 'extended_text',
    values: {
      extendedExpectedLength: 240,
      extendedExpectedLines: 8,
      extendedPlaceholderText: 'Write here',
      extendedFormat: 'plain',
      extendedHeightClass: 'qti-height-lines-15',
      extendedCounterType: 'up',
      extendedMinStrings: 2,
      extendedMaxStrings: 4,
      extendedPatternMask: '[0-9]+',
      extendedPatternMessage: 'Digits only',
      extendedStringIdentifier: 'next_id',
    },
  });

  expect(changed.expectedLength).toStrictEqual(240);
  expect(changed.expectedLines).toStrictEqual(8);
  expect(changed.placeholderText).toStrictEqual('Write here');
  expect(changed.format).toStrictEqual('plain');
  expect(changed.heightClass).toStrictEqual('qti-height-lines-15');
  expect(changed.counterType).toStrictEqual('up');
  expect(changed.minStrings).toStrictEqual(2);
  expect(changed.maxStrings).toStrictEqual(4);
  expect(changed.patternMask).toStrictEqual('[0-9]+');
  expect(changed.patternMessage).toStrictEqual('Digits only');
  expect(changed.stringIdentifier).toStrictEqual('NEXT_ID');
});

testCase('upload rail settings map upload constraints both directions', () => {
  const draft = createTestRailDraft('upload', {
    type: 'upload',
    uploadMaxFileSize: 4096,
    uploadFileTypes: '.pdf,.xlsx',
    uploadMultiple: true,
  });

  expect(pick(settingsFromRailDraft('upload', draft).values, [
    'allowPins',
    'uploadMaxFileSize',
    'uploadFileTypes',
    'uploadMultiple',
  ])).toStrictEqual({
    allowPins: false,
    uploadMaxFileSize: 4096,
    uploadFileTypes: '.pdf,.xlsx',
    uploadMultiple: true,
  });

  const changed = applySettingsChange(draft, {
    typeId: 'upload',
    values: {
      uploadMaxFileSize: 8192,
      uploadFileTypes: '.csv',
      uploadMultiple: false,
    },
  });

  expect(changed.uploadMaxFileSize).toStrictEqual(8192);
  expect(changed.uploadFileTypes).toStrictEqual('.csv');
  expect(changed.uploadMultiple).toStrictEqual(false);
});

testCase('media rail settings preserve the authoring media kind', () => {
  const draft = createTestRailDraft('media', { type: 'media', mediaKind: 'video' });

  expect(settingsFromRailDraft('media', draft).values.mediaKind).toStrictEqual('video');
  expect(
    applySettingsChange(draft, {
      typeId: 'media',
      values: { mediaKind: 'object' },
    }).mediaKind,
  ).toStrictEqual('object');
});

testCase('media rail player controls toggle tokens in shared vocabulary', () => {
  const driver = TYPE_DRIVERS.media;
  let nextDraft = createTestRailDraft('media', {
    type: 'media',
    sharedVocabulary: { mediaPlayerControls: ['default'] },
  });
  const controls = buildRightRailControls(
    'media',
    driver.capabilities,
    nextDraft,
    (next) => {
      nextDraft = next;
    },
    {
      scoringTemplates: driver.scoringTemplates,
      itemLanguageMessages: ITEM_LANGUAGE_MESSAGES,
      t: (id) => id,
    },
  );

  expect(controls.mediaPlayerControls?.value).toStrictEqual(['default']);
  controls.mediaPlayerControls?.onChange('play', true);
  expect(nextDraft.sharedVocabulary?.mediaPlayerControls).toStrictEqual(['play']);
  controls.mediaPlayerControls?.onChange('captions', true);
  expect(nextDraft.sharedVocabulary?.mediaPlayerControls).toStrictEqual(['play', 'captions']);
  controls.mediaPlayerControls?.onChange('play', false);
  expect(nextDraft.sharedVocabulary?.mediaPlayerControls).toStrictEqual(['captions']);
  controls.mediaPlayerControls?.onChange('none', true);
  expect(nextDraft.sharedVocabulary?.mediaPlayerControls).toStrictEqual(['none']);
});

testCase('persisted settings apply omits rail-only UI fields', () => {
  const railDraft = createTestRailDraft('single_select', {
    type: 'single_select',
    title: 'Q',
    choices: [{ id: 'A', text: 'One', fixed: true }],
    correctId: 'A',
    shuffle: true,
  });

  const update = settingsFromRailDraft('single_select', railDraft);
  expect(update.values.allowPins).toStrictEqual(true);

  const persisted = applyPersistedSettingsChange(
    {
      type: 'single_select',
      itemLanguage: newAuthoringItemLanguage(),
      title: 'Q',
      choices: [{ id: 'A', text: 'One', fixed: true }],
      correctId: 'A',
      shuffle: false,
    },
    update,
  );

  expect(Object.hasOwn(persisted, 'allowPins')).toStrictEqual(false);
  expect(Object.hasOwn(persisted, 'textEntryShowIdentifiers')).toStrictEqual(false);
  expect(persisted.shuffle).toStrictEqual(true);
  expect(persisted.choices?.[0]?.fixed).toStrictEqual(true);
});

testCase(
  'committed language crosses the rail settings boundary into the persisted question',
  () => {
    const draft: Draft = {
      type: 'single_select',
      itemLanguage: newAuthoringItemLanguage(),
      title: 'Capital',
      choices: [{ id: 'A', text: 'Paris' }],
      correctId: 'A',
    };
    const railDraft = createRailDraft('single_select', draft);
    const changed = { ...railDraft, itemLanguage: parseItemLanguage('fr-CA') };
    const persisted = applyPersistedSettingsChange(
      draft,
      settingsFromRailDraft('single_select', changed),
    );
    expect(persisted.itemLanguage).toStrictEqual('fr-CA');
    expect(persisted.choices).toStrictEqual(draft.choices);
    expect(persisted.title).toStrictEqual(draft.title);
  },
);

testCase(
  'an unchanged shuffle configuration retains inactive pins during unrelated settings edits',
  () => {
    for (const typeId of ['single_select', 'multi_select', 'gap_match'] as const) {
      const draft: Draft = {
        type: typeId,
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Keep position metadata',
        shuffle: false,
        choices: [{ id: 'A', text: 'One', fixed: true }],
        gapChoices: [{ id: 'A', kind: 'text', text: 'One', fixed: true }],
        correctId: 'A',
        correctIds: ['A'],
      };
      const update = settingsFromRailDraft(typeId, createRailDraft(typeId, draft));
      const persisted = applyPersistedSettingsChange(draft, update);
      expect(persisted.choices).toStrictEqual(draft.choices);
      expect(persisted.gapChoices).toStrictEqual(draft.gapChoices);
      expect(persisted.shuffle).toStrictEqual(false);
    }
  },
);

testCase('persisted settings apply still clears pins when shuffle is disabled', () => {
  const persisted = applyPersistedSettingsChange(
    {
      type: 'single_select',
      itemLanguage: newAuthoringItemLanguage(),
      title: 'Q',
      choices: [{ id: 'A', text: 'One', fixed: true }],
      correctId: 'A',
      shuffle: true,
    },
    { typeId: 'single_select', values: { shuffle: false, allowPins: false } },
  );

  expect(Object.hasOwn(persisted, 'allowPins')).toStrictEqual(false);
  expect(persisted.shuffle).toStrictEqual(false);
  expect(persisted.choices?.[0]?.fixed).toStrictEqual(false);
});

testCase('persisted settings apply ignores min choices on non-selection types', () => {
  const persisted = applyPersistedSettingsChange(
    { type: 'extended_text', itemLanguage: newAuthoringItemLanguage(), title: 'Essay' },
    { typeId: 'extended_text', values: { minChoices: 2, maxChoices: 4 } },
  );

  expect(persisted.minChoices).toStrictEqual(undefined);
  expect(persisted.maxChoices).toStrictEqual(undefined);
});

testCase('strip rail-only draft fields before persistence projection', () => {
  const input: Draft = {
    type: 'text_entry',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Q',
    textEntries: [],
  };
  Object.assign(input, { allowPins: true, textEntryShowIdentifiers: true });
  const stripped = stripRailOnlyDraftFields(input);

  expect(Object.hasOwn(stripped, 'allowPins')).toStrictEqual(false);
  expect(Object.hasOwn(stripped, 'textEntryShowIdentifiers')).toStrictEqual(false);
  expect(stripped.title).toStrictEqual('Q');
});
