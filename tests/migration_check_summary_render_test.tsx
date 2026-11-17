import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { MigrationCheckSummary } from '../components/imports/migration_check_summary.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';

testCase(
  'answer/media summary explains source scope, overlapping groups and separate package findings in five locales',
  () => {
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      const html = render(
        <MigrationCheckSummary
          runId='run'
          i18n={i18n}
          summary={{
            affected: 61,
            groups: [
              {
                kind: 'answers',
                count: 61,
                packageFindings: 0,
                members: [{ id: 'last', position: 121 }],
              },
              { kind: 'references', count: 0, packageFindings: 0, members: [] },
              {
                kind: 'media',
                count: 1,
                packageFindings: 2,
                members: [{ id: 'last', position: 121 }],
              },
            ],
          }}
        />,
      );
      expect(html).toContain(i18n.t('imports.checks.affected', { count: 61 }));
      expect(html).toContain(i18n.t('imports.checks.packageFindings', { count: 2 }));
      expect(html).toContain(i18n.t('imports.checks.scope'));
      expect(html).toContain(i18n.t('imports.checks.more', { count: 60 }));
      expect(html).toContain('/imports/run?page=3#item-last');
      expect(html).toContain('/imports/run?download=qa-report');
      expect(html).not.toMatch(/imports\.checks\.|<summary[^>]*>\s*<h/);
    }
  },
);

testCase('empty checks describe recorded findings rather than claiming all questions valid', () => {
  const i18n = createI18n('en-US', catalogForLocale('en-US'));
  const html = render(
    <MigrationCheckSummary runId='run' i18n={i18n} summary={{ affected: 0, groups: [] }} />,
  );
  expect(html).toContain('0 questions with findings');
  expect(html).toContain('Findings recorded during import.');
  expect(html).not.toMatch(/download=qa-report|All questions are valid/);
});
