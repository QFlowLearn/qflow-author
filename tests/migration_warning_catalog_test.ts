import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { parseItemLanguage } from '../lib/types/item_language.ts';

const IMPORTED_LANGUAGE = parseItemLanguage('fr-CA');

import { qti21Adapter } from '../lib/import/adapters/qti21.ts';
import { aikenAdapter } from '../lib/import/adapters/aiken.ts';
import { QTI3_CORE_DIAGNOSTIC_CODES } from '../lib/import/adapters/qti3/diagnostic_codes.ts';
import {
  QTI_MIGRATOR_DIAGNOSTIC_CODES,
} from '../lib/import/adapters/qti_migrator_diagnostic_codes.ts';
import { migrationWarningCodeFromExternal } from '../lib/import/external_diagnostic_codes.ts';
import {
  buildMigrationAnalysis,
  determineItemReadiness,
} from '../lib/import/migration_analysis.ts';
import {
  CATALOG_MIGRATION_WARNING_CODES,
  explainMigrationWarning,
  parseMigrationWarningCode,
} from '../lib/import/migration_warning_catalog.ts';
import type { ImportResult } from '../lib/import/types.ts';

testCase('migration warning catalog alone determines acceptance blocking', () => {
  expect(determineItemReadiness([{ code: 'MISSING_CORRECT', message: 'Missing key.' }]))
    .toStrictEqual('blocked');
  expect(determineItemReadiness([{ code: 'MISSING_ORDER', message: 'Missing order.' }]))
    .toStrictEqual('major_review');
  expect(determineItemReadiness([{
    code: migrationWarningCodeFromExternal(
      'unregistered_incomplete_warning',
      QTI_MIGRATOR_DIAGNOSTIC_CODES,
    ),
    message: 'Unknown warning.',
  }])).toStrictEqual('blocked');
  expect(explainMigrationWarning('UNREGISTERED_IMPORT_DIAGNOSTIC').blocksAcceptance).toStrictEqual(
    true,
  );
  expect(() => parseMigrationWarningCode('EXAMVIEW_MEDIA_REQUIRES_REBUILT')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Unregistered migration warning code')
    ),
  );
});

testCase('external diagnostic producers cannot inherit internal warning policy by name', () => {
  for (const collision of ['import-failed', 'unsupported-item']) {
    expect(migrationWarningCodeFromExternal(collision, QTI_MIGRATOR_DIAGNOSTIC_CODES))
      .toStrictEqual('UNREGISTERED_IMPORT_DIAGNOSTIC');
    expect(migrationWarningCodeFromExternal(collision, QTI3_CORE_DIAGNOSTIC_CODES)).toStrictEqual(
      'UNREGISTERED_IMPORT_DIAGNOSTIC',
    );
  }
  expect(migrationWarningCodeFromExternal(
    'unsupported_item_stubbed',
    QTI_MIGRATOR_DIAGNOSTIC_CODES,
  )).toStrictEqual('UNSUPPORTED_ITEM_STUBBED');
});

testCase(
  'unsupported QTI 1.2 content and composite responses have explicit blocking policies',
  () => {
    for (
      const [external, expected] of [
        ['qti12_composite_responses_unsupported', 'QTI12_COMPOSITE_RESPONSES_UNSUPPORTED'],
        ['qti12_material_not_preserved', 'QTI12_MATERIAL_NOT_PRESERVED'],
      ] as const
    ) {
      const code = migrationWarningCodeFromExternal(external, QTI_MIGRATOR_DIAGNOSTIC_CODES);
      expect(code).toStrictEqual(expected);
      expect(explainMigrationWarning(code).blocksAcceptance).toStrictEqual(true);
      expect(determineItemReadiness([{ code, message: 'Source cannot be preserved.' }]))
        .toStrictEqual('blocked');
    }
  },
);

testCase('catalog diagnostics retain their closed internal policy codes', () => {
  expect(CATALOG_MIGRATION_WARNING_CODES.CATALOG_ID_INVALID).toStrictEqual('CATALOG_ID_INVALID');
  expect(CATALOG_MIGRATION_WARNING_CODES.CATALOG_CARD_REQUIRED).toStrictEqual(
    'CATALOG_CARD_REQUIRED',
  );
  expect(explainMigrationWarning('CATALOG_ID_INVALID').blocksAcceptance).toStrictEqual(true);
  expect(explainMigrationWarning('CATALOG_UNUSED').blocksAcceptance).toStrictEqual(false);
});

testCase('migration analysis preserves warnings that differ only by detail', () => {
  const href = 'items/question.xml';
  const parsed: ImportResult = {
    organizationGroups: [],
    title: 'Distinct warning details',
    parts: [{
      id: 'part-1',
      title: 'Part 1',
      placements: [{ href }],
    }],
    items: [{
      href,
      identifier: 'question',
      title: 'Question',
      xml: '<qti-assessment-item/>',
      draft: {
        type: 'single_select',
        itemLanguage: IMPORTED_LANGUAGE,
        title: 'Question',
        bodyHtml: '<p>Choose one.</p>',
        choices: [
          { id: 'A', text: 'First' },
          { id: 'B', text: 'Second' },
        ],
        correctId: 'A',
      },
    }],
    assets: [],
    warnings: [
      {
        code: 'STYLESHEET_HREF_REQUIRED',
        message: 'A stylesheet reference is missing.',
        detail: 'stylesheets[0].href',
        path: href,
      },
      {
        code: 'STYLESHEET_HREF_REQUIRED',
        message: 'A stylesheet reference is missing.',
        detail: 'stylesheets[1].href',
        path: href,
      },
    ],
  };

  const analysis = buildMigrationAnalysis(parsed, {
    adapter: aikenAdapter,
    sniff: { supported: true, confidence: 1 },
  }, { _tag: 'Assessment' });

  expect(analysis.items[0].warnings.map((warning) => warning.detail)).toStrictEqual([
    'stylesheets[0].href',
    'stylesheets[1].href',
  ]);
  expect(analysis.summary.counts.warnings).toStrictEqual(2);
  expect(analysis.summary.warningCounts.STYLESHEET_HREF_REQUIRED).toStrictEqual(2);
});

