import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { respondusStandardAdapter } from '../lib/import/adapters/respondus_standard.ts';
import { classifyRespondusLine } from '../lib/import/adapters/respondus_standard_grammar.ts';
import {
  detectImportAdapter,
  inspectImportAdapters,
  resolveImportAdapter,
} from '../lib/import/registry.ts';

const FIXTURES = new URL('fixtures/import/respondus/', import.meta.url);

testCase(
  'Respondus file names propose organization without changing delivery parts or question content',
  async () => {
    for (
      const [fixture, filename, title] of [
        ['standard-format.txt', '  Chapter 3 — Cells.TXT  ', 'Chapter 3 — Cells'],
        ['standard-format.txt', 'Export 2026.respondus', 'Export 2026'],
        ['word-visible-numbering.docx', 'Chapter 4 — Energy.DOCX', 'Chapter 4 — Energy'],
        ['standard-format.txt', '.txt', ''],
      ]
    ) {
      const bytes = await _fs.readFile(new URL(fixture, FIXTURES));
      const baseline = await respondusStandardAdapter.parse({ filename: fixture, bytes });
      const parsed = await respondusStandardAdapter.parse({ filename, bytes });
      expect(parsed.organizationGroups).toStrictEqual(
        title
          ? [{ id: 'respondus-file', title, hrefs: parsed.items.map((item) => item.href) }]
          : [],
      );
      expect(parsed.parts).toStrictEqual(baseline.parts);
      expect(parsed.items).toStrictEqual(baseline.items);
    }
  },
);

testCase(
  'Respondus Standard Format imports all documented common question types deterministically',
  async () => {
    const bytes = await _fs.readFile(new URL('standard-format.txt', FIXTURES));
    const source = { filename: 'standard-format.txt', mime: 'text/plain', bytes };
    const detection = await detectImportAdapter(source);
    expect(detection.adapter.id).toStrictEqual('respondus-standard');
    expect(detection.adapter.version).toStrictEqual('1');
    expect(detection.sniff.confidence).toStrictEqual(0.98);

    const first = await respondusStandardAdapter.parse(source);
    const second = await respondusStandardAdapter.parse(source);
    expect(first).toStrictEqual(second);
    expect(first.title).toStrictEqual('standard-format');
    expect(first.items.map((item) => item.draft.type)).toStrictEqual([
      'single_select',
      'single_select',
      'extended_text',
      'text_entry',
      'match',
      'multi_select',
    ]);
    expect(first.items.every((item) => (item.sourceEvidence?.length ?? 0) > 0)).toStrictEqual(true);
    expect(first.items[0].sourceEvidence?.map((entry) => entry.quote)).toStrictEqual([
      '1. Who measured the speed of light with an interferometer?',
      'a. Albert Einstein',
      '*b. Albert Michelson',
      'c. Thomas Edison',
      'd. Guglielmo Marconi',
    ]);
    expect(first.normalizedSource?.sourceKind).toStrictEqual('text');

    expect(first.items[0].draft.correctId).toStrictEqual('B');
    expect(first.items[1].draft.correctId).toStrictEqual('B');
    expect(first.items[2].draft.rubricHtml ?? '').toContain('null result');
    expect(first.items[3].draft.textEntries?.[0]?.answers.map((answer) => answer.value))
      .toStrictEqual([
        'Zworykin',
        'Vladimir Zworykin',
        'Vladimir Kosma Zworykin',
      ]);
    expect(first.items[4].draft.correctPairs?.length).toStrictEqual(3);
    expect(first.items[5].draft.correctIds).toStrictEqual(['A', 'C']);
    expect(first.warnings?.some((warning) => warning.code === 'RESPONDUS_FEEDBACK_NOT_MAPPED'))
      .toStrictEqual(true);
    expect(
      first.warnings?.filter((warning) => warning.code === 'RESPONDUS_POINTS_NOT_MAPPED').length,
    ).toStrictEqual(6);
  },
);

testCase(
  'Respondus missing and conflicting keys are blocked without defaulting to choice A',
  async () => {
    const adapter = resolveImportAdapter({ id: 'respondus-standard', version: '1' });
    for (const fixture of ['missing-answer.txt', 'conflicting-answer.txt']) {
      const bytes = await _fs.readFile(new URL(fixture, FIXTURES));
      const source = { filename: fixture, mime: 'text/plain', bytes };
      const sniff = await adapter.sniff(source);
      const parsed = await adapter.parse(source, sniff.hint);
      const analysis = buildMigrationAnalysis(parsed, { adapter, sniff }, { _tag: 'Assessment' });

      expect(adapter.id).toStrictEqual('respondus-standard');
      expect(parsed.items[0].draft.correctId).toStrictEqual('');
      expect(analysis.items[0].readiness).toStrictEqual('blocked');
      if (fixture === 'conflicting-answer.txt') {
        expect(
          analysis.items[0].warnings.some((warning) =>
            warning.code === 'RESPONDUS_INLINE_APPENDIX_ANSWER_CONFLICT'
          ),
        ).toStrictEqual(true);
      }
    }
  },
);

