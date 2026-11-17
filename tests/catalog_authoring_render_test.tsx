import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import CatalogAuthoring from '../islands/CatalogAuthoring.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);

testCase('catalog authoring renders dedicated creation actions and stylesheet controls', () => {
  const html = renderToString(
    <I18nProvider payload={payload}>
      <CatalogAuthoring
        catalogs={[]}
        stylesheets={[{ href: '/uploads/item-css', type: 'text/css' }]}
        onCatalogsChange={() => {}}
        onStylesheetsChange={() => {}}
      />
    </I18nProvider>,
  );

  expect(html).toContain('Add glossary definition');
  expect(html).toContain('Add keyword translations');
  expect(html).toContain('Add custom support');
  expect(html).toContain('Item stylesheets');
  expect(html).toContain('/uploads/item-css');
  expect(html).toContain('External URLs are blocked at publication');
});
