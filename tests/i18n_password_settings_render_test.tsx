import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { PASSWORD_MIN_LENGTH } from '../lib/services/auth_crypto.ts';
import PasswordSettingsPage from '../lib/http/routes/settings_pages/password.tsx';

for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
  testCase(`password settings renders all states for ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const renderPage = (data: Parameters<typeof PasswordSettingsPage>[0]['data']) =>
      render(<PasswordSettingsPage i18n={i18n} data={data} />);
    const normal = renderPage({ success: false, force: false });
    const force = renderPage({ success: false, force: true });
    const success = renderPage({ success: true, force: false });
    const invalid = renderPage({ error: 'invalid_password' });
    const current = renderPage({ error: 'current_password_invalid' });
    expect(normal).toContain(i18n.t('settings.password.title'));
    expect(normal).toContain(i18n.t('settings.password.current'));
    expect(normal).toContain(i18n.t('settings.password.new'));
    expect(normal).toContain(
      i18n.t('settings.password.requirements', { count: PASSWORD_MIN_LENGTH }),
    );
    expect(normal).toContain(i18n.t('settings.password.submit'));
    expect(normal).toContain(i18n.t('settings.password.backToWorkspace'));
    expect(force).toContain(i18n.t('settings.password.forcedNotice'));
    expect(success).toContain(i18n.t('settings.password.updated'));
    expect(invalid).toContain(
      i18n.t('settings.password.error.invalidNew', { count: PASSWORD_MIN_LENGTH }),
    );
    expect(current).toContain(i18n.t('settings.password.error.currentIncorrect'));
    for (const html of [normal, force, success, invalid, current]) {
      if (html.includes('settings.password.')) {
        expect.unreachable("Expected !html.includes('settings.password.')");
      }
    }
  });
}

testCase('password settings copy differs between English and Spanish', () => {
  const page = (locale: 'en-US' | 'es-ES') => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    return render(<PasswordSettingsPage i18n={i18n} data={{ success: true, force: false }} />);
  };
  if (!(page('en-US') !== page('es-ES'))) {
    expect.unreachable("Expected page('en-US') !== page('es-ES')");
  }
});
