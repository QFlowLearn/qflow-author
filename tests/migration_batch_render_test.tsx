import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import MigrationBatchPage, { parseBatchFeedback } from '../lib/http/routes/import_pages/batch.tsx';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { MigrationBatchRecord } from '../lib/import/migration_types.ts';
import type {
  MigrationApprovalState,
  MigrationExecutionState,
} from '../lib/import/migration_state.ts';
import { SAMPLE_QTI_MIGRATION_RUN } from '../lib/sample_migration_report.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

function batch(overrides: Partial<MigrationBatchRecord> = {}): MigrationBatchRecord {
  return {
    id: 'batch-sentinel',
    purpose: 'recover_existing',
    createdBy: 'creator-sentinel',
    idempotencyKey: 'idempotency-sentinel',
    requestFingerprint: 'fingerprint-sentinel',
    sourceCount: 2,
    status: 'review',
    assignedReviewerId: null,
    assignedReviewerName: null,
    assignedReviewerEmail: null,
    assignedBy: null,
    assignedAt: null,
    createdAt: '2026-04-23T15:00:00.000Z',
    updatedAt: '2026-04-24T15:00:00.000Z',
    progress: {
      files: { total: 12345, queued: 2, processing: 1, analyzed: 12000, failed: 2, committed: 3 },
      assessments: { total: 67890, committed: 12345 },
      items: {
        total: 23456,
        ready: 1,
        reviewNeeded: 2,
        blocked: 3,
        pendingReview: 4,
        accepted: 5,
        rejected: 6,
      },
      assets: { recovered: 7890 },
      blockingFindings: { total: 7, blockedItems: 3, failedFiles: 2 },
    },
    runs: [{
      ...SAMPLE_QTI_MIGRATION_RUN,
      id: 'run-sentinel',
      batchId: 'batch-sentinel',
      sourceFilename: '<script>alert(1)</script>.QTI',
      summary: {
        ...SAMPLE_QTI_MIGRATION_RUN.summary,
        counts: { ...SAMPLE_QTI_MIGRATION_RUN.summary.counts, items: 12345 },
      },
    }],
    ...overrides,
  };
}

function page(
  locale: InterfaceLocale,
  data: Partial<MigrationBatchRecord> = {},
  error: 'reviewer_assignment_failed' | null = null,
) {
  const i18n = createI18n(locale, catalogForLocale(locale));
  return {
    i18n,
    html: renderToString(
      <MigrationBatchPage
        batch={batch(data)}
        members={[{
          userId: 'member-sentinel',
          displayName: '<script>member</script>',
          email: 'member@example.test',
          role: 'member',
          canPublishEditions: false,
        }]}
        error={error}
        i18n={i18n}
      />,
    ),
  };
}

