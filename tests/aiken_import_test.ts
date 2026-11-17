import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { aikenAdapter } from '../lib/import/adapters/aiken.ts';

const SAMPLE = new URL('fixtures/import/aiken/sample1.txt', import.meta.url).pathname;

testCase(
  'Aiken import: parses single-select questions with period and parenthesis choices',
  async () => {
    const bytes = await _fs.readFile(SAMPLE);
    const result = await aikenAdapter.parse({
      filename: 'sample1.txt',
      bytes,
      mime: 'text/plain',
    });

    expect(result.title).toStrictEqual('Imported Aiken Quiz');
    expect(result.items.length).toStrictEqual(2);
    expect(result.parts.length).toStrictEqual(1);
    expect(result.parts[0].placements.length).toStrictEqual(2);

    const [first, second] = result.items;
    expect(first.draft.type).toStrictEqual('single_select');
    expect(second.draft.type).toStrictEqual('single_select');

    const firstDraft = first.draft as {
      correctId?: string;
      choices?: Array<{ id: string; text?: string }>;
      bodyHtml?: string;
    };
    const secondDraft = second.draft as {
      correctId?: string;
      choices?: Array<{ id: string; text?: string }>;
    };

    expect(firstDraft.correctId).toStrictEqual('B');
    expect(firstDraft.choices?.length).toStrictEqual(4);
    expect(firstDraft.bodyHtml ?? '').toContain('capital of France');

    expect(secondDraft.correctId).toStrictEqual('A');
    expect(secondDraft.choices?.length).toStrictEqual(3);
    expect(secondDraft.choices?.[0]?.id).toStrictEqual('A');
  },
);

testCase('Aiken import: surfaces clear errors for malformed answer references', () => {
  const invalid = new TextEncoder().encode(
    [
      'What color is the sky?',
      'A. Blue',
      'B. Green',
      'ANSWER: D',
    ].join('\n'),
  );

  expect(() =>
    aikenAdapter.parse({
      filename: 'broken.txt',
      bytes: invalid,
      mime: 'text/plain',
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('ANSWER references choice')
    ),
  );
});
