import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import Header from '../components/Header.tsx';
import AssessmentActionsMenu from '../islands/AssessmentActionsMenu.tsx';
import {
  formatDeliveryPublishError as formatBuilderDeliveryError,
  formatDeliveryPublishSuccess,
  formatDeliveryWarningConfirmation as formatBuilderDeliveryWarning,
} from '../islands/assessment_builder/assessment_delivery.ts';
import AssessmentsIndex from '../lib/http/routes/assessment_pages/list.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

const testI18n = createI18n('en-US', catalogForLocale('en-US'));
const testCatalog = catalogForLocale('en-US');

testCase('assessment dashboard exposes one new-assessment entry point', () => {
  const html = renderToString(
    <>
      <Header
        showAccountMenu
        currentPath='/assessments'
        i18n={testI18n}
        payload={{ locale: 'en-US', namespaces: { core: catalogForLocale('en-US').core! } }}
      />
      <AssessmentsIndex
        rows={[
          {
            id: 'assessment-1',
            title: 'Unit 1 Benchmark',
            updatedAt: '2026-05-01T12:00:00.000Z',
            createdAt: '2026-04-30T12:00:00.000Z',
            partsCount: 1,
            itemsCount: 8,
            brief: 'Ratios and geometry',
            delivery: null,
          },
        ]}
        q=''
        tags=''
        sort='updated'
        i18n={testI18n}
        catalog={testCatalog}
      />
    </>,
  );

  expect(html).toContain('Authoring Dashboard');
  expect(html).toContain('Bring your files');
  expect(html).toContain('href="/assessments/new"');
  expect(html).toContain('New blank assessment');
  if (html.includes('href="/demo/presidents"')) {
    expect.unreachable('Expected !html.includes(\'href="/demo/presidents"\')');
  }
  if (html.includes(testI18n.t('list.exploreSample'))) {
    expect.unreachable("Expected !html.includes(testI18n.t('list.exploreSample'))");
  }
  expect(countOccurrences(html, '<form method="post" action="/assessments/new">')).toStrictEqual(1);
  if (html.includes('Quick Starts')) {
    expect.unreachable("Expected !html.includes('Quick Starts')");
  }
  if (html.includes('Create Assessment')) {
    expect.unreachable("Expected !html.includes('Create Assessment')");
  }
  if (html.includes('Recent Content Activity')) {
    expect.unreachable("Expected !html.includes('Recent Content Activity')");
  }
  expect(countOccurrences(html, 'Unit 1 Benchmark')).toStrictEqual(1);
});

testCase('assessment table renders localized catalogs across all supported locales', () => {
  const headers = [
    'assessment',
    'items',
    'parts',
    'updated',
    'created',
    'actions',
  ] as const;
  const sortableHeaders = headers.slice(0, 5);
  const outputs = (['en-US', 'en-GB', 'es-ES', 'es-419'] as const).map((locale) => {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, catalog);
    const rows = [
      {
        id: 'a',
        title: 'Authored title',
        brief: 'Authored brief',
        itemsCount: 1000,
        partsCount: 2,
        updatedAt: 'invalid',
        createdAt: undefined,
        delivery: { publishedAt: '2026-01-02T03:04:00.000Z', assessmentVersionId: 'v1' },
      },
      {
        id: 'b',
        title: 'Second authored title',
        brief: 'Second authored brief',
        itemsCount: 1,
        partsCount: 1,
        updatedAt: '2026-01-02T03:04:00.000Z',
        createdAt: undefined,
        delivery: null,
      },
    ];
    return renderToString(
      <AssessmentsIndex
        rows={rows}
        q=''
        tags=''
        sort='updated'
        i18n={i18n}
        catalog={catalog}
      />,
    );
  });
  for (const [index, html] of outputs.entries()) {
    const locale = (['en-US', 'en-GB', 'es-ES', 'es-419'] as const)[index];
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const header of headers) {
      const text = i18n.t(`list.table.headers.${header}`);
      expect(html).toContain(text);
    }
    for (const header of sortableHeaders) {
      const text = i18n.t(`list.table.headers.${header}`);
      expect(html).toContain(i18n.t('list.table.sortBy', { column: text }));
    }
    expect(html).toContain(i18n.t('list.table.mobile.items', { count: 1 }));
    expect(html).toContain(i18n.t('list.table.mobile.items', { count: 1000 }));
    expect(html).toContain(i18n.t('list.table.mobile.parts', { count: 1 }));
    expect(html).toContain(i18n.t('list.table.mobile.parts', { count: 2 }));
    const unavailable = i18n.t('list.table.unavailable');
    expect(html).toContain(i18n.t('list.table.mobile.updated', { date: unavailable }));
    const validDate = i18n.formatDate(new Date('2026-01-02T03:04:00.000Z'));
    expect(html).toContain(validDate);
    expect(html).toContain(i18n.formatNumber(1000));
    expect(html).toContain(i18n.t('list.table.published'));
    expect(html).toContain(i18n.t('list.table.edit'));
    expect(html).toContain(unavailable);
    for (
      const authored of [
        'Authored title',
        'Authored brief',
        'Second authored title',
        'Second authored brief',
        'v1',
      ]
    ) {
      expect(html).toContain(authored);
    }
    if (html.includes('list.')) expect.unreachable("Expected !html.includes('list.')");
  }
  expect(outputs[0] !== outputs[2]).toStrictEqual(true);
  expect(outputs[0] !== outputs[3]).toStrictEqual(true);
});

