import { expect, test as testCase } from 'vitest';

import { parseItemLanguage } from '../lib/types/item_language.ts';

const IMPORTED_LANGUAGE = parseItemLanguage('fr-CA');

import { detectImportAdapter } from '../lib/import/registry.ts';
import { buildMigrationAnalysis, buildReviewProgress } from '../lib/import/migration_analysis.ts';
import { buildMigrationQaReport } from '../lib/import/migration_qa_report.ts';
import { assertConversionCommitApproval } from '../lib/import/migration_run_commit.ts';
import type { MigrationRunRecord } from '../lib/import/migration_types.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';

const enc = new TextEncoder();

const QTI21_CHOICE = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item1" title="Simple Choice" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>B</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Who was the first President of the United States?</p>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1" shuffle="false">
      <simpleChoice identifier="A">Thomas Jefferson</simpleChoice>
      <simpleChoice identifier="B">George Washington</simpleChoice>
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_UNSUPPORTED = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item2" title="Unsupported Type" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier"/>
  <itemBody>
    <unsupportedInteraction responseIdentifier="RESPONSE"/>
  </itemBody>
</assessmentItem>`;

testCase('migration analysis marks clean imports ready', async () => {
  const source = {
    filename: 'choice.xml',
    bytes: enc.encode(QTI21_CHOICE),
    mime: 'application/xml',
  };
  const detection = await detectImportAdapter(source);
  const parsed = await detection.adapter.parse(source, detection.sniff.hint);
  const analysis = buildMigrationAnalysis(parsed, detection, { _tag: 'Assessment' });

  expect(analysis.summary.counts.reviewNeeded).toStrictEqual(0);
  expect(analysis.summary.counts.items).toStrictEqual(1);
  expect(analysis.summary.counts.ready).toStrictEqual(1);
  expect(analysis.summary.counts.warnings).toStrictEqual(0);
  expect(analysis.items[0].readiness).toStrictEqual('ready');
  expect(analysis.items[0].itemType).toStrictEqual('single_select');
});

testCase('migration analysis marks unsupported stubs for review', async () => {
  const source = {
    filename: 'unsupported.xml',
    bytes: enc.encode(QTI21_UNSUPPORTED),
    mime: 'application/xml',
  };
  const detection = await detectImportAdapter(source);
  const parsed = await detection.adapter.parse(source, detection.sniff.hint);
  const analysis = buildMigrationAnalysis(parsed, detection, { _tag: 'Assessment' });

  expect(analysis.summary.counts.reviewNeeded).toStrictEqual(0);
  expect(analysis.summary.counts.items).toStrictEqual(1);
  expect(analysis.summary.counts.blocked).toStrictEqual(1);
  expect(analysis.summary.warningCounts.UNSUPPORTED_ITEM_STUBBED).toStrictEqual(1);
  expect(analysis.items[0].readiness).toStrictEqual('blocked');
});

testCase('migration review progress counts normalized states', () => {
  const progress = buildReviewProgress([
    { decision: 'accepted' },
    { decision: 'rejected' },
    { decision: 'pending' },
    { decision: 'pending' },
  ]);

  expect(progress).toStrictEqual({
    total: 4,
    accepted: 1,
    rejected: 1,
    pending: 2,
  });
});

testCase('conversion commit gate rejects blocked and changed items', () => {
  const run = sampleRun();
  const blocked = {
    ...run.items[0],
    readiness: 'blocked' as const,
    decision: 'accepted' as const,
    acceptedSnapshot: acceptedSnapshot(run.items[0].contentHash, run.items[0].contextHash),
    acceptedSnapshotHash: 'accepted-snapshot',
  };
  expect(() => assertConversionCommitApproval({ ...run, items: [blocked] }, [blocked.id], true))
    .toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('Blocked item')
      ),
    );
  const changed = {
    ...run.items[0],
    readiness: 'ready' as const,
    decision: 'accepted' as const,
    acceptedSnapshot: acceptedSnapshot('before-edit', run.items[0].contextHash),
    acceptedSnapshotHash: 'accepted-snapshot',
  };
  expect(() => assertConversionCommitApproval({ ...run, items: [changed] }, [changed.id], true))
    .toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('changed after acceptance')
      ),
    );
  expect(() => assertConversionCommitApproval(run, [run.items[0].id], false)).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Explicit approval')
    ),
  );
});

function acceptedSnapshot(contentHash: string, contextHash: string) {
  const actor = { id: 'user-1', displayName: 'Author', email: 'author@example.test' };
  return {
    version: 1 as const,
    contentHash,
    contextHash,
    origin: {
      _tag: 'Imported' as const,
      artifact: {
        id: 'artifact-1',
        filename: 'sample-qti.zip',
        mimeType: 'application/zip',
        size: 1024,
        sha256: 'a'.repeat(64),
      },
      migrationRunId: 'run-1',
      migrationItemId: 'item-1',
      href: 'items/one.xml',
      identifier: 'one',
      providedBy: actor,
      assistance: {
        _tag: 'DeterministicImport' as const,
        adapter: { id: 'qti21', label: 'QTI 2.1', version: '1' },
      },
      evidence: [],
      review: {
        decision: 'accepted' as const,
        reviewer: actor,
        reviewedAt: '2026-04-23T16:30:00.000Z',
        note: null,
        contentHash,
        contextHash,
      },
    },
  };
}

testCase('migration QA report summarizes compatibility and review state', () => {
  const report = buildMigrationQaReport(sampleRun(), new Date('2026-04-23T17:00:00.000Z'));

  expect(report).toContain('# QFlowLearn Migration QA Report');
  expect(report).toContain('## Fidelity & Compatibility Summary');
  expect(report).toContain('## Warning Guidance');
  expect(report).toContain('Image alternative text missing');
  expect(report).toContain('Add or verify the image description before accepting the item');
  expect(report).toContain(
    '| QTI 2.0 / 2.1 / 2.2 | Supported import to QFlowLearn/QTI 3.0 | Semantic fidelity for supported item types; unsupported constructs are flagged before commit | Detected for this package |',
  );
  expect(report).toContain('| Rejected | 1 |');
  expect(report).toContain('| Review required | 1 |');
  expect(report).toContain('One \\| Pipe');
  expect(report).toContain('Fix image alt text.');
  expect(report).toContain('Acceptance status: Complete');
});

function sampleRun(): MigrationRunRecord {
  return {
    id: 'run-1',
    organizationGroups: [],
    batchId: 'batch-1',
    batchPosition: 1,
    purpose: 'recover_existing',
    createdBy: 'user-1',
    creatorEmail: 'author@example.test',
    creatorName: 'Author',
    sourceFilename: 'sample-qti.zip',
    sourceMime: 'application/zip',
    sourceSize: 1024,
    adapter: { id: 'qti21', label: 'QTI 2.0/2.1/2.2', version: '1' },
    destination: { _tag: 'Assessment', blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT },
    execution: {
      _tag: 'Analyzed',
      attempts: 1,
      maxAttempts: 3,
      completedAt: '2026-04-23T16:00:00.000Z',
    },
    approval: { _tag: 'Draft' },
    summary: {
      title: 'Sample',
      counts: {
        parts: 1,
        items: 1,
        assets: 0,
        warnings: 1,
        ready: 0,
        reviewNeeded: 1,
        blocked: 0,
      },
      warningCounts: { IMAGE_ALT_MISSING: 1 },
      itemTypeCounts: { single_select: 1 },
      sniff: { confidence: 0.75, reason: 'manifest-qti21' },
    },
    createdAt: '2026-04-23T16:00:00.000Z',
    updatedAt: '2026-04-23T16:00:00.000Z',
    parts: [],
    reviewProgress: {
      total: 1,
      accepted: 0,
      rejected: 1,
      pending: 0,
    },
    items: [{
      id: 'item-1',
      runId: 'run-1',
      sourceHref: 'items/one.xml',
      sourceIdentifier: 'one',
      title: 'One | Pipe',
      itemType: 'single_select',
      itemTypeLabel: 'Single Select',
      position: 1,
      readiness: 'minor_review',
      warnings: [{ code: 'IMAGE_ALT_MISSING', message: 'Image is missing alt text.' }],
      sourceXml: '<assessmentItem/>',
      importedDraft: {
        type: 'single_select',
        title: 'One | Pipe',
        itemLanguage: IMPORTED_LANGUAGE,
      },
      blueprintTargetId: null,
      reviewSuggestions: [],
      createdQuestionId: null,
      createdRevision: null,
      decision: 'rejected',
      reviewNote: 'Fix image alt text.',
      reviewedBy: 'user-1',
      reviewedAt: '2026-04-23T16:30:00.000Z',
      evidence: [],
      extractionUncertainties: [],
      contentHash: 'content',
      contextHash: 'context',
      createdAt: '2026-04-23T16:00:00.000Z',
    }],
    artifacts: [],
  };
}

testCase(
  'bank analysis blocks part context while preserving assessment intake and embedded question context',
  async () => {
    const source = {
      filename: 'choice.xml',
      bytes: enc.encode(QTI21_CHOICE),
      mime: 'application/xml',
    };
    const detection = await detectImportAdapter(source);
    const parsed = await detection.adapter.parse(source, detection.sniff.hint);
    const parts = [{
      id: 'context',
      title: 'Shared context',
      placements: [{ href: parsed.items[0].href }],
      options: { instructionsHtml: '<p>Read this passage before answering.</p>' },
    }];
    const contextual = { ...parsed, parts };
    expect(
      buildMigrationAnalysis(contextual, detection, { _tag: 'WorkspaceBank', collectionId: null })
        .items[0].readiness,
    ).toStrictEqual('blocked');
    expect(buildMigrationAnalysis(contextual, detection, { _tag: 'Assessment' }).items[0].readiness)
      .toStrictEqual('ready');
    const bank = buildMigrationAnalysis(parsed, detection, {
      _tag: 'WorkspaceBank',
      collectionId: null,
    });
    expect(bank.items[0].readiness).toStrictEqual('ready');
    expect(bank.items[0].importedDraft).toStrictEqual(parsed.items[0].draft);
    expect(bank.items[0].sourceXml).toStrictEqual(parsed.items[0].xml);
  },
);
