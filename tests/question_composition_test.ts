import { expect, test as testCase } from 'vitest';

import {
  needsQuestionComposition,
  parseQuestionCompletion,
  parseQuestionComposition,
  prepareQuestionComposition,
  questionCompletionKey,
  type QuestionComposition,
} from '../lib/authoring/question_composition.ts';
import { questionStemFromSpans, questionTextSpans } from '../lib/authoring/question_text_spans.ts';
import { completeQuestion } from '../lib/ai/question_completion_provider.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';
const question: QuestionComposition = {
  type: 'single_select',
  stem: 'Who was the second president?',
  choices: ['Thomas Jefferson', 'George Washington'],
  answers: [],
  choiceCount: 4,
  shuffle: true,
  complete: true,
};
const completion = { additionalChoices: ['John Adams', 'James Madison'], answers: ['John Adams'] };
testCase('composition preserves supplied words and applies count, shuffle and proposed key', () => {
  expect(parseQuestionComposition(question)).toStrictEqual(question);
  const partial = prepareQuestionComposition(question, parseItemLanguage('en-US')).draft;
  expect(partial.choices?.map((c) => c.text)).toStrictEqual([...question.choices, '', '']);
  expect(partial.correctId).toStrictEqual('');
  const draft = prepareQuestionComposition(question, parseItemLanguage('en-US'), completion).draft;
  expect(draft.choices?.map((c) => c.text)).toStrictEqual([
    ...question.choices,
    ...completion.additionalChoices,
  ]);
  expect(draft.correctId).toStrictEqual('C');
  expect(draft.shuffle).toStrictEqual(true);
  expect(questionCompletionKey(question)).toStrictEqual(
    questionCompletionKey({ ...question, shuffle: false }),
  );
});
testCase(
  'completion rejects wrong counts, duplicates, invented keys, extra fields and rewritten supplied keys',
  () => {
    expect(parseQuestionCompletion(completion, question)).toStrictEqual(completion);
    expect(parseQuestionCompletion({ ...completion, answers: ['John Adams', 'John Adams'] }, {
      ...question,
      type: 'multi_select',
    })).toStrictEqual(null);
    for (
      const raw of [
        { ...completion, additionalChoices: ['John Adams'] },
        { ...completion, additionalChoices: ['John Adams', 'Thomas Jefferson'] },
        { ...completion, answers: ['Adams'] },
        { ...completion, stem: 'changed' },
        { ...completion, answers: ['John Adams', 'James Madison'] },
        { ...completion, answers: [] },
      ]
    ) expect(parseQuestionCompletion(raw, question)).toStrictEqual(null);
    expect(parseQuestionCompletion(completion, { ...question, answers: ['Thomas Jefferson'] }))
      .toStrictEqual(null);
    expect(parseQuestionComposition({ ...question, choiceCount: 1 })).toStrictEqual(null);
    expect(parseQuestionComposition({ ...question, answers: ['John Adams'] })).toStrictEqual(null);
  },
);
testCase('spans preserve quoted commas, honorifics and source content', () => {
  expect(
    questionTextSpans(
      'MC 4 options, Who was the second president, Thomas Jefferson, George Washington, you do the rest, randomize.',
    ).map((span) => span.text),
  ).toStrictEqual([
    'MC 4 options',
    'Who was the second president',
    'Thomas Jefferson',
    'George Washington',
    'you do the rest',
    'randomize.',
  ]);
  expect(questionTextSpans('Mr. Smith asks "Who, exactly?", A person').map((span) => span.text))
    .toStrictEqual([
      'Mr. Smith asks "Who, exactly?"',
      'A person',
    ]);
  expect(questionTextSpans('"A" means "B", “C” means “D”').map((span) => span.text)).toStrictEqual([
    '"A" means "B"',
    '“C” means “D”',
  ]);
  if (!(needsQuestionComposition('MC 4 options, Who?'))) {
    expect.unreachable("Expected needsQuestionComposition('MC 4 options, Who?')");
  }
  expect(needsQuestionComposition('MR Which?\nA. One\nB. Two\nAnswer: A, B')).toStrictEqual(false);
});
testCase(
  'generation requires explicit completion and rejects outputs that violate the content contract',
  async () => {
    let calls = 0;
    const binding = {
      run: () => {
        calls++;
        return Promise.resolve({ response: JSON.stringify(completion) });
      },
    };
    const options = { signal: new AbortController().signal };
    expect(
      await completeQuestion(
        binding,
        'configured-model',
        { ...question, complete: false },
        options,
      ),
    ).toStrictEqual({ ok: false, code: 'invalid_response' });
    expect(calls).toStrictEqual(0);
    expect(await completeQuestion(binding, 'configured-model', question, options)).toStrictEqual({
      ok: true,
      value: completion,
    });
    expect(
      await completeQuestion(
        {
          run: () =>
            Promise.resolve({ response: JSON.stringify({ ...completion, answers: ['unknown'] }) }),
        },
        'configured-model',
        question,
        options,
      ),
    ).toStrictEqual({ ok: false, code: 'invalid_response' });
  },
);

testCase(
  'interpreted stems preserve commas, quotations and line breaks without retaining commands',
  () => {
    const source =
      'MC 4 options, At noon, Mr. Smith asked “Who, exactly?”\nWhy?, Alice, Bob, randomize';
    const spans = questionTextSpans(source);
    expect(questionStemFromSpans(source, spans, [1, 2, 3])).toStrictEqual(
      'At noon, Mr. Smith asked “Who, exactly?”\nWhy?',
    );
    expect(
      questionTextSpans('Multiple choice four options, What is 1,000 plus 2,000?, “3,000”, 4,000')
        .map((span) => span.text),
    ).toStrictEqual([
      'Multiple choice four options',
      'What is 1,000 plus 2,000?',
      '3,000',
      '4,000',
    ]);
    expect(questionTextSpans('MC Pick one, 1,2,3,4').map((span) => span.text)).toStrictEqual([
      'MC',
      'Pick one',
      '1',
      '2',
      '3',
      '4',
    ]);
    if (!(needsQuestionComposition('MC Which?\nA. One\nB. Two\nAnswer: A\nRandomise'))) {
      expect.unreachable(
        "Expected needsQuestionComposition('MC Which?\\nA. One\\nB. Two\\nAnswer: A\\nRandomise')",
      );
    }
  },
);
