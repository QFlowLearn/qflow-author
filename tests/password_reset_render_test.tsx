import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import ForgotPasswordPage from '../components/auth/ForgotPasswordPage.tsx';
import { resetPasswordRoute as resetPasswordHandlerEndpoint } from '../lib/http/routes/auth_pages/reset_password.tsx';
import ResetPasswordPage from '../components/auth/ResetPasswordPage.tsx';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const resetPasswordHandler = resetPasswordHandlerEndpoint.handle;

const TEST_INTERFACE_LOCALE: InterfaceLocale = 'en-US';
const TEST_I18N = createI18n(TEST_INTERFACE_LOCALE, catalogForLocale(TEST_INTERFACE_LOCALE));

testCase('password reset submits the link token without exposing it to credential autofill', () => {
  const html = renderToString(
    <ResetPasswordPage
      i18n={TEST_I18N}
      data={{ state: 'form', token: 'opaque-reset-token' }}
    />,
  );

  expect(html).toContain('action="/password/reset" method="post"');
  expect(html).toContain('type="hidden" name="token" value="opaque-reset-token"');
  expect(html).toContain('autocomplete="new-password"');
  expect(html).not.toContain('action="/api/locale"');
  expect(html).toContain('minlength="12"');
  expect(html).toContain('aria-describedby="password-requirements"');
  if (!((html.includes('<span>Reset token</span>')) === false)) {
    expect.unreachable("Expected html.includes('<span>Reset token</span>') to be false");
  }
});

testCase('forgot password renders only registration-neutral delivery status', () => {
  const html = renderToString(
    <ForgotPasswordPage
      i18n={TEST_I18N}
      data={{ email: 'unknown@example.test', submitted: true }}
    />,
  );

  expect(html).toContain('action="/password/forgot" method="post"');
  expect(html).toContain(TEST_I18N.t('forgot.success'));
  expect(html).not.toContain('action="/api/locale"');
  expect(html).toContain('role="status"');
  if (!((html.includes('token=')) === false)) {
    expect.unreachable("Expected html.includes('token=') to be false");
  }
  if (!((html.includes('No account was found')) === false)) {
    expect.unreachable("Expected html.includes('No account was found') to be false");
  }
});

testCase('successful password reset no longer renders an empty reset form', () => {
  const html = renderToString(
    <ResetPasswordPage
      i18n={TEST_I18N}
      data={{ state: 'success' }}
    />,
  );

  expect(html).toContain('Password updated. You can now sign in.');
  expect(html).toContain('role="status"');
  if (!((html.includes('name="token"')) === false)) {
    expect.unreachable('Expected html.includes(\'name="token"\') to be false');
  }
  if (!((html.includes('name="password"')) === false)) {
    expect.unreachable('Expected html.includes(\'name="password"\') to be false');
  }
});

testCase('password reset copy follows the selected interface locale', () => {
  const spanishLocale: InterfaceLocale = 'es-ES';
  const spanishI18n = createI18n(spanishLocale, catalogForLocale(spanishLocale));
  const english = renderToString(
    <ResetPasswordPage
      i18n={TEST_I18N}
      data={{ state: 'success' }}
    />,
  );
  const spanish = renderToString(
    <ResetPasswordPage i18n={spanishI18n} data={{ state: 'success' }} />,
  );
  expect(english).toContain(TEST_I18N.t('reset.success'));
  expect(spanish).toContain(spanishI18n.t('reset.success'));
  if (!((english === spanish) === false)) {
    expect.unreachable('Expected english === spanish to be false');
  }
});

testCase(
  'reset GET ignores spoofed success state and rejects a missing token immediately',
  async () => {
    const req = new Request('https://author.example.test/password/reset?success=1');
    let html = '';
    const res = await invokeHttpRoute(
      resetPasswordHandler,
      makeHttpRequest(req, {
        omitAuth: true,
        state: { i18n: TEST_I18N, interfaceLocale: TEST_INTERFACE_LOCALE },
        render: (component) => {
          if (!component) throw new Error('Password reset route rendered no component.');
          html = renderToString(component);
          return Promise.resolve(new Response(html));
        },
      }),
    );

    expect(res.status).toStrictEqual(200);
    expect(html).toContain('This password reset link is incomplete.');
    expect(html).toContain('role="alert"');
    if (!((html.includes('Password updated.')) === false)) {
      expect.unreachable("Expected html.includes('Password updated.') to be false");
    }
    if (!((html.includes('name="password"')) === false)) {
      expect.unreachable('Expected html.includes(\'name="password"\') to be false');
    }
  },
);
