import { expect, test as testCase } from 'vitest';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { prepareQuestionXmlDownload } from '../lib/export/question_xml_download.ts';
import {
  changeQuestionPresentation,
  questionPresentationHistory,
  undoQuestionPresentation,
} from '../lib/question_presentation.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { Draft } from '../lib/types/draft.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { createInlineChoiceMarkerHtml } from '../lib/types/inline_choice.ts';

function choice(maximumScore?: number): Draft {
  return {
    type: 'single_select',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Explicit points',
    bodyHtml: '<p>Choose Alpha.</p>',
    choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }, { id: 'C', text: 'Gamma' }],
    correctId: 'A',
    responseMode: 'all_or_nothing',
    ...(maximumScore === undefined ? {} : { maximumScore }),
  };
}

function score(xml: string, responses: Record<string, string | string[] | null>): number | null {
  const result = scoreQtiItemServerSide({ itemXml: xml, trustedResponses: responses });
  if (!(result.ok)) expect.unreachable(JSON.stringify(result.diagnostics));
  return result.score;
}

testCase(
  'canonical points preserve literal matching and partial grades through persistence, preview and XML download',
  () => {
    for (const [maximumScore, half] of [[0, 0], [3, 1.5], [3.125, 1.5625]] as const) {
      const single = { ...choice(maximumScore), responseIdentifier: 'ANSWER' };
      const multiple: Draft = {
        ...choice(maximumScore),
        type: 'multi_select',
        correctIds: ['A', 'B'],
        maxChoices: 3,
        responseIdentifier: 'ANSWER',
      };
      const slot = {
        id: 'ANSWER',
        label: 'Answer',
        correctId: 'A',
        options: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
      };
      const dropdown: Draft = {
        type: 'inline_choice',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Dropdown points',
        maximumScore,
        responseMode: 'all_or_nothing',
        bodyHtml: `<p>Choose ${createInlineChoiceMarkerHtml(slot)}.</p>`,
        inlineChoices: [slot],
      };
      const second = { ...slot, id: 'SECOND' };
      const twoDropdowns: Draft = {
        ...dropdown,
        bodyHtml: `<p>${createInlineChoiceMarkerHtml(slot)} and ${
          createInlineChoiceMarkerHtml(second)
        }.</p>`,
        inlineChoices: [slot, second],
      };
      const cases: Array<
        { draft: Draft; rows: Array<[Record<string, string | string[] | null>, number]> }
      > = [
        {
          draft: single,
          rows: [[{ ANSWER: null }, 0], [{ ANSWER: 'B' }, 0], [{ ANSWER: 'A' }, maximumScore]],
        },
        {
          draft: { ...multiple, responseMode: 'all_or_nothing' },
          rows: [
            [{ ANSWER: [] }, 0],
            [{ ANSWER: ['A'] }, 0],
            [{ ANSWER: ['A', 'B'] }, maximumScore],
            [{ ANSWER: ['A', 'B', 'C'] }, 0],
          ],
        },
        {
          draft: { ...multiple, responseMode: 'partial' },
          rows: [
            [{ ANSWER: [] }, 0],
            [{ ANSWER: ['C'] }, 0],
            [{ ANSWER: ['A'] }, half],
            [{ ANSWER: ['A', 'C'] }, half],
            [{ ANSWER: ['A', 'B'] }, maximumScore],
            [{ ANSWER: ['A', 'B', 'C'] }, maximumScore],
          ],
        },
        {
          draft: dropdown,
          rows: [[{ ANSWER: null }, 0], [{ ANSWER: 'B' }, 0], [{ ANSWER: 'A' }, maximumScore]],
        },
        {
          draft: twoDropdowns,
          rows: [[{ ANSWER: 'A', SECOND: 'B' }, 0], [{ ANSWER: 'A', SECOND: 'A' }, maximumScore]],
        },
      ];
      for (const example of cases) {
        if (!(example.draft.type)) expect.unreachable('Expected example.draft.type');
        const persisted = parsePersistedDraft(
          projectJsonPersistenceObject(example.draft),
          example.draft.type,
        );
        expect(persisted.maximumScore).toStrictEqual(maximumScore);
        const built = buildQtiPreviewXml(persisted);
        if (!(built.ok)) expect.unreachable(JSON.stringify(built));
        const downloaded = prepareQuestionXmlDownload(persisted, 'points-download');
        if (!(downloaded.ok)) expect.unreachable(JSON.stringify(downloaded));
        for (const [responses, expected] of example.rows) {
          expect(
            score(built.xml, responses),
            `${example.draft.type}/${example.draft.responseMode}/${maximumScore}`,
          ).toStrictEqual(expected);
          expect(score(downloaded.xml, responses)).toStrictEqual(expected);
        }
      }
    }
  },
);

