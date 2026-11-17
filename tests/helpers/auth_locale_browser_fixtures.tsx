import { expect } from 'vitest';

import { createI18n } from '../../lib/i18n/messages.ts';
import LoginPage from '../../components/auth/LoginPage.tsx';
import SignupPage from '../../lib/http/routes/auth_pages/signup.tsx';
import ForgotPasswordPage from '../../components/auth/ForgotPasswordPage.tsx';
import ResetPasswordPage from '../../components/auth/ResetPasswordPage.tsx';
import AccountSettingsPage from '../../components/auth/AccountSettingsPage.tsx';
import type { LoginPageData } from '../../lib/services/browser_login.ts';
import type { UserSettings } from '../../lib/settings.ts';

export const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
export type Locale = (typeof locales)[number];

export function assertLocalizedSurface(body: string, locale: Locale): void {
  for (const prefix of ['login.', 'signup.', 'forgot.', 'reset.', 'locale.', 'settings.']) {
    expect(body.includes(prefix)).toStrictEqual(false);
  }
  expect(/\{(?:[a-zA-Z#]|count)/.test(body)).toStrictEqual(false);
  if (locale.startsWith('es-') || locale === 'sv-SE') {
    for (const phrase of ['Sign in', 'Create account', 'Forgot password', 'Save changes']) {
      expect(body.includes(phrase)).toStrictEqual(false);
    }
  }
}

export async function assertBrowserErrors(
  page: { evaluate: (fn: () => unknown) => Promise<unknown> },
  errors: readonly string[],
  allowed: RegExp | null = null,
): Promise<void> {
  expect(errors.filter((error) => allowed === null || !allowed.test(error))).toStrictEqual([]);
  expect(
    await page.evaluate(() => {
      return (globalThis as typeof globalThis & { __AUTH_BROWSER_ERRORS__?: string[] })
        .__AUTH_BROWSER_ERRORS__ ?? [];
    }),
  ).toStrictEqual([]);
}

export const accounts: Record<string, UserSettings> = {
  'account-a': { theme: 'wireframe', choiceRichText: false, interfaceLocale: 'es-ES' },
  'account-b': { theme: 'dark', choiceRichText: true, interfaceLocale: 'en-GB' },
};
export const persistedAccountValues: Record<string, unknown> = {
  ...accounts,
  'account-invalid': { theme: 'system' },
};

function loginData(
  next: string | null,
  oidcProviders: LoginPageData['oidcProviders'] = [],
): LoginPageData {
  return {
    error: null,
    errorField: null,
    oidcProviders,
    loginPolicy: 'allow_password',
    signInUnavailable: false,
    email: '',
    next,
  };
}

export function pageContent(
  path: string,
  locale: Locale,
  i18n: ReturnType<typeof createI18n>,
  next: string | null,
  account?: string,
  success = false,
  resetState: 'form' | 'invalid_link' | 'success' = 'form',
  provider = false,
) {
  if (path === '/login') {
    return (
      <LoginPage
        data={loginData(next, provider ? [{ id: 'microsoft', label: '<Campus Ω>' }] : [])}
        i18n={i18n}
      />
    );
  }
  if (path === '/assessments/new') {
    return (
      <main>
        <h1>{i18n.t('login.title')}</h1>
      </main>
    );
  }
  if (path === '/signup') return <SignupPage data={{ next }} i18n={i18n} locale={locale} />;
  if (path === '/password/forgot') {
    return <ForgotPasswordPage data={{}} i18n={i18n} />;
  }
  if (path === '/password/reset') {
    return (
      <ResetPasswordPage
        data={resetState === 'form'
          ? { state: 'form', token: 'safe-token' }
          : { state: resetState }}
        i18n={i18n}
      />
    );
  }
  const settings = accounts[account ?? 'account-a'] ?? accounts['account-a'];
  return (
    <AccountSettingsPage
      i18n={i18n}
      data={{ user: { email: 'ana+✨@example.test', displayName: '<Ana ✨>' }, settings, success }}
    />
  );
}
