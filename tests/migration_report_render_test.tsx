import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import type { MigrationBatchRecord, MigrationRunRecord } from '../lib/import/migration_types.ts';
import type { MigrationBatchReviewContext } from '../lib/import/migration_batches.ts';
import { SAMPLE_QTI_MIGRATION_RUN } from '../lib/sample_migration_report.ts';
import { parseAssessmentBlueprint } from '../lib/assessment_blueprint.ts';
import MigrationReport, {
  migrationFeedbackMessage,
  parseMigrationFeedback,
} from '../lib/http/routes/import_pages/import_report.tsx';
import { presentMigrationSuggestion } from '../components/imports/migration_report_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { MigrationItemPreview } from '../components/imports/migration_item_preview.tsx';

const TEST_LOCALES = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;

testCase('unavailable migration preview uses localized sentence and preserves diagnostics', () => {
  const source = SAMPLE_QTI_MIGRATION_RUN.items[0];
  const item = {
    ...source,
    itemTypeLabel: 'AUTHORED-TYPE-Ω',
    importedDraft: {
      ...source.importedDraft,
      choices: [],
      correctId: 'MISSING-CHOICE',
    },
  };
  for (const locale of TEST_LOCALES) {
    const props = reportProps(locale);
    const html = renderToString(
      <MigrationItemPreview {...props} item={item} />,
    );
    expect(html).toContain(
      props.i18n.t('imports.preview.unavailable', { type: 'AUTHORED-TYPE-Ω' }),
    );
    expect(html).toContain(props.i18n.t('imports.report.previewRecovery'));
    expect(html).toContain('AUTHORED-TYPE-Ω');
    expect(html).toContain('At least two choices required.');
    expect(html).toContain('Correct choice must match one option.');
    if (!(!html.includes('imports.preview.') && !html.includes('imports.report.'))) {
      expect.unreachable(
        "Expected !html.includes('imports.preview.') && !html.includes('imports.report.')",
      );
    }
    if (locale.startsWith('es-')) {
      expect(html).not.toMatch(/Preview unavailable|Try opening this item/);
    }
  }
});

function reportProps(locale: typeof TEST_LOCALES[number]) {
  const catalog = catalogForLocale(locale);
  return {
    i18n: createI18n(locale, catalog),
    payload: createI18nPayload(locale, catalog, ['authoring', 'imports']),
    playerCatalog: playerMessageCatalogForLocale(locale),
  };
}

