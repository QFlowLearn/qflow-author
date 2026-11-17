import { expect, test as testCase } from 'vitest';

import {
  parseQuestionText,
  prepareQuestionText,
  questionStructure,
} from '../lib/authoring/question_text.ts';
import { parseQuestionAssistanceInput } from '../lib/authoring/question_assistance.ts';
import { normalizeDraftForDriver } from '../lib/types/draft_utils.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';

testCase('pasted explicit questions use canonical editors and export with supplied keys', () => {
  for (
    const [source, type] of [
      [
        'MC Which organelle produces ATP?\nA. Nucleus\nB. Mitochondrion\nC. Golgi\nD. Ribosome\nAnswer: B',
        'single_select',
      ],
      [
        'Select all that apply: which are mammals?\n1. Dog\n2. Cat\n3. Trout\nAnswer: 1, 2',
        'multi_select',
      ],
      ['Short answer: Name our planet.\nAnswer: Earth', 'text_entry'],
    ] as const
  ) {
    const parsed = parseQuestionText(source);
    expect(parsed.type).toStrictEqual(type);
    const prepared = prepareQuestionText(parsed, type, 4, parseItemLanguage('en-US'));
    expect(prepared.findings).toStrictEqual([]);
    const draft = normalizeDraftForDriver(type, {
      ...prepared.draft,
      itemLanguage: parseItemLanguage('en-US'),
    });
    expect(TYPE_DRIVERS[type].validate(draft)).toStrictEqual([]);
    const result = buildQtiPreviewXml(draft, { identifier: 'pasted-item' });
    if (!(result.ok)) expect.unreachable(JSON.stringify(result));
  }
});
testCase('missing or contradictory keys never acquire a driver default answer', () => {
  for (const suffix of ['', '\nAnswer: Z', '\nAnswer: A\nAnswer: B', '\nAnswer: A, B']) {
    const parsed = parseQuestionText('Question?\nA. Alpha\nB. Beta' + suffix);
    const draft = normalizeDraftForDriver(
      'single_select',
      prepareQuestionText(parsed, 'single_select', 4, parseItemLanguage('en-US')).draft,
    );
    expect(draft.correctId).toStrictEqual('');
    if (!(TYPE_DRIVERS.single_select.validate(draft).length > 0)) {
      expect.unreachable('Expected TYPE_DRIVERS.single_select.validate(draft).length > 0');
    }
  }
});
testCase('uncertain text, multiline choices and ambiguous labels retain authored content', () => {
  expect(parseQuestionText('Describe the process.').type).toStrictEqual(null);
  const parsed = parseQuestionText('Prompt\nA. First line\ncontinued here\nB. Other\nAnswer: A');
  expect(parsed.choices[0].text).toContain('continued here');
  const ambiguous = prepareQuestionText(
    parseQuestionText('Prompt\nA. One\nA. Two\nAnswer: A'),
    'single_select',
    4,
    parseItemLanguage('en-US'),
  );
  if (!(ambiguous.findings.includes('choices_ambiguous'))) {
    expect.unreachable("Expected ambiguous.findings.includes('choices_ambiguous')");
  }
  expect(ambiguous.draft.bodyHtml ?? '').toContain('One');
  expect(ambiguous.draft.bodyHtml ?? '').toContain('Two');
  if ((ambiguous.draft.bodyHtml ?? '').includes('Answer:')) {
    expect.unreachable("Expected !(ambiguous.draft.bodyHtml ?? '').includes('Answer:')");
  }
});
testCase('source is escaped and remembered structure contains no content or answers', () => {
  const draft = prepareQuestionText(
    parseQuestionText('<script>alert(1)</script>'),
    'single_select',
    5,
    parseItemLanguage('en-US'),
  ).draft;
  expect(draft.choices?.length).toStrictEqual(5);
  if ((draft.bodyHtml ?? '').includes('<script>')) {
    expect.unreachable("Expected !(draft.bodyHtml ?? '').includes('<script>')");
  }
  expect(questionStructure(draft)).toStrictEqual({ type: 'single_select', choiceCount: 5 });
  expect(parseQuestionAssistanceInput({
    text: 'Question',
    recent: [{ type: 'single_select', choiceCount: 4, answer: 'secret' }],
  })).toStrictEqual(null);
  expect(parseQuestionAssistanceInput({ text: 'a'.repeat(12001), recent: [] })).toStrictEqual(null);
});

testCase('mixed numbering and excessive alternatives require author review', () => {
  for (
    const source of [
      'Prompt\nA. First\n2. Second\nAnswer: A',
      'Prompt\n' + Array.from({ length: 27 }, (_, i) => `${i + 1}. Choice`).join('\n'),
    ]
  ) {
    if (!(parseQuestionText(source).findings.includes('choices_ambiguous'))) {
      expect.unreachable(
        "Expected parseQuestionText(source).findings.includes('choices_ambiguous')",
      );
    }
  }
});

testCase('answer continuations never become learner-visible content', () => {
  const result = prepareQuestionText(
    parseQuestionText('Short answer: Name the process.\nAnswer: Cellular\nrespiration'),
    'text_entry',
    4,
    parseItemLanguage('en-US'),
  );
  if ((result.draft.bodyHtml ?? '').includes('respiration')) {
    expect.unreachable("Expected !(result.draft.bodyHtml ?? '').includes('respiration')");
  }
  expect(result.draft.textEntries?.[0].answers[0].value).toStrictEqual('Cellular\nrespiration');
});

testCase('names and punctuation are not stripped as question-type codes', () => {
  for (
    const source of [
      'Mr. Smith has two apples.',
      'Ms. Jones teaches biology.',
      'Mr Smith has two apples.',
      'Ms Jones teaches biology.',
    ]
  ) {
    const parsed = parseQuestionText(source);
    expect(parsed.stem).toStrictEqual(source);
    expect(parsed.type).toStrictEqual(null);
  }
});
