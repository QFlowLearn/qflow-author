import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import MigrationReportPage from '../components/imports/migration_report_page.tsx';
import { SourceEvidencePanel } from '../components/imports/migration_source_evidence.tsx';
import { SAMPLE_QTI_MIGRATION_RUN } from '../lib/sample_migration_report.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { buildPackageIndexDocument } from '../lib/conversion/extract_package_source.ts';
import type { MigrationRunRecord } from '../lib/import/migration_types.ts';

testCase('filtered review localizes selection and empty state in all five locales', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, catalog);
    const props = {
      i18n,
      payload: createI18nPayload(locale, catalog, ['authoring', 'imports']),
      playerCatalog: playerMessageCatalogForLocale(locale),
    };
    const run: MigrationRunRecord = {
      ...SAMPLE_QTI_MIGRATION_RUN,
      destination: { _tag: 'WorkspaceBank', collectionId: null },
      items: [],
    };
    const html = render(
      <MigrationReportPage
        {...props}
        run={run}
        pagination={{
          page: 1,
          pageSize: 50,
          total: 0,
          totalItems: 121,
          blocked: 0,
          filter: 'blocked',
        }}
      />,
    );
    expect(html).toContain(i18n.t('imports.report.allQuestionsCount', { count: 121 }));
    expect(html).toContain(i18n.t('imports.report.needsFixesCount', { count: 0 }));
    expect(html).toContain(i18n.t('imports.report.noBlockedQuestions'));
    expect(html).toContain('aria-current="page"');
    expect(html).not.toMatch(/imports\.report\.|name="bulkAction"/);
  }
});

testCase(
  'filtered review keeps editor and page links scoped and source index matches visible positions',
  () => {
    const catalog = catalogForLocale('en-US'), i18n = createI18n('en-US', catalog);
    const artifact = SAMPLE_QTI_MIGRATION_RUN.artifacts[0];
    if (!artifact) expect.unreachable('Expected artifact');
    const run: MigrationRunRecord = {
      ...SAMPLE_QTI_MIGRATION_RUN,
      items: [{ ...SAMPLE_QTI_MIGRATION_RUN.items[0], position: 111, createdQuestionId: null }],
      destination: { _tag: 'WorkspaceBank', collectionId: null },
      artifacts: [{
        ...artifact,
        kind: 'normalized',
        document: buildPackageIndexDocument({
          title: 'Bank',
          entries: Array.from(
            { length: 121 },
            (_, i) => ({ href: `question-${i + 1}.xml`, title: `Question ${i + 1}` }),
          ),
        }),
      }],
    };
    const props = {
      i18n,
      payload: createI18nPayload('en-US', catalog, ['authoring', 'imports']),
      playerCatalog: playerMessageCatalogForLocale('en-US'),
    };
    const html = render(
      <MigrationReportPage
        {...props}
        run={run}
        pagination={{
          page: 2,
          pageSize: 50,
          total: 61,
          totalItems: 121,
          blocked: 61,
          filter: 'blocked',
        }}
      />,
    );
    expect(html).toContain('Page 2 of 2');
    expect(html).toContain(`page=2&amp;review=blocked&amp;edit=${run.items[0].id}`);
    expect(html).toContain('page=1&amp;review=blocked');
    const evidence = render(<SourceEvidencePanel run={run} i18n={i18n} paged />);
    expect(evidence).toContain('id="source-package-entry-111"');
    expect(evidence).not.toMatch(/id="source-package-entry-(1|51|110|112)"/);
  },
);
