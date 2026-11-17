import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import ImportsIndex, { parseImportFeedback } from '../lib/http/routes/import_pages/list.tsx';
import { run } from './helpers/imports_queue_fixture.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'];
const expectedDates: Record<InterfaceLocale, string> = {
  'sv-SE': '26 apr. 2026 20:00',
  'en-US': 'Apr 26, 2026, 8:00 PM',
  'en-GB': '26 Apr 2026, 20:00',
  'es-ES': '26 abr 2026, 20:00',
  'es-419': '26 abr 2026, 8:00 p.m.',
};

testCase('imports index renders every queue state and localized matrix', () => {
  const runs = [
    run({ id: 'queued-run', filename: '<img src=x onerror=secret>', status: 'queued' }),
    run({ id: 'analyzing-run', filename: 'analyzing.zip', status: 'analyzing' }),
    run({ id: 'ready-run', filename: 'ready.zip', status: 'analyzed' }),
    run({ id: 'review-needed-run', filename: 'review-needed.zip', status: 'needs_review' }),
    run({ id: 'review-run', filename: 'review.zip', status: 'failed' }),
    run({ id: 'failed-run', filename: 'failed.zip', status: 'failed' }),
    run({ id: 'committed-run', filename: 'committed.zip', status: 'committed' }),
  ];
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = renderToString(
      <ImportsIndex
        runs={runs}
        allRuns={runs}
        status=''
        queueCount={2}
        retryError={null}
        i18n={i18n}
      />,
    );
    for (const id of ['queued', 'analyzing', 'ready', 'needsReview', 'failed', 'committed']) {
      expect(html).toContain(i18n.t(`imports.status.${id}`));
    }
    expect(html).toContain(i18n.t('imports.queue', { count: 2 }));
    const singular = renderToString(
      <ImportsIndex
        runs={runs}
        allRuns={runs}
        status=''
        queueCount={1}
        retryError={null}
        i18n={i18n}
      />,
    );
    expect(singular).toContain(i18n.t('imports.queue', { count: 1 }));
    expect(html.replaceAll(/<[^>]*>/g, '')).toContain(i18n.t('imports.run.summary', {
      items: 3,
      warnings: 0,
      date: expectedDates[locale],
    }));
    expect(html).toContain('assessment-sentinel');
    expect(html).toContain('name="action" value="retry"');
    if (!(html.includes('&lt;img'))) expect.unreachable("Expected html.includes('&lt;img')");
    if (html.includes('<img src=x')) {
      expect.unreachable("Expected !html.includes('<img src=x')");
    }
    expect(html).toContain(expectedDates[locale]);
    if (html.includes('imports.')) expect.unreachable("Expected !html.includes('imports.')");
    if (locale === 'en-US') {
      if (!(html.includes('Analyzing') && !html.includes('Analysing'))) {
        expect.unreachable("Expected html.includes('Analyzing') && !html.includes('Analysing')");
      }
    }
    if (locale === 'en-GB') {
      if (!(html.includes('Analysing') && !html.includes('Analyzing'))) {
        expect.unreachable("Expected html.includes('Analysing') && !html.includes('Analyzing')");
      }
    }
    if (locale.startsWith('es-')) {
      for (
        const phrase of [
          'Import runs',
          'Apply filter',
          'View report',
          'Open assessment',
          'Retry',
          'Needs review',
          'No imports yet',
        ]
      ) if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
    }
    const invalid = run({ id: 'invalid-date', filename: 'invalid.zip', status: 'queued' });
    const invalidHtml = renderToString(
      <ImportsIndex
        runs={[{ ...invalid, createdAt: 'not-a-date' }]}
        allRuns={[]}
        status=''
        queueCount={0}
        retryError={null}
        i18n={i18n}
      />,
    );
    expect(invalidHtml).toContain(i18n.t('imports.unavailableDate'));
  }
});

testCase('imports index empty and filtered states and feedback parser are closed', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const empty = renderToString(
      <ImportsIndex
        runs={[]}
        allRuns={[]}
        status=''
        queueCount={0}
        retryError={null}
        i18n={i18n}
      />,
    );
    expect(empty).toContain(i18n.t('imports.empty.title'));
    expect(empty).toContain(i18n.t('imports.empty.body'));
    const filtered = renderToString(
      <ImportsIndex
        runs={[]}
        allRuns={[run({ id: 'x', filename: 'x.zip', status: 'queued' })]}
        status='failed'
        queueCount={0}
        retryError='retry_failed'
        i18n={i18n}
      />,
    );
    expect(filtered).toContain(i18n.t('imports.empty.filteredTitle'));
    expect(filtered).toContain(i18n.t('imports.empty.filteredBody'));
    expect(filtered).toContain(i18n.t('imports.retryFailed'));
  }
  expect(parseImportFeedback('retry_failed')).toStrictEqual('retry_failed');
  expect(parseImportFeedback('retry_failed:hostile')).toStrictEqual(null);
  expect(parseImportFeedback('<script>')).toStrictEqual(null);
  expect(parseImportFeedback(null)).toStrictEqual(null);
  expect(parseImportFeedback('')).toStrictEqual(null);
});