testCase('Respondus line grammar is shared by sniffing and parsing', () => {
  expect(classifyRespondusLine('Type: MA')).toStrictEqual({
    _tag: 'type_directive',
    code: 'MA',
  });
  expect(classifyRespondusLine('12) Question body')).toStrictEqual({
    _tag: 'question',
    number: 12,
    body: 'Question body',
  });
  expect(classifyRespondusLine('*b. Correct choice')).toStrictEqual({
    _tag: 'choice',
    label: 'B',
    body: 'Correct choice',
    markedCorrect: true,
  });
  expect(classifyRespondusLine('Answers:')).toStrictEqual({ _tag: 'answers_directive' });
});

testCase('Respondus Points remains active until another Points directive', async () => {
  const source = {
    filename: 'sticky-points.txt',
    mime: 'text/plain',
    bytes: new TextEncoder().encode([
      'Points: 2.5',
      '1. First question?',
      '*a. Yes',
      'b. No',
      '',
      '2. Second question?',
      '*a. Yes',
      'b. No',
      '',
      'Points: 4',
      '3. Third question?',
      '*a. Yes',
      'b. No',
    ].join('\n')),
  };
  const result = await respondusStandardAdapter.parse(source);
  const pointMessages = result.warnings
    ?.filter((warning) => warning.code === 'RESPONDUS_POINTS_NOT_MAPPED')
    .map((warning) => warning.message);

  expect(pointMessages).toStrictEqual([
    'Respondus assigns 2.5 points; QFlowLearn does not yet map per-question points.',
    'Respondus assigns 2.5 points; QFlowLearn does not yet map per-question points.',
    'Respondus assigns 4 points; QFlowLearn does not yet map per-question points.',
  ]);
});

testCase(
  'Respondus single-answer questions report multiple keys without overloading conflict',
  async () => {
    const source = {
      filename: 'multiple-single-keys.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode([
        '1. Choose one.',
        '*a. First',
        '*b. Second',
      ].join('\n')),
    };
    const detection = await detectImportAdapter(source);
    const parsed = await detection.adapter.parse(source, detection.sniff.hint);
    const analysis = buildMigrationAnalysis(parsed, detection, { _tag: 'Assessment' });

    expect(parsed.items[0].draft.correctId).toStrictEqual('');
    expect(
      analysis.items[0].warnings.some((warning) =>
        warning.code === 'RESPONDUS_SINGLE_ANSWER_MULTIPLE_KEYS'
      ),
    ).toStrictEqual(true);
    expect(
      analysis.items[0].warnings.some((warning) =>
        warning.code === 'RESPONDUS_INLINE_APPENDIX_ANSWER_CONFLICT'
      ),
    ).toStrictEqual(false);
    expect(analysis.items[0].readiness).toStrictEqual('blocked');
  },
);

testCase(
  'Respondus does not claim a generic numbered quiz without a format-specific marker',
  async () => {
    const source = {
      filename: 'numbered-quiz.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode([
        '1. Which option is correct?',
        'a. First',
        'b. Second',
      ].join('\n')),
    };
    const inspected = await inspectImportAdapters(source);
    const respondus = inspected.find((entry) => entry.adapter.id === 'respondus-standard');

    expect(respondus?.sniff).toStrictEqual({
      supported: false,
      confidence: 0.66,
      reason: 'possible-respondus-numbered-choice-pattern',
    });
    await expect(Promise.resolve().then(() => detectImportAdapter(source))).rejects.toSatisfy((
      caught: unknown,
    ) => caught instanceof Error && caught.message.includes('Unsupported import format'));
  },
);

testCase(
  'Respondus word-form true/false keys resolve by choice text rather than position',
  async () => {
    const source = {
      filename: 'reversed-true-false.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode([
        '1. The statement is correct.',
        'a. False',
        'b. True',
        '',
        '2. The statement is incorrect.',
        'a. False',
        'b. True',
        '',
        'Answers:',
        '1. True',
        '2. False',
      ].join('\n')),
    };
    const result = await respondusStandardAdapter.parse(source);

    expect(result.items.map((item) => item.draft.type)).toStrictEqual([
      'single_select',
      'single_select',
    ]);
    expect(result.items.map((item) => item.draft.correctId)).toStrictEqual(['B', 'A']);
  },
);

