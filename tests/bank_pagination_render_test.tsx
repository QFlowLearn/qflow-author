import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { BankPagination } from '../components/item_bank/BankPagination.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { CATALOGS } from '../lib/i18n/catalogs.ts';

testCase('bank pagination keeps navigation bounded and retains filters in the jump form', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    const html = render(
      <BankPagination
        page={2}
        pageCount={313}
        pageHref={(page) =>
          `/items?collection=unfiled&sort=title&direction=desc&q=science&page=${page}`}
        position='top'
        i18n={i18n}
      />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain('>313</a>');
    if (html.includes('>312</a>')) expect.unreachable("Expected !html.includes('>312</a>')");
    expect(html).toContain('name="collection" value="unfiled"');
    expect(html).toContain('name="sort" value="title"');
    expect(html).toContain('name="direction" value="desc"');
    expect(html).toContain('name="q" value="science"');
    expect(html).toContain('max="313"');
    expect(html).toContain(i18n.t('items.results.goToPage'));
  }
});
