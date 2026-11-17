import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import LoginPage from '../components/auth/LoginPage.tsx';
import type { LoginPageData } from '../lib/services/browser_login.ts';
import SignupPage from '../lib/http/routes/auth_pages/signup.tsx';
import ForgotPasswordPage from '../components/auth/ForgotPasswordPage.tsx';
import ResetPasswordPage from '../components/auth/ResetPasswordPage.tsx';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;

testCase('auth pages render localized headings with the locale chooser on signup', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const common = { i18n, locale };
    const login = render(
      <LoginPage
        {...common}
        data={{
          error: null,
          errorField: null,
          oidcProviders: [],
          loginPolicy: 'allow_password',
          signInUnavailable: false,
          email: '',
          next: null,
        }}
      />,
    );
    const signup = render(<SignupPage {...common} data={{ next: '/assessments/new' }} />);
    const forgot = render(<ForgotPasswordPage {...common} data={{}} />);
    const reset = render(<ResetPasswordPage {...common} data={{ state: 'invalid_link' }} />);
    for (const html of [login, forgot, reset]) {
      expect(html).not.toContain('action="/api/locale"');
    }
    expect(signup).toContain('action="/api/locale"');
    expect(signup).toContain('lang="es-ES"');
    expect(signup).toContain('lang="es-419"');
    expect(signup).toContain('lang="sv-SE"');
    expect(signup).toContain('Svenska');
    expect(login).toContain(i18n.t('login.title'));
    expect(signup).toContain(i18n.t('signup.title'));
    expect(forgot).toContain(i18n.t('forgot.title'));
    expect(reset).toContain(i18n.t('reset.title'));
  }
});

const errorMessages = {
  credentials_invalid: 'login.invalidCredentials',
  email_invalid: 'signup.invalidEmail',
  email_required: 'login.error.emailRequired',
  too_many_attempts: 'login.error.tooManyAttempts',
  workspace_unassigned: 'login.error.workspaceUnassigned',
  workspace_mismatch: 'login.error.workspaceMismatch',
  account_workspace_mismatch: 'login.error.workspaceMismatch',
  workspace_address_required: 'login.error.workspaceAddressRequired',
  password_disabled: 'login.passwordDisabled',
  provider_not_configured: 'login.error.providerNotConfigured',
  authorization_failed: 'login.error.providerDeniedOrIncomplete',
  missing_authorization_response: 'login.error.providerDeniedOrIncomplete',
  login_state_expired: 'login.error.stateExpired',
  identity_conflict: 'login.error.identityConflict',
  identity_verification_failed: 'login.error.identityVerificationFailed',
  token_exchange_failed: 'login.error.tokenExchangeFailed',
  account_creation_failed: 'login.error.accountCreationFailed',
  sign_in_unavailable: 'login.error.unavailable',
} satisfies Readonly<Record<Exclude<LoginPageData['error'], null>, string>>;

testCase('every login error code renders localized production copy', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const [code, id] of Object.entries(errorMessages)) {
      const html = render(
        <LoginPage
          i18n={i18n}
          data={{
            error: code as LoginPageData['error'],
            errorField: 'form',
            oidcProviders: [],
            loginPolicy: 'allow_password',
            signInUnavailable: false,
            email: '',
            next: null,
          }}
        />,
      );
      expect(html).toContain(i18n.t(id));
      if (html.includes('login.error.')) throw new Error(`Raw ID for ${code}`);
    }
  }
});