testCase('assessment list renders localized filtered and unfiltered empty states', () => {
  const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
  for (const locale of locales) {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, catalog);
    const common = { rows: [], tags: '', sort: 'updated', i18n, catalog };
    const empty = renderToString(<AssessmentsIndex {...common} q='' />);
    expect(empty).toContain(i18n.t('list.empty.title'));
    expect(empty).toContain(i18n.t('list.empty.unfilteredBody'));
    if (empty.includes(i18n.t('list.empty.filteredBody'))) {
      expect.unreachable("Expected !empty.includes(i18n.t('list.empty.filteredBody'))");
    }
    if (empty.includes(i18n.t('list.filters.clear'))) {
      expect.unreachable("Expected !empty.includes(i18n.t('list.filters.clear'))");
    }
    expect(empty).toContain('href="/demo/presidents"');
    expect(empty).toContain(i18n.t('list.exploreSample'));
    if (!(empty.indexOf('href="/demo/presidents"') < empty.indexOf('href="/assessments/new"'))) {
      expect.unreachable(
        'Expected empty.indexOf(\'href="/demo/presidents"\') < empty.indexOf(\'href="/assessments/new"\')',
      );
    }

    const filtered = renderToString(<AssessmentsIndex {...common} q='missing' />);
    expect(filtered).toContain(i18n.t('list.empty.title'));
    expect(filtered).toContain(i18n.t('list.empty.filteredBody'));
    expect(filtered).toContain(i18n.t('list.filters.clear'));
    if (filtered.includes('href="/demo/presidents"')) {
      expect.unreachable('Expected !filtered.includes(\'href="/demo/presidents"\')');
    }
    if (filtered.includes(i18n.t('list.exploreSample'))) {
      expect.unreachable("Expected !filtered.includes(i18n.t('list.exploreSample'))");
    }
    if (filtered.includes(i18n.t('list.empty.unfilteredBody'))) {
      expect.unreachable("Expected !filtered.includes(i18n.t('list.empty.unfilteredBody'))");
    }
    if (filtered.includes('list.')) expect.unreachable("Expected !filtered.includes('list.')");
  }
});

testCase('assessment dashboard keeps the single primary create path when empty', () => {
  const html = renderToString(
    <AssessmentsIndex
      rows={[]}
      q=''
      tags=''
      sort='updated'
      i18n={testI18n}
      catalog={testCatalog}
    />,
  );

  expect(countOccurrences(html, '<form method="post" action="/assessments/new">')).toStrictEqual(1);
  expect(html).toContain('No assessments found');
});

testCase('header does not repeat create action on assessment entry screens', () => {
  const dashboardHeader = renderToString(
    <Header
      showAccountMenu
      currentPath='/assessments'
      i18n={testI18n}
      payload={{ locale: 'en-US', namespaces: { core: catalogForLocale('en-US').core! } }}
    />,
  );
  const newAssessmentHeader = renderToString(
    <Header
      showAccountMenu
      currentPath='/assessments/new'
      i18n={testI18n}
      payload={{ locale: 'en-US', namespaces: { core: catalogForLocale('en-US').core! } }}
    />,
  );
  const libraryHeader = renderToString(
    <Header
      showAccountMenu
      currentPath='/items'
      i18n={testI18n}
      payload={{ locale: 'en-US', namespaces: { core: catalogForLocale('en-US').core! } }}
    />,
  );

  if (dashboardHeader.includes('Create New')) {
    expect.unreachable("Expected !dashboardHeader.includes('Create New')");
  }
  if (newAssessmentHeader.includes('Create New')) {
    expect.unreachable("Expected !newAssessmentHeader.includes('Create New')");
  }
  if (dashboardHeader.includes('action="/assessments/new"')) {
    expect.unreachable('Expected !dashboardHeader.includes(\'action="/assessments/new"\')');
  }
  if (newAssessmentHeader.includes('action="/assessments/new"')) {
    expect.unreachable('Expected !newAssessmentHeader.includes(\'action="/assessments/new"\')');
  }
  expect(libraryHeader).toContain('action="/assessments/new"');
  expect(libraryHeader).toContain('Create New');
});

