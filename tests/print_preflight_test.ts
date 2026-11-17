import { expect, test } from 'vitest';
import { preflightPrint, printImageReferences } from '../lib/print/print_preflight.ts';
import { parsePrintConfiguration } from '../lib/print/print_contract.ts';
import type { PrintSource } from '../lib/print/print_snapshot.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

const configuration = parsePrintConfiguration({
  title: 'Paper',
  paper: 'a4',
  locale: 'en-US',
  instructions: '',
  responseLines: 6,
  responseOverrides: {},
  order: 'authored',
  approvePresentation: true,
});
if (!configuration) throw Error('Invalid fixture configuration.');
function source(): PrintSource {
  const question = {
    kind: 'question' as const,
    id: crypto.randomUUID(),
    questionId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    revision: 1,
    staffTitle: 'Staff title',
    xml: exportQti3TestItemXml('single_select', {
      title: 'Staff title',
      bodyHtml: '<p>Choose.</p>',
      choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
      correctId: 'B',
      maximumScore: 2,
    }),
  };
  return {
    assessmentId: crypto.randomUUID(),
    assessmentTitle: 'Fixture',
    assessmentMetadata: {},
    adaptive: false,
    parts: [
      {
        id: crypto.randomUUID(),
        title: 'Main',
        options: {},
        placements: [
          { kind: 'content', id: crypto.randomUUID(), content: { kind: 'text', text: 'Before' } },
          question,
          {
            kind: 'content',
            id: crypto.randomUUID(),
            content: {
              kind: 'image',
              src: '/uploads/11111111-1111-4111-8111-111111111111',
              alt: 'Diagram',
              longDescription: '',
            },
          },
          { ...question, id: crypto.randomUUID() },
        ],
      },
      {
        id: crypto.randomUUID(),
        title: 'Empty section',
        options: {
          instructionsHtml:
            '<p>After all questions.</p><img src="/uploads/22222222-2222-4222-8222-222222222222" alt="Section diagram"/>',
        },
        placements: [],
      },
    ],
  };
}
test('preflight retains every ordered occurrence and unscored anchor, including empty-section instructions', () => {
  const input = source(), result = preflightPrint(input, configuration);
  expect(result.preflight.outcome).toBe('ready');
  expect(result.parts[0].placements.map((placement) => placement.id)).toEqual(
    input.parts[0].placements.map((placement) => placement.id),
  );
  expect(result.parts[0].placements.map((placement) => placement.kind)).toEqual([
    'content',
    'question',
    'content',
    'question',
  ]);
  expect(JSON.stringify(result.parts[1].instructions)).toContain('After all questions.');
  expect(printImageReferences(result.parts)).toHaveLength(2);
  const missing = preflightPrint(
    input,
    configuration,
    new Map([['/uploads/22222222-2222-4222-8222-222222222222', 'image_unavailable']]),
  );
  expect(missing.preflight.outcome).toBe('blocked');
  expect(missing.preflight.items.find((item) => item.placementId === input.parts[1].id)?.codes)
    .toContain('image_unavailable');
});
test('unsupported section behavior produces findings for every affected anchor without omitting content', () => {
  const input = source();
  const changed = {
    ...input,
    adaptive: true,
    parts: input.parts.map((part) => ({
      ...part,
      options: { ...part.options, navigationMode: 'linear' as const, timeLimits: { maxTime: 30 } },
    })),
  };
  const result = preflightPrint(changed, configuration);
  expect(result.preflight.outcome).toBe('blocked');
  for (const placement of input.parts[0].placements) {
    expect(result.preflight.items.find((finding) => finding.placementId === placement.id)?.codes)
      .toEqual(
        expect.arrayContaining([
          'adaptive_unsupported',
          'timing_unsupported',
          'linear_navigation_unsupported',
        ]),
      );
  }
  expect(result.parts[0].placements).toHaveLength(4);
});
test('aggregate source budget blocks the complete corpus before deep or oversized content is parsed', () => {
  const input = source();
  const placements = Array.from(
    { length: 101 },
    () => ({
      kind: 'question' as const,
      id: crypto.randomUUID(),
      questionId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      revision: 1,
      staffTitle: 'Too large',
      xml: '<div>'.repeat(6000),
    }),
  );
  const result = preflightPrint(
    { ...input, parts: [{ ...input.parts[0], placements }] },
    configuration,
  );
  expect(result.parts).toEqual([]);
  expect(result.preflight.items).toHaveLength(102);
  expect(result.preflight.items.every((finding) => finding.codes.includes('source_limit'))).toBe(
    true,
  );
});
