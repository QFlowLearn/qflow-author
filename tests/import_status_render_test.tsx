import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import type { MigrationRunRecord } from '../lib/import/migration_types.ts';
import { SAMPLE_QTI_MIGRATION_RUN } from '../lib/sample_migration_report.ts';
import MigrationReport from '../components/imports/migration_report_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
const TEST_LOCALES = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
function reportProps(locale: typeof TEST_LOCALES[number]) {
  const catalog = catalogForLocale(locale);
  return {
    i18n: createI18n(locale, catalog),
    payload: createI18nPayload(locale, catalog, ['authoring', 'imports']),
    playerCatalog: playerMessageCatalogForLocale(locale),
  };
}
testCase('failed imports explain the failure before source evidence and offer a real retry', () => {
  for (const locale of TEST_LOCALES) {
    const props = reportProps(locale);
    const run: MigrationRunRecord = {
      ...SAMPLE_QTI_MIGRATION_RUN,
      items: [],
      reviewProgress: { total: 0, pending: 0, accepted: 0, rejected: 0 },
      execution: {
        _tag: 'Failed',
        attempts: 3,
        maxAttempts: 3,
        completedAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
        failure: 'QFlowLearn could not read this source with the selected format.',
      },
    };
    const html = renderToString(<MigrationReport run={run} {...props} />);
    if (!(run.execution._tag === 'Failed')) {
      expect.unreachable("Expected run.execution._tag === 'Failed'");
    }
    expect(html).toContain(run.execution.failure);
    expect(html).toContain(props.i18n.t('imports.report.failedHelp'));
    expect(html).toContain('name="action" value="retry"');
    if (!(html.indexOf(run.execution.failure) < html.indexOf('id="source-heading"'))) {
      expect.unreachable(
        'Expected html.indexOf(run.execution.failure) < html.indexOf(\'id="source-heading"\')',
      );
    }
    if (html.includes('assessment-plan-heading')) {
      expect.unreachable("Expected !html.includes('assessment-plan-heading')");
    }
    if (html.includes(props.i18n.t('imports.report.noQuestions'))) {
      expect.unreachable("Expected !html.includes(props.i18n.t('imports.report.noQuestions'))");
    }
    if (html.includes(props.i18n.t('imports.report.approvalIncomplete'))) {
      expect.unreachable(
        "Expected !html.includes(props.i18n.t('imports.report.approvalIncomplete'))",
      );
    }
    const readOnly = renderToString(<MigrationReport run={run} readOnly {...props} />);
    if (readOnly.includes('value="retry"')) {
      expect.unreachable('Expected !readOnly.includes(\'value="retry"\')');
    }
  }
});

testCase('active imports show next steps without empty results or editable plans', () => {
  for (const state of ['Queued', 'Analyzing'] as const) {
    const props = reportProps('en-US');
    const run: MigrationRunRecord = {
      ...SAMPLE_QTI_MIGRATION_RUN,
      items: [],
      reviewProgress: { total: 0, pending: 0, accepted: 0, rejected: 0 },
      execution: state === 'Queued'
        ? { _tag: state, attempts: 0, maxAttempts: 3, lastFailure: null }
        : {
          _tag: state,
          attempts: 1,
          maxAttempts: 3,
          startedAt: SAMPLE_QTI_MIGRATION_RUN.createdAt,
        },
    };
    const html = renderToString(<MigrationReport run={run} {...props} />);
    expect(html).toContain(props.i18n.t('imports.report.autoUpdates'));
    expect(html).toContain(props.i18n.t('imports.report.checkStatus'));
    if (html.includes(props.i18n.t('imports.report.noQuestions'))) {
      expect.unreachable("Expected !html.includes(props.i18n.t('imports.report.noQuestions'))");
    }
    if (html.includes('assessment-plan-heading')) {
      expect.unreachable("Expected !html.includes('assessment-plan-heading')");
    }
    if (html.includes(props.i18n.t('imports.report.approvalIncomplete'))) {
      expect.unreachable(
        "Expected !html.includes(props.i18n.t('imports.report.approvalIncomplete'))",
      );
    }
  }
});

testCase('assessment plan is a collapsed secondary action when questions are ready', () => {
  const props = reportProps('en-US');
  const html = renderToString(<MigrationReport run={SAMPLE_QTI_MIGRATION_RUN} {...props} />);
  expect(html).toContain(props.i18n.t('imports.report.editPlan'));
  {
    const beforePlan = html.slice(0, html.indexOf('assessment-plan-heading'));
    const disclosure = beforePlan.slice(beforePlan.lastIndexOf('<details'));
    if (!(disclosure.startsWith('<details class='))) {
      expect.unreachable("Expected disclosure.startsWith('<details class=')");
    }
    if (disclosure.split('>')[0].includes('open')) {
      expect.unreachable("Expected !disclosure.split('>')[0].includes('open')");
    }
  }
});
