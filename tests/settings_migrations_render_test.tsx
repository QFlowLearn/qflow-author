import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import MigrationAdminPage from '../lib/http/routes/settings_pages/migrations.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

const i18n = createI18n('en-US', catalogForLocale('en-US'));

testCase('migration dashboard renders its empty state from the current schema', () => {
  const html = renderToString(
    <MigrationAdminPage
      runs={[]}
      status=''
      readiness=''
      review=''
      q=''
      stats={{
        total: 0,
        queued: 0,
        analyzing: 0,
        committed: 0,
        failed: 0,
        accepted: 0,
        pending: 0,
        rejected: 0,
        items: 0,
        warnings: 0,
        blocked: 0,
      }}
      i18n={i18n}
    />,
  );

  expect(html).toContain('Import analytics');
  expect(html).toContain('Run status');
  expect(html).toContain('Review workload');
  expect(html).toContain('No import runs match these filters.');
});