testCase('releases stay within Question bank navigation', () => {
  const html = renderToString(
    <Header
      showAccountMenu
      currentPath='/releases/edition-1'
      i18n={testI18n}
      payload={{ locale: 'en-US', namespaces: { core: catalogForLocale('en-US').core! } }}
    />,
  );

  if (html.includes('href="/releases"')) {
    expect.unreachable('Expected !html.includes(\'href="/releases"\')');
  }
  expect(html).toContain('href="/items" aria-current="page"');
});

testCase('assessment actions menu is not an overflow-container dropdown', () => {
  const html = renderToString(
    <AssessmentActionsMenu
      assessmentId='assessment-1'
      assessmentTitle='Unit 1 Benchmark'
      payload={{ locale: 'en-US', namespaces: { assessments: testCatalog.assessments! } }}
    />,
  );

  expect(html).toContain('aria-haspopup="menu"');
  if (html.includes('ds-dropdown')) {
    expect.unreachable("Expected !html.includes('ds-dropdown')");
  }
  if (html.includes('ds-dropdown-content')) {
    expect.unreachable("Expected !html.includes('ds-dropdown-content')");
  }
});

testCase('assessment actions menu routes export through destination preflight', () => {
  const html = renderToString(
    <AssessmentActionsMenu
      assessmentId='assessment-1'
      assessmentTitle='Unit 1 Benchmark'
      payload={{ locale: 'en-US', namespaces: { assessments: testCatalog.assessments! } }}
    />,
  );

  if (html.includes('/api/assessments/assessment-1/package')) {
    expect.unreachable("Expected !html.includes('/api/assessments/assessment-1/package')");
  }
  if (html.includes('#assessment-export')) {
    expect.unreachable("Expected !html.includes('#assessment-export')");
  }
});

testCase('assessment actions trigger uses the selected locale', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const catalog = catalogForLocale(locale);
    const html = renderToString(
      <AssessmentActionsMenu
        assessmentId='assessment-1'
        assessmentTitle='Unit 1 Benchmark'
        payload={{ locale, namespaces: { assessments: catalog.assessments! } }}
      />,
    );
    expect(html).toContain(`aria-label="${createI18n(locale, catalog).t('list.actions.trigger')}"`);
    if (html.includes('list.actions.')) {
      expect.unreachable("Expected !html.includes('list.actions.')");
    }
  }
});

testCase('assessment delivery alerts and warnings use localized action messages', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const warning = formatBuilderDeliveryWarning(i18n, [
      'qti3_conformance.not_run',
      'vendor.warning.code',
    ]);
    expect(warning).toContain(i18n.t('list.actions.warning.intro'));
    expect(warning).toContain(i18n.t('list.actions.warning.automatedQti'));
    expect(warning).toContain(
      i18n.t('list.actions.warning.genericExport', { code: 'vendor.warning.code' }),
    );
    expect(warning).toContain(i18n.t('list.actions.warning.finalConfirmation'));
    expect(warning).toContain('vendor.warning.code');
    expect(formatDeliveryPublishSuccess(i18n)).toStrictEqual(
      i18n.t('list.actions.publish.success'),
    );
    expect(formatDeliveryPublishSuccess(i18n, 'version-7')).toStrictEqual(
      i18n.t('list.actions.publish.successVersion', { version: 'version-7' }),
    );
    for (const reason of ['publishFailed', 'invalidResponse', 'invalidApproval'] as const) {
      const result = formatBuilderDeliveryError(i18n, {
        message: 'Server-authored detail',
        qflowTenantId: 'tenant-7',
      }, reason);
      if (result.includes('Server-authored detail')) {
        expect.unreachable("Expected !result.includes('Server-authored detail')");
      }
      expect(result).toContain('tenant-7');
      if (result.includes('list.')) expect.unreachable("Expected !result.includes('list.')");
    }
  }
});

testCase('assessment builder delivery formatter localizes closed failures', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const warning = formatBuilderDeliveryWarning(i18n, ['unknown.warning']);
    expect(warning).toContain(
      i18n.t('list.actions.warning.genericExport', { code: 'unknown.warning' }),
    );
    for (const reason of ['publishFailed', 'invalidResponse', 'invalidApproval'] as const) {
      const message = formatBuilderDeliveryError(i18n, {
        message: 'Server-authored message',
        setupHint: 'Server-authored setup hint',
        qflowTenantId: 'tenant-42',
      }, reason);
      if (message.includes('Server-authored message')) {
        expect.unreachable("Expected !message.includes('Server-authored message')");
      }
      if (message.includes('Server-authored setup hint')) {
        expect.unreachable("Expected !message.includes('Server-authored setup hint')");
      }
      expect(message).toContain('tenant-42');
      if (message.includes(reason)) expect.unreachable('Expected !message.includes(reason)');
      if (message.includes('list.')) expect.unreachable("Expected !message.includes('list.')");
    }
  }
});

function countOccurrences(value: string, search: string) {
  return value.split(search).length - 1;
}
