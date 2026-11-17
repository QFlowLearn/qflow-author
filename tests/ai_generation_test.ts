import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import {
  buildAssessmentGenerationPrompt,
  FILE_SOURCE_MATERIAL_PROMPT_CHARS,
  mapOpenRouterChatCompletionToParserInput,
  OpenRouterGenerationError,
  sourceMaterialForPrompt,
} from '../lib/ai/generation.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';

async function readFixture(name: string): Promise<unknown> {
  const text = await _fs.readFile(
    new URL(`./fixtures/openrouter/${name}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(text);
}

testCase('buildAssessmentGenerationPrompt includes core generation context', () => {
  const prompt = buildAssessmentGenerationPrompt({
    blueprint: testAssessmentBlueprint([
      { id: 'choice-target', questionType: 'single_select', count: 3 },
      { id: 'entry-target', questionType: 'text_entry', count: 3 },
    ]),
    gradeLevel: '8',
    brief: 'Mitochondria and photosynthesis',
    sourceMaterial: 'Plants convert light energy into chemical energy.',
    evidenceMode: 'block',
  });

  expect(prompt.includes('Question count: 6')).toStrictEqual(true);
  expect(prompt.includes('Grade level: 8')).toStrictEqual(true);
  expect(prompt.includes('choice-target: exactly 3 single_select')).toStrictEqual(true);
  expect(prompt.includes('Allowed question types: ["single_select", "text_entry"]')).toStrictEqual(
    true,
  );
  expect(prompt.includes('Assessment brief: Mitochondria and photosynthesis')).toStrictEqual(true);
  expect(prompt.includes('QUESTION SCHEMAS')).toStrictEqual(true);
  expect(prompt.includes('"type": "single_select"')).toStrictEqual(true);
  expect(prompt.includes('"type": "text_entry"')).toStrictEqual(true);
  expect(prompt.includes('Return only the JSON array now.')).toStrictEqual(true);
});

testCase(
  'buildAssessmentGenerationPrompt includes existing question context to prevent duplicates',
  () => {
    const prompt = buildAssessmentGenerationPrompt({
      blueprint: testAssessmentBlueprint([
        { id: 'choice-target', questionType: 'single_select', count: 2 },
        { id: 'entry-target', questionType: 'text_entry', count: 1 },
      ]),
      gradeLevel: '8',
      brief: 'Life science review',
      sourceMaterial: 'Cells, photosynthesis, and respiration',
      evidenceMode: 'block',
      existingQuestions: [
        {
          type: 'single_select',
          title: 'Cell Organelle Function',
          prompt: 'Which organelle is primarily responsible for producing ATP?',
        },
        {
          type: 'text_entry',
          title: 'Energy Conversion Vocabulary',
          prompt: 'In cellular respiration, glucose is converted into usable cellular ____.',
        },
      ],
    });

    expect(
      prompt.includes('Do not duplicate or closely paraphrase any existing question listed below.'),
    ).toStrictEqual(true);
    expect(prompt.includes('EXISTING QUESTIONS IN THIS ASSESSMENT (avoid duplicates):'))
      .toStrictEqual(true);
    expect(prompt.includes(
      '[single_select] Cell Organelle Function :: Which organelle is primarily responsible for producing ATP?',
    )).toStrictEqual(true);
    expect(prompt.includes(
      '[text_entry] Energy Conversion Vocabulary :: In cellular respiration, glucose is converted into usable cellular ____.',
    )).toStrictEqual(true);
  },
);

testCase(
  'buildAssessmentGenerationPrompt supports multiple targets with the same question type',
  () => {
    const prompt = buildAssessmentGenerationPrompt({
      blueprint: testAssessmentBlueprint([
        { id: 'remember-target', questionType: 'single_select', count: 1 },
        { id: 'apply-target', questionType: 'single_select', count: 2 },
      ]),
      gradeLevel: '8',
      brief: 'Two target rows',
      sourceMaterial: 'Grounded source material.',
      evidenceMode: 'block',
    });

    expect(prompt.includes('remember-target: exactly 1 single_select')).toStrictEqual(true);
    expect(prompt.includes('apply-target: exactly 2 single_select')).toStrictEqual(true);
  },
);

testCase('sourceMaterialForPrompt reports truncation stats', () => {
  const source = `${'a'.repeat(1200)}\n\n`;
  const result = sourceMaterialForPrompt(source, 1000);

  expect(result.text).toStrictEqual(`${'a'.repeat(1000)}\n...[truncated]`);
  expect(result.stats).toStrictEqual({
    totalChars: 1200,
    includedChars: 1000,
    maxChars: 1000,
    truncated: true,
  });
});

testCase('buildAssessmentGenerationPrompt supports larger file-backed source budgets', () => {
  const sourceMaterial = 'x'.repeat(7000);
  const prompt = buildAssessmentGenerationPrompt({
    blueprint: testAssessmentBlueprint([
      { id: 'choice-target', questionType: 'single_select', count: 2 },
    ]),
    gradeLevel: '8',
    brief: '',
    sourceMaterial,
    sourceMaterialMaxChars: FILE_SOURCE_MATERIAL_PROMPT_CHARS,
    evidenceMode: 'block',
  });

  expect(prompt.includes('...[truncated]')).toStrictEqual(false);
  expect(prompt.includes('x'.repeat(7000))).toStrictEqual(true);
});

testCase('mapOpenRouterChatCompletionToParserInput maps model content and usage', () => {
  return readFixture('chat_completion_success.json').then((fixture) => {
    const parserInput = mapOpenRouterChatCompletionToParserInput(fixture, 'fast');

    expect(parserInput.mode).toStrictEqual('fast');
    expect(parserInput.model).toStrictEqual('openrouter/model-fast');
    expect(parserInput.content.includes('"type":"single_select"')).toStrictEqual(true);
    expect(parserInput.usage.promptTokens).toStrictEqual(111);
    expect(parserInput.usage.completionTokens).toStrictEqual(222);
    expect(parserInput.usage.totalTokens).toStrictEqual(333);
  });
});

testCase('mapOpenRouterChatCompletionToParserInput supports text-part arrays', () => {
  return readFixture('chat_completion_content_array.json').then((fixture) => {
    const parserInput = mapOpenRouterChatCompletionToParserInput(fixture, 'thorough');

    expect(parserInput.mode).toStrictEqual('thorough');
    expect(parserInput.model).toStrictEqual('openrouter/model-thorough');
    expect(parserInput.content).toStrictEqual('[{"type":"multi_select","title":"Q2"}]');
    expect(parserInput.usage.totalTokens).toStrictEqual(125);
  });
});

testCase('mapOpenRouterChatCompletionToParserInput rejects malformed payloads', () => {
  expect(() => mapOpenRouterChatCompletionToParserInput({ model: '', choices: [] }, 'thorough'))
    .toThrowError(OpenRouterGenerationError);
  expect(() =>
    mapOpenRouterChatCompletionToParserInput(
      {
        model: 'openrouter/model-thorough',
        choices: [{ message: { content: '' } }],
      },
      'thorough',
    )
  ).toThrowError(OpenRouterGenerationError);
});
