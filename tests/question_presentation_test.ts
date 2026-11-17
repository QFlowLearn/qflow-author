import { expect, test as testCase } from 'vitest';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import {
  changeQuestionPresentation,
  type QuestionPresentationBlock,
  questionPresentationHistory,
  undoQuestionPresentation,
} from '../lib/question_presentation.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import {
  createInlineChoiceMarkerHtml,
  defaultsInlineChoice,
  standaloneInlineChoice,
} from '../lib/types/inline_choice.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';

function source(): Draft {
  return {
    itemLanguage: newAuthoringItemLanguage(),
    type: 'single_select',
    itemId: 'same-item',
    title: 'Capital',
    bodyHtml: '<h2>Geography</h2><p>Which city?</p>',
    promptHtml: 'Choose one.',
    choices: [{ id: 'city_paris', text: 'Paris', fixed: true }, { id: 'city_rome', text: 'Rome' }],
    correctId: 'city_rome',
    required: false,
    shuffle: true,
    minChoices: 0,
    maxChoices: 1,
    responseMode: 'all_or_nothing',
    tags: ['geography'],
    note: 'Author note',
    catalogs: [],
    stylesheets: [],
  };
}
function dropdown(draft = source()): Draft {
  const result = changeQuestionPresentation(draft);
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  return result.draft;
}

testCase(
  'presentation conversion preserves content, identifiers, answer key and metadata through persistence',
  () => {
    const initial = source();
    const converted = dropdown(initial);
    const persisted = parsePersistedDraft(projectJsonPersistenceObject(converted), 'inline_choice');
    const standalone = standaloneInlineChoice({
      bodyHtml: persisted.bodyHtml,
      inlineChoices: persisted.inlineChoices ?? [],
    });
    if (!standalone) expect.unreachable('Expected standalone');
    expect(standalone.questionHtml).toStrictEqual(initial.bodyHtml);
    expect(standalone.slot.options).toStrictEqual(initial.choices);
    expect(standalone.slot.correctId).toStrictEqual(initial.correctId);
    expect(standalone.slot.required).toStrictEqual(false);
    expect(standalone.slot.shuffle).toStrictEqual(true);
    expect(converted.choices).toStrictEqual(undefined);
    const restored = changeQuestionPresentation(persisted);
    if (!(restored.ok)) expect.unreachable('Expected restored.ok');
    for (
      const field of [
        'bodyHtml',
        'promptHtml',
        'choices',
        'correctId',
        'shuffle',
        'required',
        'title',
        'itemLanguage',
        'itemId',
        'tags',
        'note',
        'catalogs',
        'stylesheets',
      ] as const
    ) {
      expect(restored.draft[field], field).toStrictEqual(initial[field]);
    }
    expect(initial).toStrictEqual(source());
  },
);

testCase('presentation Undo restores exact interaction fields and retains later metadata', () => {
  const initial = source(), changed = dropdown(initial);
  const result = undoQuestionPresentation({
    ...changed,
    title: 'Later title',
    promptHtml: 'Later instruction',
    tags: ['later'],
  }, questionPresentationHistory(initial, changed));
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.draft).toStrictEqual({
    ...initial,
    title: 'Later title',
    promptHtml: 'Later instruction',
    tags: ['later'],
  });
});

testCase('presentation Undo retains later stem, options, key, pin and required edits', () => {
  const initial = source(), changed = dropdown(initial);
  const slot = changed.inlineChoices?.[0];
  if (!slot) expect.unreachable('Expected slot');
  const edited: Draft = {
    ...changed,
    bodyHtml: `<p>Later question</p><p>${createInlineChoiceMarkerHtml(slot)}</p>`,
    inlineChoices: [{
      ...slot,
      options: [
        ...slot.options.map((option) => ({
          ...option,
          text: `${option.text} edited`,
          fixed: false,
        })),
        { id: 'other', text: 'Other' },
      ],
      correctId: 'other',
      required: true,
    }],
  };
  const result = undoQuestionPresentation(edited, questionPresentationHistory(initial, changed));
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.draft.bodyHtml).toStrictEqual('<p>Later question</p>');
  expect(result.draft.choices).toStrictEqual(edited.inlineChoices?.[0].options);
  expect(result.draft.correctId).toStrictEqual('other');
  expect(result.draft.required).toStrictEqual(true);
});