testCase('conversion workbench renders source, readiness, bulk actions, and approval', () => {
  const batch: MigrationBatchRecord = {
    id: SAMPLE_QTI_MIGRATION_RUN.batchId,
    purpose: 'recover_existing',
    createdBy: SAMPLE_QTI_MIGRATION_RUN.createdBy,
    idempotencyKey: 'sample-idempotency-key',
    requestFingerprint: 'sample-request-fingerprint',
    sourceCount: 1,
    status: 'review',
    assignedReviewerId: 'sample-reviewer',
    assignedReviewerName: 'Sample Reviewer',
    assignedReviewerEmail: 'reviewer@example.edu',
    assignedBy: SAMPLE_QTI_MIGRATION_RUN.createdBy,
    assignedAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
    createdAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
    updatedAt: SAMPLE_QTI_MIGRATION_RUN.updatedAt,
    progress: {
      files: {
        total: 1,
        queued: 0,
        processing: 0,
        analyzed: 1,
        failed: 0,
        committed: 0,
      },
      assessments: { total: 1, committed: 0 },
      items: {
        total: 5,
        ready: 1,
        reviewNeeded: 3,
        blocked: 1,
        pendingReview: 2,
        accepted: 1,
        rejected: 2,
      },
      assets: { recovered: 3 },
      blockingFindings: { total: 1, blockedItems: 1, failedFiles: 0 },
    },
    runs: [SAMPLE_QTI_MIGRATION_RUN],
  };
  for (const locale of TEST_LOCALES) {
    const props = reportProps(locale);
    const html = renderToString(
      <MigrationReport
        run={SAMPLE_QTI_MIGRATION_RUN}
        batch={batch}
        currentUserId='sample-reviewer'
        commitError={null}
        {...props}
      />,
    );
    expect(html).toContain(props.i18n.t('imports.report.sourceEvidence'));
    expect(html).toContain(props.i18n.t('imports.report.minorReview'));
    expect(html).toContain(props.i18n.t('imports.report.majorReview'));
    expect(html).toContain(props.i18n.t('imports.report.blocked'));
    expect(html).toContain(props.i18n.t('imports.report.acceptSelected'));
    expect(html).toContain(props.i18n.t('imports.report.change'));
    expect(html).toContain(props.i18n.t('imports.report.openEditor'));
    expect(html).toContain(props.i18n.t('imports.report.approval'));
    expect(html).toContain(props.i18n.t('imports.report.submit'));
    expect(html).toContain(
      `aria-label="${
        props.i18n.t('imports.report.selection', { title: 'Solve A Linear Equation' })
      }"`,
    );
    expect(html).toContain('value="single_select"');
    expect(html.includes(props.i18n.t('imports.report.commitHeading'))).toStrictEqual(false);
    expect(html).toContain('district-algebra-qti12-export.zip');
    if (locale.startsWith('es-')) {
      for (
        const removed of [
          'View evidence',
          'Open in editor',
          'Preview and edit',
          'Save in workbench',
          'Blueprint target',
          'Choose a target',
          'Align question',
          'Review suggestions',
        ]
      ) expect(html.includes(removed)).toStrictEqual(false);
    }
  }

  const approvedHtml = renderToString(
    <MigrationReport
      run={{
        ...SAMPLE_QTI_MIGRATION_RUN,
        approval: {
          _tag: 'Approved',
          submittedBy: SAMPLE_QTI_MIGRATION_RUN.createdBy,
          submittedAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
          decidedBy: 'sample-reviewer',
          decidedAt: SAMPLE_QTI_MIGRATION_RUN.updatedAt,
          note: null,
        },
      }}
      batch={batch}
      currentUserId='sample-reviewer'
      commitError={null}
      {...reportProps('en-US')}
    />,
  );
  expect(approvedHtml).toContain(reportProps('en-US').i18n.t('imports.report.commitHeading'));
  expect(approvedHtml).toContain(
    reportProps('en-US').i18n.t('imports.report.reviewEvidenceConfirmation'),
  );
});

testCase('conversion workbench links a question to its source evidence block', () => {
  const run = {
    ...SAMPLE_QTI_MIGRATION_RUN,
    items: [{
      ...SAMPLE_QTI_MIGRATION_RUN.items[0],
      evidence: [{
        kind: 'block' as const,
        artifactId: 'normalized-1',
        artifactHash: 'normalized-hash',
        blockId: 'block-1',
        quote: 'Sample evidence',
      }],
    }],
    artifacts: [{
      id: 'normalized-1',
      kind: 'normalized' as const,
      filename: 'source.normalized.json',
      mimeType: 'application/vnd.qflow.structured-source+json',
      size: 120,
      sha256: 'normalized-hash',
      storageKey: 'conversion-sources/sample/normalized',
      createdAt: '2026-04-23T15:00:00.000Z',
      document: {
        version: 1 as const,
        title: 'Algebra source',
        sourceKind: 'markdown' as const,
        blocks: [{ id: 'block-1', kind: 'paragraph' as const, text: 'Solve 3x + 7 = 22.' }],
        text: 'Solve 3x + 7 = 22.',
        uncertainties: [],
      },
    }],
  };

  const html = renderToString(
    <MigrationReport run={run} commitError={null} {...reportProps('en-US')} />,
  );

  expect(html).toContain('id="source-block-1"');
  expect(html).toContain('href="#source-block-1"');
  expect(html).toContain(reportProps('en-US').i18n.t('imports.report.viewEvidence'));
});