testCase('migration batch page renders localized statuses, metrics, and stable values', () => {
  const batchStatuses: readonly MigrationBatchRecord['status'][] = [
    'queued',
    'processing',
    'review',
    'approval',
    'completed',
    'failed',
  ];
  const executionStates: readonly MigrationExecutionState[] = [
    { _tag: 'Queued', attempts: 0, maxAttempts: 3, lastFailure: null },
    { _tag: 'Analyzing', attempts: 1, maxAttempts: 3, startedAt: '2026-04-23T15:00:00.000Z' },
    { _tag: 'Analyzed', attempts: 1, maxAttempts: 3, completedAt: '2026-04-23T15:00:00.000Z' },
    {
      _tag: 'Failed',
      attempts: 3,
      maxAttempts: 3,
      failure: 'internal failure',
      completedAt: '2026-04-23T15:00:00.000Z',
    },
    {
      _tag: 'Committed',
      attempts: 1,
      maxAttempts: 3,
      completedAt: '2026-04-23T15:00:00.000Z',
      destination: { _tag: 'Assessment', assessmentId: 'assessment-sentinel' },
      committedAt: '2026-04-23T15:00:00.000Z',
    },
  ];
  const approvals: readonly MigrationApprovalState[] = [
    { _tag: 'Draft' },
    { _tag: 'Submitted', submittedBy: 'reviewer', submittedAt: '2026-04-23T15:00:00.000Z' },
    {
      _tag: 'Approved',
      submittedBy: 'reviewer',
      submittedAt: '2026-04-23T15:00:00.000Z',
      decidedBy: 'approver',
      decidedAt: '2026-04-23T15:00:00.000Z',
      note: null,
    },
    {
      _tag: 'ChangesRequested',
      submittedBy: 'reviewer',
      submittedAt: '2026-04-23T15:00:00.000Z',
      decidedBy: 'approver',
      decidedAt: '2026-04-23T15:00:00.000Z',
      note: 'needs changes',
    },
  ];

  for (const locale of locales) {
    const { i18n, html } = page(locale);
    for (
      const [status, id] of [
        ['queued', 'queued'],
        ['processing', 'processing'],
        ['review', 'review'],
        ['approval', 'approval'],
        ['completed', 'completed'],
        ['failed', 'failed'],
      ] as const
    ) {
      expect(page(locale, { status }).html).toContain(i18n.t(`imports.batch.${id}`));
    }
    for (
      const [execution, id] of [
        [executionStates[0], 'runQueued'],
        [executionStates[1], 'runProcessing'],
        [executionStates[2], 'runReady'],
        [executionStates[3], 'runFailed'],
        [executionStates[4], 'runCommitted'],
      ] as const
    ) {
      expect(page(locale, { runs: [{ ...batch().runs[0], execution }] }).html).toContain(
        i18n.t(`imports.batch.${id}`),
      );
    }
    for (
      const [approval, id] of [
        [approvals[0], 'approvalDraft'],
        [approvals[1], 'approvalSubmitted'],
        [approvals[2], 'approvalApproved'],
        [approvals[3], 'approvalChanges'],
      ] as const
    ) {
      expect(page(locale, { runs: [{ ...batch().runs[0], approval }] }).html).toContain(
        i18n.t(`imports.batch.${id}`),
      );
    }
    expect(page(locale, { sourceCount: 1 }).html).toContain(
      i18n.t('imports.batch.sourceCount', { count: 1 }),
    );
    expect(html).toContain(i18n.t('imports.batch.sourceCount', { count: 2 }));
    expect(html).toContain(
      i18n.t('imports.batch.assessmentRatio', { assigned: 12345, total: 67890 }),
    );
    expect(html).toContain(i18n.formatNumber(23456));
    expect(html).toContain(
      i18n.t('imports.batch.progressSummary', { queued: 2, processing: 1, failed: 2 }),
    );
    expect(html).toContain('name="action" value="assign-reviewer"');
    expect(html).toContain('value="member-sentinel"');
    expect(html).toContain('href="/imports/batches/batch-sentinel"');
    expect(html).toContain('href="/imports"');
    expect(html).toContain('href="/imports/run-sentinel"');
    if (!(html.includes('&lt;script>alert(1)&lt;/script>'))) {
      expect.unreachable("Expected html.includes('&lt;script>alert(1)&lt;/script>')");
    }
    if (!(html.includes('&lt;script>member&lt;/script>'))) {
      expect.unreachable("Expected html.includes('&lt;script>member&lt;/script>')");
    }
    if (html.includes('<script>')) expect.unreachable("Expected !html.includes('<script>')");
    expect(html).toContain('role="status"');
    expect(page(locale, {}, 'reviewer_assignment_failed').html).toContain('role="alert"');
    if (html.includes('imports.batch.')) {
      expect.unreachable("Expected !html.includes('imports.batch.')");
    }
    if (locale.startsWith('es-')) {
      for (
        const phrase of ['Migration batch', 'All imports', 'Reviewer', 'Sources', 'Assign reviewer']
      ) {
        if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
      }
    }
  }
  expect(batchStatuses.length).toStrictEqual(6);
});

testCase('migration batch feedback accepts only the stable token and localizes it', () => {
  for (const locale of locales) {
    const { i18n, html } = page(locale, {}, 'reviewer_assignment_failed');
    expect(parseBatchFeedback('reviewer_assignment_failed')).toStrictEqual(
      'reviewer_assignment_failed',
    );
    for (
      const raw of [
        null,
        '',
        'Could not assign the reviewer.',
        '<script>alert(1)</script>',
        'future_code',
      ]
    ) {
      expect(parseBatchFeedback(raw)).toStrictEqual(null);
    }
    expect(html).toContain(i18n.t('imports.batch.reviewerAssignmentFailed'));
    if (html.includes('reviewer_assignment_failed')) {
      expect.unreachable("Expected !html.includes('reviewer_assignment_failed')");
    }
  }
});
