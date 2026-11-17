import { expect, test as testCase } from 'vitest';

import { AIDraftParseFatalError, parseAIGeneratedDrafts } from '../lib/ai/draft_parser.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';

const BLUEPRINT = testAssessmentBlueprint([
  { id: 'single-target', questionType: 'single_select', count: 1 },
  { id: 'text-target', questionType: 'text_entry', count: 1 },
]);

testCase('parseAIGeneratedDrafts parses supported AI question types', () => {
  const result = parseAIGeneratedDrafts(
    JSON.stringify([
      {
        type: 'single_select',
        title: 'Question 1',
        bodyHtml: '<p>What is 2 + 2?</p>',
        choices: [{ id: 'A', text: '3' }, { id: 'B', text: '4' }],
        correctId: 'B',
        blueprintTargetId: 'single-target',
        reviewSuggestions: [],
        citations: [{ kind: 'block', blockId: 'block-1', quote: '2 + 2' }],
      },
      {
        type: 'text_entry',
        title: 'Question 2',
        bodyHtml: '<p>The capital of France is ____.</p>',
        correctAnswers: ['Paris'],
        caseSensitive: false,
        blueprintTargetId: 'text-target',
        reviewSuggestions: [],
        citations: [{ kind: 'block', blockId: 'block-2', quote: 'capital of France' }],
      },
    ]),
    BLUEPRINT,
  );

  expect(result.total).toStrictEqual(2);
  expect(result.drafts.length).toStrictEqual(2);
  expect(result.drafts[0].typeId).toStrictEqual('single_select');
  expect(result.drafts[1].typeId).toStrictEqual('text_entry');
  expect(String(result.drafts[1].serializedDraft.bodyHtml).includes('data-qti-entry'))
    .toStrictEqual(true);
});

testCase('parseAIGeneratedDrafts rejects the whole response when one entry is invalid', () => {
  expect(() =>
    parseAIGeneratedDrafts(
      JSON.stringify([
        {
          type: 'single_select',
          title: 'Valid Q',
          bodyHtml: '<p>Body</p>',
          choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
          correctId: 'A',
          blueprintTargetId: 'single-target',
          reviewSuggestions: [],
          citations: [{ kind: 'block', blockId: 'block-1', quote: 'Body' }],
        },
        {
          type: 'essay',
          title: 'Unsupported Q',
          bodyHtml: '<p>Body</p>',
        },
      ]),
      BLUEPRINT,
    )
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof AIDraftParseFatalError && caught.message.includes('Question 2')
    ),
  );
});

testCase('parseAIGeneratedDrafts throws fatal error for non-JSON content', () => {
  expect(() => parseAIGeneratedDrafts('This is not JSON.', BLUEPRINT)).toThrowError(
    AIDraftParseFatalError,
  );
});

testCase('parseAIGeneratedDrafts rejects markdown wrappers and removed type aliases', () => {
  expect(() => parseAIGeneratedDrafts('```json\n[]\n```', BLUEPRINT)).toThrowError(
    AIDraftParseFatalError,
  );
  expect(() =>
    parseAIGeneratedDrafts(
      JSON.stringify([{
        type: 'multiple_choice',
        title: 'Removed alias',
        bodyHtml: '<p>Body</p>',
        choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
        correctId: 'A',
        blueprintTargetId: 'single-target',
        reviewSuggestions: [],
        citations: [{ kind: 'block', blockId: 'block-1', quote: 'Body' }],
      }]),
      BLUEPRINT,
    )
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof AIDraftParseFatalError &&
      caught.message.includes('Unsupported AI question type')
    ),
  );
});

testCase('parseAIGeneratedDrafts rejects blueprint shortages and excesses', () => {
  const question = {
    type: 'single_select',
    title: 'Question',
    bodyHtml: '<p>Body</p>',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
    blueprintTargetId: 'single-target',
    reviewSuggestions: [],
    citations: [{ kind: 'block', blockId: 'block-1', quote: 'Body' }],
  };
  expect(() => parseAIGeneratedDrafts(JSON.stringify([question]), BLUEPRINT)).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof AIDraftParseFatalError && caught.message.includes('text-target 0/1')
    ),
  );
  expect(() => parseAIGeneratedDrafts(JSON.stringify([question, question, question]), BLUEPRINT))
    .toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof AIDraftParseFatalError && caught.message.includes('single-target 3/1')
      ),
    );
});