testCase(
  'points reject malformed values and unsupported scoring without discarding configuration',
  () => {
    for (const maximumScore of [-1, NaN, Infinity, -Infinity, '3', null, true]) {
      expect(() => parsePersistedDraft({ ...choice(), maximumScore }, 'single_select'))
        .toThrowError(Error);
    }
    const unsupported: Draft = {
      type: 'extended_text',
      itemLanguage: newAuthoringItemLanguage(),
      title: 'Essay',
      bodyHtml: '<p>Explain.</p>',
      maximumScore: 3,
    };
    expect(() => parsePersistedDraft(unsupported, 'extended_text')).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('does not support explicit points')
      ),
    );
    for (
      const draft of [unsupported, choice(-1), choice(Infinity), {
        ...choice(3),
        responseMode: 'custom' as const,
      }, {
        ...choice(3),
        customResponseProcessingXml: '<qti-response-processing/>',
      }]
    ) {
      const before = structuredClone(draft);
      expect(buildQtiPreviewXml(draft).ok).toStrictEqual(false);
      const type = draft.type;
      if (!type) expect.unreachable('Expected type');
      expect(() => exportQti3AssessmentItemXml(type, draft)).toThrowError(Error);
      expect(draft).toStrictEqual(before);
    }
    const converted = changeQuestionPresentation(choice(3));
    if (!(converted.ok)) expect.unreachable('Expected converted.ok');
    expect(buildQtiPreviewXml({ ...converted.draft, responseMode: 'partial' }).ok).toStrictEqual(
      false,
    );
  },
);

testCase(
  'omitted points retain the existing template policy without adding a persisted default',
  () => {
    const single = choice();
    const built = buildQtiPreviewXml(single);
    if (!(built.ok)) expect.unreachable('Expected built.ok');
    expect(score(built.xml, { RESPONSE: 'A' })).toStrictEqual(1);
    const persisted = parsePersistedDraft(projectJsonPersistenceObject(single), 'single_select');
    expect(Object.hasOwn(persisted, 'maximumScore')).toStrictEqual(false);
    const multi: Draft = {
      ...single,
      type: 'multi_select',
      correctIds: ['A', 'B'],
      maxChoices: 3,
      responseMode: 'partial',
    };
    const mapped = buildQtiPreviewXml(multi);
    if (!(mapped.ok)) expect.unreachable('Expected mapped.ok');
    expect(score(mapped.xml, { RESPONSE: ['A', 'B'] })).toStrictEqual(2);
    expect(Object.hasOwn(multi, 'maximumScore')).toStrictEqual(false);
  },
);

testCase('presentation switching and Undo retain zero points and later point edits', () => {
  for (const maximumScore of [0, 3.125]) {
    const original = choice(maximumScore);
    const changed = changeQuestionPresentation(original);
    if (!(changed.ok)) expect.unreachable('Expected changed.ok');
    expect(changed.draft.maximumScore).toStrictEqual(maximumScore);
    const built = buildQtiPreviewXml(changed.draft);
    if (!(built.ok)) expect.unreachable('Expected built.ok');
    expect(score(built.xml, { RESPONSE: 'A' })).toStrictEqual(maximumScore);
    const undone = undoQuestionPresentation(
      { ...changed.draft, maximumScore: 2.5 },
      questionPresentationHistory(original, changed.draft),
    );
    if (!(undone.ok)) expect.unreachable('Expected undone.ok');
    expect(undone.draft.maximumScore).toStrictEqual(2.5);
    const restored = buildQtiPreviewXml(undone.draft);
    if (!(restored.ok)) expect.unreachable('Expected restored.ok');
    expect(score(restored.xml, { RESPONSE: 'A' })).toStrictEqual(2.5);
    expect(original.maximumScore).toStrictEqual(maximumScore);
  }
});