testCase('unsafe presentation changes explain their losses and preserve the original', () => {
  const initial = source();
  const cases: Array<[Draft, QuestionPresentationBlock]> = [
    [{ ...initial, choices: [{ id: 'A', html: '<b>Paris</b>' }] }, 'richAnswers'],
    [{ ...initial, choices: [{ id: 'A', kind: 'image', imgSrc: '/image.png' }] }, 'richAnswers'],
    [{ ...initial, choices: [{ id: 'A', text: 'Paris', label: 'Custom' }] }, 'settings'],
    [{ ...initial, responseMode: 'partial' }, 'scoring'],
    [{ ...initial, customResponseProcessingXml: '<qti-response-processing/>' }, 'scoring'],
    [{ ...initial, preserveSourceXml: true }, 'imported'],
    [{ ...initial, sharedVocabulary: { orientation: 'horizontal' } }, 'settings'],
    [{ ...initial, responseIdentifier: 'CUSTOM' }, 'settings'],
    [{ ...initial, choices: [{ id: 'bad id', text: 'A' }] }, 'structure'],
  ];
  for (const [draft, reason] of cases) {
    const before = structuredClone(draft);
    expect(changeQuestionPresentation(draft)).toStrictEqual({ ok: false, reason });
    expect(draft).toStrictEqual(before);
  }
  const inline: Draft = {
    ...defaultsInlineChoice(),
    type: 'inline_choice',
    itemLanguage: newAuthoringItemLanguage(),
  };
  expect(changeQuestionPresentation(inline)).toStrictEqual({ ok: false, reason: 'structure' });
  const changed = dropdown();
  const slot = changed.inlineChoices?.[0];
  if (!slot) expect.unreachable('Expected slot');
  expect(
    changeQuestionPresentation({ ...changed, inlineChoices: [slot, { ...slot, id: 'OTHER' }] }),
  ).toStrictEqual({ ok: false, reason: 'structure' });
  expect(changeQuestionPresentation({
    ...changed,
    inlineChoices: [{
      ...slot,
      options: slot.options.map((option) => ({ ...option, score: 1 })),
    }],
  })).toStrictEqual({ ok: false, reason: 'scoring' });
  expect(changeQuestionPresentation({
    ...changed,
    bodyHtml: `${changed.bodyHtml}<p>After the dropdown</p>`,
  })).toStrictEqual({ ok: false, reason: 'structure' });
});

testCase('switching a draft with a removed correct answer never guesses a replacement', () => {
  const changed = dropdown({ ...source(), correctId: '' });
  expect(changed.inlineChoices?.[0].correctId).toStrictEqual('');
  const result = changeQuestionPresentation(changed);
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.draft.correctId).toStrictEqual('');
});

testCase('inactive pin settings cannot silently disappear in the other presentation', () => {
  const initial = { ...source(), shuffle: false };
  expect(changeQuestionPresentation(initial)).toStrictEqual({ ok: false, reason: 'settings' });
  const changed = dropdown();
  const slot = changed.inlineChoices?.[0];
  if (!slot) expect.unreachable('Expected slot');
  expect(changeQuestionPresentation({ ...changed, inlineChoices: [{ ...slot, shuffle: false }] }))
    .toStrictEqual({ ok: false, reason: 'settings' });
});

testCase(
  'ordinary scores and response identity survive QTI export, import and shared scoring',
  () => {
    const original = source(), changed = dropdown(original);
    for (const draft of [original, changed]) {
      const built = buildQtiPreviewXml(draft, { identifier: 'same-identity' });
      if (!(built.ok)) expect.unreachable('Expected built.ok');
      if (!(built.xml.indexOf('Geography') < built.xml.indexOf('Choose one.'))) {
        expect.unreachable(
          "Expected built.xml.indexOf('Geography') < built.xml.indexOf('Choose one.')",
        );
      }
      if (
        !(built.xml.indexOf('Choose one.') <
          built.xml.indexOf(
            draft.type === 'single_select' ? '<qti-simple-choice' : '<qti-inline-choice identifier',
          ))
      ) {
        expect.unreachable(
          "Expected built.xml.indexOf('Choose one.') < built.xml.indexOf( draft.type === 'single_select' ? '<q",
        );
      }
      const roundtrip = parseItemXml(built.xml);
      expect(roundtrip.draft.type).toStrictEqual(draft.type);
      const rebuilt = buildQtiPreviewXml(roundtrip.draft);
      if (!(rebuilt.ok)) expect.unreachable('Expected rebuilt.ok');
      for (const xml of [built.xml, rebuilt.xml]) {
        const correct = scoreQtiItemServerSide({
          itemXml: xml,
          trustedResponses: { RESPONSE: 'city_rome' },
        });
        if (!(correct.ok)) expect.unreachable(JSON.stringify(correct.diagnostics));
        expect(correct.score).toStrictEqual(1);
        const wrong = scoreQtiItemServerSide({
          itemXml: xml,
          trustedResponses: { RESPONSE: 'city_paris' },
        });
        if (!(wrong.ok)) expect.unreachable(JSON.stringify(wrong.diagnostics));
        expect(wrong.score).toStrictEqual(0);
      }
    }
  },
);
