import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import AccountSettingsPage from '../components/auth/AccountSettingsPage.tsx';
import { accountSettingsRedirect } from '../lib/http/routes/settings_pages/account_settings.tsx';

for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
  testCase(`settings renders locale radios for ${locale}`, () => {
    const html = render(
      <AccountSettingsPage
        i18n={createI18n(locale, catalogForLocale(locale))}
        data={{
          user: { email: 'a@example.test' },
          settings: { theme: 'system', choiceRichText: false, interfaceLocale: locale },
        }}
      />,
    );
    expect((html.match(/name="interfaceLocale"/g) ?? []).length).toStrictEqual(5);
    for (const lang of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE']) {
      expect(html).toContain(`lang="${lang}"`);
    }
    expect(html).toContain(`value="${locale}" checked`);
  });
}

testCase('settings redirect is a 302 with a complete locale cookie', () => {
  const response = accountSettingsRedirect(new URL('https://app.example/settings'), 'es-419');
  expect(response.status).toStrictEqual(302);
  expect(response.headers.get('location')).toStrictEqual('/settings?success=1');
  const cookie = response.headers.get('set-cookie') ?? '';
  expect(cookie).toContain('qflow-locale=es-419');
  expect(cookie).toContain('Path=/');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Secure');
});
