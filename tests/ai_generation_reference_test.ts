import { expect, test as testCase } from 'vitest';

import { parseAIGenerationReference } from '../lib/ai/generation_reference.ts';
import { parseAIGenerationJobOutput } from '../lib/conversion/generation_checkpoint.ts';

const generation = {
  provider: 'cloudflare_workers_ai',
  model: '@cf/example/model',
  mode: 'thorough',
  promptVersion: 'qflow.assessment-generation.v1',
} as const;

const providerCheckpoint = {
  _tag: 'provider_result',
  generation,
  content: '[]',
  usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
  source: {
    totalChars: 120,
    includedChars: 120,
    maxChars: 6000,
    truncated: false,
    fileBacked: false,
  },
  allowance: {
    plan: 'free',
    limit: 10,
    used: 2,
    remaining: 8,
    resetDate: '2026-02-01T00:00:00.000Z',
    allowThorough: false,
    maxQuestionsPerGeneration: 5,
  },
} as const;

testCase('provider checkpoints retain deterministic source and allowance facts', () => {
  expect(parseAIGenerationJobOutput(providerCheckpoint)).toStrictEqual(providerCheckpoint);
});

testCase('provider checkpoints reject the obsolete response-only shape', () => {
  expect(() =>
    parseAIGenerationJobOutput({
      _tag: 'provider_result',
      generation,
      content: '[]',
      usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Missing: source, allowance')
    ),
  );
});

testCase('completed generation output owns a typed provenance reference', () => {
  const output = parseAIGenerationJobOutput({
    _tag: 'completed',
    generation,
    result: {
      requestedCount: 2,
      parsedCount: 2,
      persistedCount: 1,
      errorCount: 1,
      providerUsage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
    },
  });

  expect(output).toStrictEqual({
    _tag: 'completed',
    generation,
    result: {
      requestedCount: 2,
      parsedCount: 2,
      persistedCount: 1,
      errorCount: 1,
      providerUsage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
    },
  });
});

testCase(
  'completed generation results reject duplicate configuration and contradictory counts',
  () => {
    expect(() =>
      parseAIGenerationJobOutput({
        _tag: 'completed',
        generation,
        result: {
          requestedCount: 1,
          parsedCount: 1,
          persistedCount: 1,
          errorCount: 0,
          providerUsage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
          promptVersion: 'contradictory-version',
        },
      })
    ).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('unknown: promptVersion')
      ),
    );
    expect(() =>
      parseAIGenerationJobOutput({
        _tag: 'completed',
        generation,
        result: {
          requestedCount: 2,
          parsedCount: 2,
          persistedCount: 1,
          errorCount: 0,
          providerUsage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
        },
      })
    ).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('counts are contradictory')
      ),
    );
  },
);

testCase('generation references reject missing and unknown configuration fields', () => {
  expect(() =>
    parseAIGenerationReference({
      provider: 'openrouter_chat_completions',
      model: 'example/model',
      mode: 'fast',
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Missing: promptVersion')
    ),
  );
  expect(() =>
    parseAIGenerationReference({
      ...generation,
      prompt: 'private prompt body',
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unknown: prompt')
    ),
  );
});
