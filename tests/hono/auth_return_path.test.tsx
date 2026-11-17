import { expect, it } from 'vitest';

import { render as renderToString } from 'preact-render-to-string';

import { parseAuthReturnPath } from '../../lib/http/auth_return_path.ts';
import LoginPage from '../../components/auth/LoginPage.tsx';
import SignupPage from '../../lib/http/routes/auth_pages/signup.tsx';
import { createI18n } from '../../lib/i18n/messages.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
const testI18n = createI18n('en-US', catalogForLocale('en-US'));

it('authentication return paths accept local application destinations only', () => {
  expect(parseAuthReturnPath('/assessments/new?intent=recover&source=respondus')).toStrictEqual(
    '/assessments/new?intent=recover&source=respondus',
  );
  expect(parseAuthReturnPath('https://attacker.example/steal')).toStrictEqual(null);
  expect(parseAuthReturnPath('//attacker.example/steal')).toStrictEqual(null);
  expect(parseAuthReturnPath('/\\attacker.example/steal')).toStrictEqual(null);
  expect(parseAuthReturnPath('/login')).toStrictEqual(null);
  expect(parseAuthReturnPath('/signup')).toStrictEqual(null);
});

it('sign-in and signup preserve the focused Respondus destination', () => {
  const next = '/assessments/new?intent=recover&source=respondus';
  const loginHtml = renderToString(
    <LoginPage
      i18n={testI18n}
      data={{
        error: null,
        errorField: null,
        email: '',
        next,
        oidcProviders: [],
        loginPolicy: 'allow_password',
        signInUnavailable: false,
      }}
    />,
  );
  const signupHtml = renderToString(<SignupPage i18n={testI18n} locale='en-US' data={{ next }} />);

  assertStringIncludes(
    loginHtml,
    'href="/signup?next=%2Fassessments%2Fnew%3Fintent%3Drecover%26source%3Drespondus"',
  );
  assertStringIncludes(loginHtml, `name="next" value="${next.replaceAll('&', '&amp;')}"`);
  assertStringIncludes(
    signupHtml,
    'href="/login?next=%2Fassessments%2Fnew%3Fintent%3Drecover%26source%3Drespondus"',
  );
  assertStringIncludes(signupHtml, `name="next" value="${next.replaceAll('&', '&amp;')}"`);
});

it('authentication forms expose stable autofill and accessible error contracts', () => {
  const loginHtml = renderToString(
    <LoginPage
      i18n={testI18n}
      data={{
        error: 'credentials_invalid',
        errorField: 'credentials',
        email: 'teacher@example.test',
        next: null,
        oidcProviders: [],
        loginPolicy: 'allow_password',
        signInUnavailable: false,
      }}
    />,
  );
  const signupHtml = renderToString(
    <SignupPage
      i18n={testI18n}
      locale='en-US'
      data={{
        error: 'email_exists',
        errorField: 'email',
        email: 'teacher@example.test',
      }}
    />,
  );

  assertStringIncludes(loginHtml, 'id="login-error"');
  assertStringIncludes(loginHtml, 'role="alert"');
  assertStringIncludes(loginHtml, 'id="login-email"');
  assertStringIncludes(loginHtml, 'autocomplete="username"');
  assertStringIncludes(loginHtml, 'id="current-password"');
  assertStringIncludes(loginHtml, 'autocomplete="current-password"');
  assertStringIncludes(loginHtml, 'aria-invalid="true"');
  assertStringIncludes(loginHtml, 'aria-describedby="login-error"');

  assertStringIncludes(signupHtml, 'id="signup-error"');
  assertStringIncludes(signupHtml, 'role="alert"');
  assertStringIncludes(signupHtml, 'id="signup-email"');
  assertStringIncludes(signupHtml, 'autocomplete="username"');
  assertStringIncludes(signupHtml, 'aria-describedby="signup-error"');
  assertStringIncludes(signupHtml, 'id="new-password"');
  assertStringIncludes(signupHtml, 'autocomplete="new-password"');
});

it('signup session failure renders a non-retry account-created state', () => {
  const html = renderToString(
    <SignupPage
      i18n={testI18n}
      locale='en-US'
      data={{ resultCode: 'account_created_session_failed' }}
    />,
  );

  assertStringIncludes(html, 'Account created');
  assertStringIncludes(html, 'automatic sign-in was unavailable');
  assertStringIncludes(html, 'role="status"');
  assertStringIncludes(html, 'href="/login"');
  expect(html.includes('name="password"')).toStrictEqual(false);
});

function assertStringIncludes(actual: string, expected: string) {
  if (!(actual.includes(expected))) expect.unreachable('Expected actual.includes(expected)');
}