testCase(
  'conversion workbench localizes stable suggestion mappings without rewriting authored text',
  () => {
    const blueprint = parseAssessmentBlueprint({
      _tag: 'Defined',
      version: 1,
      outcomes: [{ id: 'outcome-1', title: 'AUTHORED OUTCOME', weight: 100 }],
      targets: [{
        id: 'target-1',
        outcomeId: 'outcome-1',
        count: 1,
        cognitiveDemand: 'understand',
        difficulty: 'medium',
        questionType: 'multi_select',
      }],
    });
    const run: MigrationRunRecord = {
      ...SAMPLE_QTI_MIGRATION_RUN,
      destination: { _tag: 'Assessment', blueprint },
      items: [{
        ...SAMPLE_QTI_MIGRATION_RUN.items[0],
        title: 'AUTHORED TITLE Ω',
        warnings: [{ code: 'EXTRACTION_UNCERTAINTY', message: 'HOSTILE-EXTERNAL-DIAGNOSTIC ⚠' }],
        importedDraft: {
          ...SAMPLE_QTI_MIGRATION_RUN.items[0].importedDraft,
          bodyHtml: '<p>AUTHORED BODY Δ</p>',
        },
        blueprintTargetId: 'target-1',
        reviewSuggestions: [
          {
            source: 'deterministic' as const,
            code: 'alignment.question_type_mismatch',
            category: 'alignment' as const,
            message: 'DO NOT RENDER THIS MACHINE MESSAGE',
          },
          {
            source: 'deterministic' as const,
            code: 'accessibility.missing_alt_text',
            category: 'accessibility' as const,
            message: 'DO NOT RENDER DETERMINISTIC PROSE',
          },
          {
            source: 'deterministic' as const,
            code: 'not-a-known-check',
            category: 'alignment' as const,
            message: 'DO NOT RENDER UNKNOWN PROSE',
          },
          {
            source: 'ai' as const,
            code: 'AI-CHECK',
            category: 'clueing' as const,
            message: 'AUTHORED AI UNICODE ✓',
          },
        ],
      }],
      sourceFilename: 'source-报告-Ω.zip',
      artifacts: SAMPLE_QTI_MIGRATION_RUN.artifacts.map((artifact) =>
        artifact.kind === 'normalized' && artifact.document
          ? {
            ...artifact,
            document: {
              ...artifact.document,
              blocks: [
                ...artifact.document.blocks,
                { id: 'unicode-source', kind: 'paragraph' as const, text: 'SOURCE BLOCK 漢字 ✓' },
              ],
              text: `${artifact.document.text}\nSOURCE BLOCK 漢字 ✓`,
            },
          }
          : artifact
      ),
    };

    for (const locale of TEST_LOCALES) {
      const props = reportProps(locale);
      const html = renderToString(
        <MigrationReport run={run} {...props} />,
      );
      expect(html).toContain(props.i18n.t('imports.report.suggestions'));
      expect(html).toContain(props.i18n.t('imports.report.typeMismatch', {
        expectedType: props.i18n.t('imports.blueprint.typeLabel', { type: 'multi_select' }),
        actualType: props.i18n.t('imports.blueprint.typeLabel', { type: 'single_select' }),
      }));
      expect(html).toContain(props.i18n.t('imports.report.aiFraming', {
        message: 'AUTHORED AI UNICODE ✓',
      }));
      expect(html).toContain('AUTHORED AI UNICODE ✓');
      expect(html).toContain('AUTHORED TITLE Ω');
      expect(html).toContain('AUTHORED BODY Δ');
      expect(html).toContain('SOURCE BLOCK 漢字 ✓');
      expect(html).toContain('HOSTILE-EXTERNAL-DIAGNOSTIC ⚠');
      expect(html).toContain(props.i18n.t('imports.report.previewIssues'));
      expect(html).toContain(props.i18n.t('imports.report.rawDiagnostic'));
      expect(html).toContain(props.i18n.t('imports.report.extractionUncertainty'));
      expect(presentMigrationSuggestion(
        {
          source: 'deterministic',
          code: 'accessibility.missing_alt_text',
          category: 'accessibility',
          message: 'DO NOT RENDER DETERMINISTIC PROSE',
        },
        run.items[0],
        blueprint,
        props.i18n,
      )).toStrictEqual(props.i18n.t('imports.suggestion.accessibility.missing_alt_text'));
      expect(html.includes('DO NOT RENDER THIS MACHINE MESSAGE')).toStrictEqual(false);
      expect(html.includes('DO NOT RENDER UNKNOWN PROSE')).toStrictEqual(false);
      expect(presentMigrationSuggestion(
        {
          source: 'deterministic',
          code: 'not-a-known-check',
          category: 'alignment',
          message: 'DO NOT RENDER UNKNOWN PROSE',
        },
        run.items[0],
        blueprint,
        props.i18n,
      )).toStrictEqual(props.i18n.t('imports.suggestion.unknown'));
    }
  },
);

