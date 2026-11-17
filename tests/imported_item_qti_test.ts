import { expect, test as testCase } from 'vitest';

import { examViewXmlAdapter } from '../lib/import/adapters/examview_xml.ts';
import { buildImportedItem } from '../lib/import/imported_item_qti.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import type { UnlabeledImportDraft } from '../lib/import/imported_item_qti.ts';

testCase('import preview build failures produce a blocking warning and review placeholder', () => {
  const result = buildImportedItem({
    draft: {
      type: 'single_select',
      title: 'Unsafe stylesheet',
      bodyHtml: '<p>Choose one.</p>',
      choices: [
        { id: 'A', text: 'First' },
        { id: 'B', text: 'Second' },
      ],
      correctId: 'A',
      stylesheets: [{ href: 'https://example.invalid/item.css' }],
    },
    identifier: 'unsafe-stylesheet',
    title: 'Unsafe stylesheet',
    sourceText: 'Choose one.',
    href: 'examview/unsafe-stylesheet.xml',
    sourceFormat: 'examview',
  });

  expect(result.draftValidation.warnings).toStrictEqual([{
    code: 'QFLOW_DRAFT_VALIDATION',
    message:
      'stylesheets[0].href: Stylesheet "https://example.invalid/item.css" uses an unsafe or external reference.',
    detail:
      'QTI preview build failed; QFlowLearn created a non-interactive placeholder for review.',
    path: 'examview/unsafe-stylesheet.xml',
  }]);
  expect(result.xml).toContain('<qti-assessment-item');
  expect(result.xml).toContain('<qti-item-body><p>Choose one.</p></qti-item-body>');
});

testCase('migration analysis reuses the preview validation result exactly once', () => {
  const href = 'examview/unsafe-stylesheet.xml';
  const draft: UnlabeledImportDraft & { type: 'single_select' } = {
    type: 'single_select',
    title: 'Unsafe stylesheet',
    bodyHtml: '<p>Choose one.</p>',
    choices: [
      { id: 'A', text: 'First' },
      { id: 'B', text: 'Second' },
    ],
    correctId: 'A',
    stylesheets: [{ href: 'https://example.invalid/item.css' }],
  };
  const item = buildImportedItem({
    draft,
    identifier: 'unsafe-stylesheet',
    title: 'Unsafe stylesheet',
    sourceText: 'Choose one.',
    href,
    sourceFormat: 'examview',
  });
  const analysis = buildMigrationAnalysis(
    {
      organizationGroups: [],
      title: 'Unsafe stylesheet',
      parts: [{ id: 'part-1', title: 'Part 1', placements: [{ href }] }],
      items: [item],
      assets: [],
    },
    { adapter: examViewXmlAdapter, sniff: { supported: true, confidence: 1 } },
    { _tag: 'Assessment' },
  );

  expect(analysis.items[0].warnings).toStrictEqual(item.draftValidation.warnings);
  expect(analysis.summary.warningCounts.QFLOW_DRAFT_VALIDATION).toStrictEqual(1);
});
