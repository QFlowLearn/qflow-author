import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { examViewXmlAdapter } from '../lib/import/adapters/examview_xml.ts';
import { detectImportAdapter, resolveImportAdapter } from '../lib/import/registry.ts';

const FIXTURES = new URL('fixtures/import/examview/', import.meta.url);

testCase('ExamView XML 4 imports the published question grammar deterministically', async () => {
  const bytes = await _fs.readFile(new URL('supported.xml', FIXTURES));
  const source = { filename: 'supported.xml', mime: 'application/xml', bytes };
  const detection = await detectImportAdapter(source);

  expect(detection.adapter.id).toStrictEqual('examview-xml');
  expect(detection.adapter.version).toStrictEqual('1');
  expect(detection.sniff).toStrictEqual({
    supported: true,
    confidence: 0.99,
    reason: 'examview-xml-4-root',
  });

  const first = await examViewXmlAdapter.parse(source);
  const second = await examViewXmlAdapter.parse(source);
  expect(first).toStrictEqual(second);
  expect(first.title).toStrictEqual('Synthetic portability check');
  expect(first.items.map((item) => item.draft.type)).toStrictEqual([
    'single_select',
    'single_select',
    'single_select',
    'text_entry',
    'extended_text',
    'text_entry',
    'extended_text',
    'extended_text',
    'extended_text',
    'extended_text',
    'match',
  ]);
  expect(first.items.map((item) => item.identifier)).toStrictEqual([
    'truth-1',
    'yes-no-1',
    'choice-1',
    'completion-1',
    'short-1',
    'numeric-1',
    'essay-1',
    'problem-1',
    'case-1',
    'other-1',
    'group-1',
  ]);
  expect(first.items[0].draft.correctId).toStrictEqual('T');
  expect(first.items[1].draft.correctId).toStrictEqual('N');
  expect(first.items[2].draft.correctId).toStrictEqual('B');
  expect(first.items[3].draft.textEntries?.[0]?.answers.map((answer) => answer.value))
    .toStrictEqual(['H2O', 'water']);
  expect(first.items[4].draft.rubricHtml ?? '').toContain('evaporation');
  expect(first.items[5].draft.textEntries?.[0]?.responseBaseType).toStrictEqual('float');
  expect(first.items[6].draft.rubricHtml ?? '').toContain('control provides a baseline');
  expect(first.items[10].draft.correctPairs).toStrictEqual([
    { sourceId: 'SOURCE_1', targetId: 'TARGET_1' },
    { sourceId: 'SOURCE_2', targetId: 'TARGET_2' },
    { sourceId: 'SOURCE_3', targetId: 'TARGET_3' },
  ]);
  expect(first.items.every((item) => item.xml.includes('<qti-assessment-item'))).toStrictEqual(
    true,
  );
  expect(first.items.every((item) => item.sourceEvidence?.length === 1)).toStrictEqual(true);
  expect(first.normalizedSource?.sourceKind).toStrictEqual('package');
  expect(first.normalizedSource?.uncertainties.map((entry) => entry.code)).toStrictEqual([
    'STRUCTURE_INFERRED',
  ]);
  expect(first.normalizedSource?.uncertainties[0]?.message).toStrictEqual(
    'Normalized view reconstructs review evidence from ExamView XML fields recognized by the import adapter; original XML remains the authority.',
  );
  expect(first.normalizedSource?.blocks.length).toStrictEqual(first.items.length);
  for (const item of first.items) {
    const evidence = item.sourceEvidence?.[0];
    const block: NonNullable<typeof first.normalizedSource>['blocks'][number] | undefined = first
      .normalizedSource?.blocks.find((candidate) => candidate.id === evidence?.blockId);
    expect(block?.kind).toStrictEqual('paragraph');
    expect(block?.kind === 'paragraph' && block.text.includes(evidence?.quote ?? '')).toStrictEqual(
      true,
    );
  }
  expect(first.warnings).toStrictEqual(undefined);
});