testCase('migration feedback accepts only known codes and localizes each response', () => {
  const codes = [
    'approval-update-failed',
    'alignment-failed',
    'bulk-update-failed',
    'commit-failed',
    'preparation-invalidated',
    'question-update-failed',
    'retry-failed',
  ] as const;
  for (const locale of TEST_LOCALES) {
    const props = reportProps(locale);
    for (const code of codes) {
      expect(parseMigrationFeedback(code)).toStrictEqual(code);
      const message = migrationFeedbackMessage(props.i18n, code);
      if (!(message.length > 0)) expect.unreachable('Expected message.length > 0');
      if (message.includes(code)) expect.unreachable('Expected !message.includes(code)');
    }
    for (const invalid of [null, '', 'unknown', '<script>alert(1)</script>']) {
      expect(parseMigrationFeedback(invalid)).toStrictEqual(null);
    }
  }
});

testCase('migration report localizes empty and workflow status states', () => {
  const reviewBatch: MigrationBatchReviewContext = {
    id: 'review-batch',
    purpose: 'recover_existing',
    assignedReviewerId: 'assigned-reviewer',
    assignedReviewerName: null,
    assignedReviewerEmail: null,
  };
  for (const locale of TEST_LOCALES) {
    const props = reportProps(locale);
    for (const purpose of ['generate_new', 'recover_existing'] as const) {
      const html = renderToString(
        <MigrationReport
          run={{
            ...SAMPLE_QTI_MIGRATION_RUN,
            purpose,
            items: [],
            reviewProgress: { total: 0, pending: 0, accepted: 0, rejected: 0 },
          }}
          {...props}
        />,
      );
      const heading = purpose === 'generate_new'
        ? props.i18n.t('imports.report.sourcePreserved')
        : props.i18n.t('imports.report.noQuestions');
      const help = purpose === 'generate_new'
        ? props.i18n.t('imports.report.emptyGenerateHelp')
        : props.i18n.t('imports.report.emptyRecoverHelp');
      expect(html).toContain(heading);
      expect(html).toContain(help);
      if (purpose === 'generate_new') {
        expect(html).toContain(props.i18n.t('imports.generation.policy'));
        expect(html).toContain(props.i18n.t('imports.generation.generate'));
      } else {
        expect(html.includes(props.i18n.t('imports.generation.policy'))).toStrictEqual(false);
      }
    }
    for (
      const execution of [
        { _tag: 'Queued' as const, attempts: 0, maxAttempts: 3, lastFailure: null },
        {
          _tag: 'Analyzing' as const,
          attempts: 1,
          maxAttempts: 3,
          startedAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
        },
      ]
    ) {
      const html = renderToString(
        <MigrationReport
          run={{ ...SAMPLE_QTI_MIGRATION_RUN, execution }}
          {...props}
        />,
      );
      expect(html).toContain(props.i18n.t(
        execution._tag === 'Queued' ? 'imports.report.queued' : 'imports.report.analyzing',
      ));
    }
    const submitted = renderToString(
      <MigrationReport
        run={{
          ...SAMPLE_QTI_MIGRATION_RUN,
          approval: {
            _tag: 'Submitted',
            submittedBy: 'reviewer',
            submittedAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
          },
        }}
        batch={reviewBatch}
        {...props}
      />,
    );
    expect(submitted).toContain(props.i18n.t('imports.report.approvalWaiting'));
    const changesNote = 'CHANGES NOTE 漢字 ✓';
    const changes = renderToString(
      <MigrationReport
        run={{
          ...SAMPLE_QTI_MIGRATION_RUN,
          approval: {
            _tag: 'ChangesRequested',
            submittedBy: 'reviewer',
            submittedAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
            decidedBy: 'approver',
            decidedAt: SAMPLE_QTI_MIGRATION_RUN.updatedAt,
            note: changesNote,
          },
        }}
        batch={reviewBatch}
        {...props}
      />,
    );
    expect(changes).toContain(props.i18n.t('imports.report.changesNeeded'));
    expect(changes).toContain(changesNote);
  }
});