testCase('Respondus malformed boundaries fail with line-specific diagnostics', async () => {
  const bytes = await _fs.readFile(new URL('malformed.txt', FIXTURES));
  await expect(
    Promise.resolve().then(() =>
      respondusStandardAdapter.parse({
        filename: 'malformed.txt',
        mime: 'text/plain',
        bytes,
      })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('line 3')
  );
});

testCase(
  'Respondus DOCX uses the same deterministic grammar and preserves block evidence',
  async () => {
    const bytes = await _fs.readFile(new URL('word-visible-numbering.docx', FIXTURES));
    const source = {
      filename: 'word-visible-numbering.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes,
    };
    const result = await respondusStandardAdapter.parse(source);

    expect(result.items.map((item) => item.draft.type)).toStrictEqual([
      'single_select',
      'text_entry',
    ]);
    expect(result.items[0].draft.correctId).toStrictEqual('A');
    expect(result.items[1].draft.textEntries?.[0]?.answers[0]?.value).toStrictEqual(
      'Hypertext Transfer Protocol',
    );
    expect(result.normalizedSource?.sourceKind).toStrictEqual('docx');
    expect(result.items[0].sourceEvidence?.[0]?.kind).toStrictEqual('block');
  },
);

testCase('Respondus fixture corpus makes Word numbering and media loss explicit', async () => {
  const adapter = resolveImportAdapter({ id: 'respondus-standard', version: '1' });
  const autoNumbered = {
    filename: 'word-automatic-numbering.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: await _fs.readFile(new URL('word-automatic-numbering.docx', FIXTURES)),
  };
  expect(await adapter.sniff(autoNumbered)).toStrictEqual({
    supported: false,
    confidence: 0,
    reason: 'no-respondus-question-pattern',
  });
  await expect(Promise.resolve().then(() => detectImportAdapter(autoNumbered))).rejects.toSatisfy((
    caught: unknown,
  ) => caught instanceof Error && caught.message.includes('Unsupported import format'));

  const embeddedMedia = {
    filename: 'word-embedded-media.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: await _fs.readFile(new URL('word-embedded-media.docx', FIXTURES)),
  };
  const parsed = await adapter.parse(embeddedMedia);
  const sniff = await adapter.sniff(embeddedMedia);
  const analysis = buildMigrationAnalysis(parsed, { adapter, sniff }, { _tag: 'Assessment' });
  expect(sniff).toStrictEqual({
    supported: true,
    confidence: 0.94,
    reason: 'respondus-starred-answer',
  });
  expect(parsed.normalizedSource?.blocks.some((block) => block.kind === 'image')).toStrictEqual(
    true,
  );
  expect(parsed.warnings?.map((warning) => warning.code)).toStrictEqual([
    'RESPONDUS_IMAGE_REQUIRES_ASSET',
  ]);
  expect(analysis.items[0].readiness).toStrictEqual('blocked');

  const looseText = {
    filename: 'loose-numbered-quiz.txt',
    mime: 'text/plain',
    bytes: await _fs.readFile(new URL('loose-numbered-quiz.txt', FIXTURES)),
  };
  expect(await adapter.sniff(looseText)).toStrictEqual({
    supported: false,
    confidence: 0.66,
    reason: 'possible-respondus-numbered-choice-pattern',
  });

  const loosePdf = {
    filename: 'loose-numbered-quiz.pdf',
    mime: 'application/pdf',
    bytes: await _fs.readFile(new URL('loose-numbered-quiz.pdf', FIXTURES)),
  };
  expect(await adapter.sniff(loosePdf)).toStrictEqual({
    supported: false,
    confidence: 0,
    reason: 'unsupported-container',
  });
});

testCase(
  'Respondus numeric fill answers stay fill-in-the-blank values with numeric base type',
  async () => {
    const source = {
      filename: 'numeric.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode([
        'Type: F',
        '1. What is six times seven?',
        'a. 42',
      ].join('\n')),
    };
    const result = await respondusStandardAdapter.parse(source);

    expect(result.items[0].draft.type).toStrictEqual('text_entry');
    expect(result.items[0].draft.textEntries?.[0]?.responseBaseType).toStrictEqual('float');
    expect(result.items[0].draft.textEntries?.[0]?.answers[0]?.value).toStrictEqual('42');
  },
);