testCase('ExamView multiple choice preserves answer labels through Z', async () => {
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const source = {
    filename: 'late-choice-label.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      `<examview type="test" app-version="4.0">
        <question type="mc" question-id="late-label">
          <text>Choose the last option.</text>
          <choices><choice-a>First</choice-a><choice-u>Last</choice-u></choices>
          <answer>U</answer>
        </question>
      </examview>`,
    ),
  };

  const parsed = await adapter.parse(source);

  expect(parsed.items[0].draft.choices).toStrictEqual([
    { id: 'A', text: 'First' },
    { id: 'U', text: 'Last' },
  ]);
  expect(parsed.items[0].draft.correctId).toStrictEqual('U');
  expect(parsed.items[0].sourceEvidence?.[0]?.quote ?? '').toContain('U. Last');
  expect(parsed.warnings).toStrictEqual(undefined);
});

testCase('ExamView reports formatting flattened from a mapped answer field', async () => {
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const source = {
    filename: 'formatted-answer.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      `<examview type="test" app-version="4.0">
        <question type="es" question-id="essay-1">
          <text>Explain the result.</text>
          <answer><b>Use the control as a baseline.</b></answer>
        </question>
      </examview>`,
    ),
  };

  const parsed = await adapter.parse(source);

  expect(parsed.warnings?.map((warning) => warning.code)).toStrictEqual([
    'EXAMVIEW_FORMATTING_FLATTENED',
  ]);
  expect(parsed.items[0].draft.rubricHtml).toStrictEqual('<p>Use the control as a baseline.</p>');
});

testCase('ExamView XML keeps unsupported semantics visible and blocks acceptance', async () => {
  const bytes = await _fs.readFile(new URL('review-required.xml', FIXTURES));
  const source = { filename: 'review-required.xml', mime: 'application/xml', bytes };
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const sniff = await adapter.sniff(source);
  const parsed = await adapter.parse(source);
  const analysis = buildMigrationAnalysis(parsed, { adapter, sniff }, { _tag: 'Assessment' });

  expect(parsed.items.length).toStrictEqual(5);
  expect(parsed.items[0].draft.correctId).toStrictEqual('');
  expect(parsed.items[1].draft.textEntries?.[0]?.answers).toStrictEqual([]);
  expect(parsed.items[2].draft.textEntries?.[0]?.answers).toStrictEqual([]);
  expect(parsed.items[3].draft.type).toStrictEqual('extended_text');
  expect(parsed.items[4].draft.type).toStrictEqual('extended_text');
  expect(analysis.items.map((item) => item.readiness)).toStrictEqual([
    'blocked',
    'blocked',
    'blocked',
    'ready',
    'blocked',
  ]);

  const warningCodes = new Set(parsed.warnings?.map((warning) => warning.code));
  const analysisWarningCodes = new Set(
    analysis.items.flatMap((item) => item.warnings.map((warning) => warning.code)),
  );
  expect(warningCodes.has('INVALID_ANSWER_REFERENCE')).toStrictEqual(true);
  expect(warningCodes.has('EXAMVIEW_MEDIA_REQUIRES_REBUILD')).toStrictEqual(true);
  expect(warningCodes.has('EXAMVIEW_FORMATTING_FLATTENED')).toStrictEqual(true);
  expect(warningCodes.has('EXAMVIEW_RATIONALE_NOT_MAPPED')).toStrictEqual(true);
  expect(warningCodes.has('EXAMVIEW_METADATA_NOT_MAPPED')).toStrictEqual(true);
  expect(warningCodes.has('EXAMVIEW_NUMERIC_ANSWER_UNSUPPORTED')).toStrictEqual(true);
  expect(warningCodes.has('QFLOW_DRAFT_VALIDATION')).toStrictEqual(false);
  expect(analysisWarningCodes.has('QFLOW_DRAFT_VALIDATION')).toStrictEqual(true);
  expect(warningCodes.has('UNSUPPORTED_ITEM_STUBBED')).toStrictEqual(true);
  expect(parsed.items[0].xml).toContain('xmlns="https://purl.imsglobal.org/spec/qti/v3p0"');
});

testCase('ExamView matching groups retain member rationale and metadata diagnostics', async () => {
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const source = {
    filename: 'matching-evidence.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      `<examview type="test" app-version="4.0">
        <matching-group name="Terms"><text>Match each term.</text><choices>
          <choice-a>First definition</choice-a><choice-b>Second definition</choice-b>
        </choices></matching-group>
        <question type="ma" group="Terms" question-id="member-1">
          <text>First term</text><answer>A</answer>
          <rationale>The first term maps to the first definition.</rationale>
          <topic>Vocabulary</topic>
        </question>
      </examview>`,
    ),
  };

  const parsed = await adapter.parse(source);
  expect(parsed.items.length).toStrictEqual(1);
  expect(parsed.warnings?.map((warning) => warning.code)).toStrictEqual([
    'EXAMVIEW_RATIONALE_NOT_MAPPED',
    'EXAMVIEW_METADATA_NOT_MAPPED',
  ]);
  expect(parsed.items[0].sourceEvidence?.[0]?.quote ?? '').toContain(
    'Rationale: The first term maps to the first definition.',
  );
  expect(
    parsed.normalizedSource?.blocks[0].kind === 'paragraph'
      ? parsed.normalizedSource.blocks[0].text
      : '',
  ).toContain('topic: Vocabulary');
});

testCase('ExamView preserves review-only XML and blocks unrecognized item semantics', async () => {
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const source = {
    filename: 'classified-features.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      `<examview type="test" app-version="4.0">
        <instruction type="pre-test"><text>Read  every question before answering.
Keep this line intact.</text></instruction>
        <question type="co" question-id="classified">
          <text>Complete the statement.</text>
          <answer>expected response</answer>
          <info><answer-space lines="4"/></info>
          <scoring-model mode="proprietary">special behavior</scoring-model>
        </question>
      </examview>`,
    ),
  };

  const sniff = await adapter.sniff(source);
  const parsed = await adapter.parse(source);
  const analysis = buildMigrationAnalysis(parsed, { adapter, sniff }, { _tag: 'Assessment' });

  expect(parsed.warnings?.map((warning) => warning.code)).toStrictEqual([
    'EXAMVIEW_DOCUMENT_PRESENTATION_NOT_MAPPED',
    'EXAMVIEW_METADATA_NOT_MAPPED',
    'EXAMVIEW_UNRECOGNIZED_CONTENT',
  ]);
  expect(analysis.items[0].readiness).toStrictEqual('blocked');
  expect(
    parsed.normalizedSource?.blocks[0].kind === 'paragraph'
      ? parsed.normalizedSource.blocks[0].text
      : '',
  ).toContain('Read  every question before answering.\nKeep this line intact.');
  expect(parsed.items[0].sourceEvidence?.[0]?.quote ?? '').toContain('answer-space: lines="4"');
  expect(parsed.items[0].sourceEvidence?.[0]?.quote ?? '').toContain('unrecognized scoring-model');
});

testCase('ExamView XML refuses undocumented versions and narrative associations', async () => {
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const unsupportedVersion = {
    filename: 'newer.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      '<examview type="test" app-version="8.1"><question type="tf"><text>Claim.</text><answer>T</answer></question></examview>',
    ),
  };
  expect(await adapter.sniff(unsupportedVersion)).toStrictEqual({
    supported: false,
    confidence: 0.7,
    reason: 'examview-xml-version-unsupported',
  });
  await expect(Promise.resolve().then(() => adapter.parse(unsupportedVersion))).rejects.toSatisfy((
    caught: unknown,
  ) => caught instanceof Error && caught.message.includes('not supported'));

  const narrative = {
    filename: 'narrative.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      '<examview type="test" app-version="4.0"><narrative name="Passage"><text>Read this.</text></narrative><question type="tf"><text>Claim.</text><answer>T</answer></question></examview>',
    ),
  };
  await expect(Promise.resolve().then(() => adapter.parse(narrative))).rejects.toSatisfy((
    caught: unknown,
  ) => caught instanceof Error && caught.message.includes('narratives are not imported'));

  const unsupportedRootContent = {
    filename: 'unknown-root.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      '<examview type="test" app-version="4.0"><proprietary-settings/><question type="tf"><text>Claim.</text><answer>T</answer></question></examview>',
    ),
  };
  await expect(Promise.resolve().then(() => adapter.parse(unsupportedRootContent))).rejects
    .toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unsupported document content')
    );
});

testCase('ExamView XML rejects parser repairs, repeated fields, and stray text', async () => {
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const cases = [
    {
      filename: 'malformed.xml',
      xml: '<examview app-version="4.0"><question type="co"><text>Broken</question></examview>',
      message: 'well-formed',
    },
    {
      filename: 'duplicate-answer.xml',
      xml:
        '<examview app-version="4.0"><question type="mc" question-id="duplicate-answer"><text>Choose.</text><choices><choice-a>A</choice-a><choice-b>B</choice-b></choices><answer>A</answer><answer>B</answer></question></examview>',
      message: 'must not repeat <answer>; found 2',
    },
    {
      filename: 'duplicate-text.xml',
      xml:
        '<examview app-version="4.0"><question type="co" question-id="duplicate-text"><text>First.</text><text>Second.</text><answer>First</answer></question></examview>',
      message: 'must not repeat <text>; found 2',
    },
    {
      filename: 'stray-text.xml',
      xml:
        '<examview app-version="4.0"><question type="co" question-id="stray">unscoped text<text>Prompt.</text><answer>Answer</answer></question></examview>',
      message: 'contains text outside recognized field elements',
    },
  ];

  for (const testCase of cases) {
    const source = {
      filename: testCase.filename,
      mime: 'application/xml',
      bytes: new TextEncoder().encode(testCase.xml),
    };
    await expect(Promise.resolve().then(() => adapter.parse(source))).rejects.toSatisfy((
      caught: unknown,
    ) => caught instanceof Error && caught.message.includes(testCase.message));
  }
});

testCase('ExamView sniff classifies the XML root instead of matching comments', async () => {
  const adapter = resolveImportAdapter({ id: 'examview-xml', version: '1' });
  const source = {
    filename: 'comment-spoof.xml',
    mime: 'application/xml',
    bytes: new TextEncoder().encode(
      '<!-- <examview app-version="4.0"> --><examview app-version="5.0"></examview>',
    ),
  };

  expect(await adapter.sniff(source)).toStrictEqual({
    supported: false,
    confidence: 0.7,
    reason: 'examview-xml-version-unsupported',
  });
});
