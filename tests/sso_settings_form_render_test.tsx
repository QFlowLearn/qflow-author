import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import SsoSettingsForm from '../islands/SsoSettingsForm.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

testCase('SSO settings island composes focused OIDC and login-policy forms', () => {
  const html = renderToString(
    <SsoSettingsForm
      payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['settings'])}
    />,
  );

  expect(html).toContain('OIDC providers');
  expect(html).toContain('Login policy');
  expect(html).toContain('Domain routes');
  expect(html).toContain('Save OIDC settings');
  expect(html).toContain('Save login policy');
  expect(html.match(/<form(?:\s|>)/g)?.length).toStrictEqual(2);
});