testCase(
  'migration report maps matching blueprint target values while keeping option IDs stable',
  () => {
    const blueprint = parseAssessmentBlueprint({
      _tag: 'Defined',
      version: 1,
      outcomes: [{ id: 'outcome-1', title: 'Outcome', weight: 100 }],
      targets: [{
        id: 'target-1',
        outcomeId: 'outcome-1',
        count: 2,
        cognitiveDemand: 'understand',
        difficulty: 'medium',
        questionType: 'single_select',
      }],
    });
    const run: MigrationRunRecord = {
      ...SAMPLE_QTI_MIGRATION_RUN,
      destination: { _tag: 'Assessment', blueprint },
      items: [{ ...SAMPLE_QTI_MIGRATION_RUN.items[0], blueprintTargetId: 'target-1' }],
    };
    for (const locale of TEST_LOCALES) {
      const props = reportProps(locale);
      const html = renderToString(<MigrationReport run={run} {...props} />);
      expect(html).toContain('value="target-1"');
      expect(html).toContain(
        props.i18n.t('imports.blueprint.demandLabel', { value: 'understand' }),
      );
      expect(html).toContain(
        props.i18n.t('imports.blueprint.difficultyLabel', { value: 'medium' }),
      );
      expect(html).toContain(
        props.i18n.t('imports.blueprint.typeLabel', { type: 'single_select' }),
      );
    }
  },
);

testCase('bank review preserves global counts, page links, and frozen background progress', () => {
  const run: MigrationRunRecord = {
    ...SAMPLE_QTI_MIGRATION_RUN,
    destination: { _tag: 'WorkspaceBank', collectionId: null },
    items: SAMPLE_QTI_MIGRATION_RUN.items.slice(0, 1),
    reviewProgress: { total: 7787, accepted: 7787, pending: 0, rejected: 0 },
  };
  const html = renderToString(
    <MigrationReport
      {...reportProps('en-US')}
      run={run}
      pagination={{
        page: 2,
        pageSize: 50,
        total: 7787,
        totalItems: 7787,
        blocked: 0,
        filter: 'all',
      }}
      commitProgress={{ state: 'running', completed: 50, total: 7787 }}
    />,
  );
  expect(html).toContain('?page=1');
  expect(html).toContain('?page=3');
  expect(html).toContain('Page 2 of 156');
  expect(html).toContain('Importing 50 of 7787 questions');
  expect(html).not.toMatch(/name="bulkAction"/);
});
