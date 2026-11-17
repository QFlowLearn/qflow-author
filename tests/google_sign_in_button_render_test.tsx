import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import GoogleSignInButton from '../components/ui/GoogleSignInButton.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

testCase('google sign-in button renders required localized text and destination', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['auth']);
    const text = createI18n(locale, payload.namespaces).t('login.google');
    const html = renderToString(
      <GoogleSignInButton href='/auth/oidc/google?next=%2Fassessments' text={text} />,
    );

    expect(html).toContain(text);
    expect(html).toContain(`aria-label="${text}"`);
    expect(html.includes('href="/auth/oidc/google?next=%2Fassessments"')).toStrictEqual(true);
    expect(html.includes('fill="#4285F4"')).toStrictEqual(true);
    expect(html.includes('google-sign-in-button')).toStrictEqual(true);
    expect(html.includes('style=')).toStrictEqual(false);
  }
});
