import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import ImportsIndex from '../lib/http/routes/import_pages/list.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

testCase('imports index empty state renders localized copy in every locale', () => {
  const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = renderToString(
      <ImportsIndex
        runs={[]}
        allRuns={[]}
        status=''
        queueCount={0}
        retryError={null}
        i18n={i18n}
      />,
    );
    expect(html).toContain(i18n.t('imports.title'));
    expect(html).toContain(i18n.t('imports.empty.title'));
    expect(html).toContain(i18n.t('imports.empty.body'));
    expect(html).toContain(i18n.t('imports.bringFiles'));
    if (html.includes('imports.')) expect.unreachable("Expected !html.includes('imports.')");
    if (locale.startsWith('es-')) {
      if (html.includes('Import runs')) {
        expect.unreachable("Expected !html.includes('Import runs')");
      }
    }
  }
});
