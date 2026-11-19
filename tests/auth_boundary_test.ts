import { diagnosticConsole } from './helpers/diagnostic_console.ts';
import { expect, test as testCase } from 'vitest';

import { runWithRequestRuntime } from '../lib/server/request_runtime_context.ts';

import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { renderPage as renderToString } from './helpers/render_page.tsx';
import { loginErrorMessage } from '../lib/http/auth_feedback.ts';
import { readCookieValue } from '../lib/http/cookies.ts';
import { oidcCallbackAuthRoute as oidcCallbackHandlerEndpoint } from '../lib/http/routes/auth_api/oidc_callback.ts';
import { signupPageRoute as signupHandlerEndpoint } from '../lib/http/routes/auth_pages/signup.tsx';
import {
  type HttpEndpoint,
  invokeHttpMethod,
  invokeHttpRoute,
  makeHttpRequest,
} from './helpers/http_route.ts';

const oidcCallbackHandler = oidcCallbackHandlerEndpoint.handle;
const signupHandler = signupHandlerEndpoint.handle;

testCase('cookie parsing classifies invalid encoding instead of throwing', () => {
  expect(readCookieValue('theme=dark; qflow_session=%', 'qflow_session')).toStrictEqual({
    kind: 'malformed',
    value: null,
  });
  expect(readCookieValue('qflow_session=token%3Dvalue; theme=dark', 'qflow_session')).toStrictEqual(
    {
      kind: 'present',
      value: 'token=value',
    },
  );
  expect(readCookieValue('theme=dark', 'qflow_session')).toStrictEqual({
    kind: 'absent',
    value: null,
  });
});

testCase('sign-in query feedback accepts only closed first-party codes', () => {
  expect(loginErrorMessage('sign_in_unavailable')).toStrictEqual('sign_in_unavailable');
  expect(loginErrorMessage('Your account was hacked. Call this number.')).toStrictEqual(null);
});

testCase('signup ignores arbitrary query-controlled error copy', async () => {
  const attackerCopy = 'Transfer payment to attacker.example';
  const req = new Request(
    `https://author.example.test/signup?error=${encodeURIComponent(attackerCopy)}`,
  );
  let html = '';
  await invokeHttpMethod(
    signupHandler as HttpEndpoint,
    'GET',
    makeHttpRequest(req, {
      omitAuth: true,
      state: {
        interfaceLocale: 'en-US' as const,
        catalog: catalogForLocale('en-US'),
        i18n: createI18n('en-US', catalogForLocale('en-US')),
      },
      render: (component) => {
        if (!component) throw new Error('Signup route rendered no component.');
        html = renderToString(component);
        return Promise.resolve(new Response(html));
      },
    }),
  );

  if (!((html.includes(attackerCopy)) === false)) {
    expect.unreachable('Expected html.includes(attackerCopy) to be false');
  }
});

testCase('OIDC errors require valid state and never forward provider descriptions', async () => {
  const attackerCopy = 'Contact attacker.example immediately';
  const req = new Request(
    `https://author.example.test/auth/oidc/callback?error=access_denied&error_description=${
      encodeURIComponent(attackerCopy)
    }`,
  );
  const res = await invokeHttpRoute(
    oidcCallbackHandler,
    makeHttpRequest(req, { omitAuth: true }),
  );

  expect(res.status).toStrictEqual(302);
  const location = res.headers.get('location') ?? '';
  expect(location).toStrictEqual('/login?error=missing_authorization_response');
  if (!((location.includes(attackerCopy)) === false)) {
    expect.unreachable('Expected location.includes(attackerCopy) to be false');
  }
});

testCase(
  'unexpected OIDC callback failures return a closed client error without exposing diagnostics',
  async () => {
    const diagnostics = diagnosticConsole();

    const runtime = {
      diagnostics: diagnostics.console,
      bindings: { QFLOW_DB: { connectionString: 'private-invalid-url' } },
    };
    const response = await runWithRequestRuntime(runtime, () =>
      invokeHttpRoute(
        oidcCallbackHandler,
        makeHttpRequest(
          new Request('http://local/auth/oidc/callback?state=invalid-state'),
          { omitAuth: true, state: { runtime } },
        ),
      ));
    expect(response.status).toStrictEqual(302);
    expect(response.headers.get('location')).toStrictEqual('/login?error=sign_in_unavailable');
    if (!((diagnostics.text().includes('private-invalid-url')) === false)) {
      expect.unreachable(
        'Expected diagnostics to omit the private database URL',
      );
    }
    expect(diagnostics.text().trim().split('\n').length).toStrictEqual(1);
  },
);