testCase('critical Respondus warnings have explicit UX and readiness policy', () => {
  const expected = [
    ['RESPONDUS_CHOICES_INCOMPLETE', 'Respondus answer choices incomplete', true],
    ['RESPONDUS_DUPLICATE_CHOICE', 'Respondus choice label repeated', true],
    ['RESPONDUS_ESSAY_ANSWER_MULTIPLE', 'Essay contains multiple model answers', false],
    ['RESPONDUS_FEEDBACK_NOT_MAPPED', 'Respondus feedback needs review', false],
    ['RESPONDUS_FEEDBACK_POSITION_INVALID', 'Respondus feedback is out of position', false],
    ['RESPONDUS_HTML_PRESERVED_AS_TEXT', 'Respondus HTML preserved as text', false],
    [
      'RESPONDUS_IMAGE_REQUIRES_ASSET',
      'Respondus image asset missing',
      true,
    ],
    [
      'RESPONDUS_INLINE_APPENDIX_ANSWER_CONFLICT',
      'Respondus answer sources conflict',
      true,
    ],
    ['RESPONDUS_MATCH_ANSWER_LIST_IGNORED', 'Matching answer list not applied', false],
    ['RESPONDUS_MULTIPLE_ANSWER_SINGLE_KEY', 'Multiple-answer question has one key', false],
    ['RESPONDUS_POINTS_NOT_MAPPED', 'Respondus points need review', false],
    [
      'RESPONDUS_SINGLE_ANSWER_MULTIPLE_KEYS',
      'Single-answer question has multiple keys',
      true,
    ],
  ] as const;

  for (const [code, title, blocksAcceptance] of expected) {
    const explanation = explainMigrationWarning(code);
    expect(explanation.title).toStrictEqual(title);
    expect(explanation.blocksAcceptance).toStrictEqual(blocksAcceptance);
    expect(determineItemReadiness([{ code, message: 'Respondus diagnostic.' }])).toStrictEqual(
      blocksAcceptance
        ? 'blocked'
        : explanation.severity === 'correction'
        ? 'major_review'
        : 'minor_review',
    );
  }
});

testCase('critical ExamView warnings have explicit UX and readiness policy', () => {
  const expected = [
    ['EXAMVIEW_QUESTION_TEXT_MISSING', 'ExamView question text missing', true],
    ['EXAMVIEW_CHOICES_INCOMPLETE', 'ExamView answer choices incomplete', true],
    [
      'EXAMVIEW_SINGLE_ANSWER_MULTIPLE_KEYS',
      'ExamView single-answer question has multiple keys',
      true,
    ],
    ['EXAMVIEW_NUMERIC_ANSWER_UNSUPPORTED', 'ExamView numeric answer needs repair', true],
    ['EXAMVIEW_MEDIA_REQUIRES_REBUILD', 'ExamView media needs an asset', true],
    ['EXAMVIEW_DYNAMIC_CONTENT_UNSUPPORTED', 'ExamView dynamic content needs rebuilding', true],
    ['EXAMVIEW_FORMATTING_FLATTENED', 'ExamView text formatting flattened', false],
    ['EXAMVIEW_RATIONALE_NOT_MAPPED', 'ExamView rationale preserved as evidence', false],
    ['EXAMVIEW_METADATA_NOT_MAPPED', 'ExamView metadata needs review', false],
    [
      'EXAMVIEW_DOCUMENT_PRESENTATION_NOT_MAPPED',
      'ExamView document settings need review',
      false,
    ],
    ['EXAMVIEW_UNRECOGNIZED_CONTENT', 'ExamView content is not recognized', true],
  ] as const;

  for (const [code, title, blocksAcceptance] of expected) {
    const explanation = explainMigrationWarning(code);
    expect(explanation.title).toStrictEqual(title);
    expect(explanation.blocksAcceptance).toStrictEqual(blocksAcceptance);
    expect(determineItemReadiness([{ code, message: 'ExamView diagnostic.' }])).toStrictEqual(
      blocksAcceptance
        ? 'blocked'
        : explanation.severity === 'correction'
        ? 'major_review'
        : 'minor_review',
    );
  }
});

testCase(
  'QTI 2 missing scoring and outcomes are explained and blocked instead of invented',
  async () => {
    const xml = (await _fs.readFile(
      new URL('fixtures/import/migration-batches/qti21-choice.xml', import.meta.url),
      'utf8',
    )).replace(/<outcomeDeclaration[^>]*\/>/, '').replace(/<responseProcessing[^>]*\/>/, '');
    const result = await qti21Adapter.parse({
      filename: 'unscored.xml',
      bytes: new TextEncoder().encode(xml),
      mime: 'application/xml',
    });
    expect(result.items[0].draft.type).toStrictEqual('extended_text');
    const codes = result.warnings?.map((w) => w.code);
    expect(codes?.includes('QTI2_RESPONSE_PROCESSING_NOT_PRESERVED')).toStrictEqual(true);
    expect(codes?.includes('QTI2_OUTCOMES_NOT_PRESERVED')).toStrictEqual(true);
    expect(codes?.includes('UNREGISTERED_IMPORT_DIAGNOSTIC')).toStrictEqual(false);
    expect(determineItemReadiness(result.warnings ?? [])).toStrictEqual('blocked');
  },
);
