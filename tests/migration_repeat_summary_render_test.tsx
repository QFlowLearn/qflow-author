import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { MigrationRepeatSummary } from '../components/imports/migration_repeat_summary.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';

testCase(
  'repeat summary distinguishes extra copies, coverage and bounded details in all five locales',
  () => {
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      const html = render(
        <MigrationRepeatSummary
          runId='run'
          i18n={i18n}
          summary={{
            total: 131,
            compared: 129,
            repeats: 27,
            limited: true,
            groups: [{ count: 8, members: [{ id: 'a', position: 1 }, { id: 'b', position: 101 }] }],
          }}
        />,
      );
      expect(html).toContain(i18n.t('imports.repeats.compared', { compared: 129, total: 131 }));
      expect(html).toContain(i18n.t('imports.repeats.count', { count: 27 }));
      expect(html).toContain(i18n.t('imports.repeats.moreCopies', { count: 6 }));
      expect(html).toContain(i18n.t('imports.repeats.limited'));
      expect(html).toContain('/imports/run?page=3#item-b');
      expect(html).toContain('/imports/run?download=qa-report');
      expect(html).not.toMatch(/imports\.repeats\.|<summary[^>]*>\s*<h/);
    }
  },
);

testCase('uncompared imports do not claim zero repeats or show a download action', () => {
  const i18n = createI18n('en-US', catalogForLocale('en-US'));
  const html = render(
    <MigrationRepeatSummary
      runId='run'
      i18n={i18n}
      summary={{ total: 10, compared: 0, repeats: 0, limited: false, groups: [] }}
    />,
  );
  expect(html).toContain('Compared 0 of 10 questions');
  expect(html).not.toMatch(/0 extra copies|download=qa-report/);
});
