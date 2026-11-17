import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import LoginPolicySettingsCard, {
  formatVerifiedAt,
  LoginPolicyPendingStatus,
  policyErrorDescriptor,
  verificationLoadErrorDescriptor,
} from '../components/sso_settings/LoginPolicySettingsCard.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { oidcSettingsAuthRoute as oidcHandlerEndpoint } from '../lib/http/routes/auth_api/oidc_settings.ts';
import { ssoPolicyAuthRoute as policyHandlerEndpoint } from '../lib/http/routes/auth_api/sso_policy.ts';
import { domainVerificationAuthRoute as domainHandlerEndpoint } from '../lib/http/routes/auth_api/domain_verification.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import enUSSettings from '../lib/i18n/messages/en-US/settings.json' with { type: 'json' };
import enGBSettings from '../lib/i18n/messages/en-GB/settings.json' with { type: 'json' };
import esESSettings from '../lib/i18n/messages/es-ES/settings.json' with { type: 'json' };
import es419Settings from '../lib/i18n/messages/es-419/settings.json' with { type: 'json' };
const settingsByLocale = {
  'en-US': enUSSettings,
  'en-GB': enGBSettings,
  'es-ES': esESSettings,
  'es-419': es419Settings,
} as const;
import type { SsoSettingsErrorCode } from '../lib/http/sso_settings_contract.ts';
import { parseSsoDomain } from '../lib/sso_domain.ts';

const oidcHandler = oidcHandlerEndpoint.handle;
const policyHandler = policyHandlerEndpoint.handle;
const domainHandler = domainHandlerEndpoint.handle;

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
for (const locale of locales) {
  testCase(`Login Policy production shell is localized in ${locale}`, () => {
    const settings = settingsByLocale[locale];
    const i18n = createI18n(locale, { settings });
    const payload = createI18nPayload(locale, { settings }, ['settings']);
    const html = render(
      <I18nProvider payload={payload}>
        <LoginPolicySettingsCard />
      </I18nProvider>,
    );
    expect(html).toContain(i18n.t('settings.sso.policy.title'));
    expect(html).toContain(i18n.t('settings.sso.routes.empty'));
    if (html.includes('settings.sso.')) {
      expect.unreachable("Expected !html.includes('settings.sso.')");
    }
    if (!(Object.keys(payload.namespaces).length === 1)) {
      expect.unreachable('Expected Object.keys(payload.namespaces).length === 1');
    }
    if (!(formatVerifiedAt('not-a-date', i18n) === i18n.t('settings.sso.routes.unavailable'))) {
      expect.unreachable(
        "Expected formatVerifiedAt('not-a-date', i18n) === i18n.t('settings.sso.routes.unavailable')",
      );
    }
    if (!(formatVerifiedAt(null, i18n) === i18n.t('settings.sso.routes.unavailable'))) {
      expect.unreachable(
        "Expected formatVerifiedAt(null, i18n) === i18n.t('settings.sso.routes.unavailable')",
      );
    }
    for (
      const state of [
        { loading: true, saving: false, action: null, domain: null },
        { loading: false, saving: true, action: null, domain: null },
      ]
    ) {
      const status = render(<LoginPolicyPendingStatus {...state} i18n={i18n} />);
      expect(status).toContain('role="status"');
      expect(status).toContain('aria-live="polite"');
    }
  });
}

testCase('Login Policy error descriptors ignore prose and unknown legacy codes', () => {
  if (!(policyErrorDescriptor({ error: 'forbidden' }).id === 'settings.sso.errors.forbidden')) {
    expect.unreachable(
      "Expected policyErrorDescriptor({ error: 'forbidden' }).id === 'settings.sso.errors.forbidden'",
    );
  }
  if (
    !(verificationLoadErrorDescriptor({ error: 'domain_verification_load_failed' }).id ===
      'settings.sso.errors.invalidResponse')
  ) {
    expect.unreachable(
      "Expected verificationLoadErrorDescriptor({ error: 'domain_verification_load_failed' }).id === 'sett",
    );
  }
  if (
    !(verificationLoadErrorDescriptor({ error: 'policy_update_failed' }).id ===
      'settings.sso.errors.invalidResponse')
  ) {
    expect.unreachable(
      "Expected verificationLoadErrorDescriptor({ error: 'policy_update_failed' }).id === 'settings.sso.er",
    );
  }
  if (
    !(policyErrorDescriptor({ error: 'forbidden', message: 'secret' }).id ===
      'settings.sso.errors.forbidden')
  ) {
    expect.unreachable(
      "Expected policyErrorDescriptor({ error: 'forbidden', message: 'secret' }).id === 'settings.sso.erro",
    );
  }
});

const errorIds = {
  forbidden: 'settings.sso.errors.forbidden',
  invalid_payload: 'settings.sso.errors.invalidResponse',
  invalid_oidc_configuration: 'settings.sso.errors.invalidResponse',
  invalid_policy_configuration: 'settings.sso.errors.invalidConfiguration',
  dns_verification_failed: 'settings.sso.errors.dnsFailed',
  https_verification_failed: 'settings.sso.errors.httpsFailed',
  oidc_update_failed: 'settings.sso.errors.service',
  policy_update_failed: 'settings.sso.errors.saveFailed',
  domain_verification_failed: 'settings.sso.errors.verifyFailed',
} satisfies Record<SsoSettingsErrorCode, string>;

testCase('Login Policy maps every stable error envelope without leaking codes', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, { settings: settingsByLocale[locale] });
    for (const code of Object.keys(errorIds) as SsoSettingsErrorCode[]) {
      const payload = code === 'dns_verification_failed' || code === 'https_verification_failed'
        ? { code, params: { domain: 'example.com' } }
        : { code };
      const descriptor = policyErrorDescriptor(payload);
      expect(descriptor.id).toStrictEqual(errorIds[code]);
      const output = i18n.t(descriptor.id, descriptor.values);
      if (output.includes('settings.sso.')) {
        expect.unreachable("Expected !output.includes('settings.sso.')");
      }
      if (output.includes(code)) expect.unreachable('Expected !output.includes(code)');
    }
    expect(policyErrorDescriptor({ error: 'dns_verification_failed', params: {} }).id)
      .toStrictEqual('settings.sso.errors.invalidResponse');
  }
});

testCase('Login Policy pending presenter renders every live phase', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, { settings: settingsByLocale[locale] });
    const cases = [
      { loading: true, saving: false, action: null, domain: null, id: 'settings.sso.loading' },
      { loading: false, saving: true, action: null, domain: null, id: 'settings.sso.savingPolicy' },
      {
        loading: false,
        saving: false,
        action: 'prepare' as const,
        domain: 'example.com',
        id: 'settings.sso.verificationPreparing',
      },
      {
        loading: false,
        saving: false,
        action: 'verify_dns' as const,
        domain: 'example.com',
        id: 'settings.sso.verificationDns',
      },
      {
        loading: false,
        saving: false,
        action: 'verify_https' as const,
        domain: 'example.com',
        id: 'settings.sso.verificationHttps',
      },
    ];
    for (const item of cases) {
      const html = render(
        <LoginPolicyPendingStatus
          loading={item.loading}
          saving={item.saving}
          action={item.action}
          domain={item.domain ? parseSsoDomain(item.domain) : null}
          i18n={i18n}
        />,
      );
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(i18n.t(item.id, item.domain ? { domain: item.domain } : undefined));
    }
  }
});

testCase('SSO mutation errors retain legacy prose with additive codes', async () => {
  const cases = [
    [oidcHandler, '/api/sso/oidc', 'PATCH', { error: 'Invalid payload.', code: 'invalid_payload' }],
    [
      policyHandler,
      '/api/sso/policy',
      'PATCH',
      { error: 'Invalid payload.', code: 'invalid_payload' },
      { loginPolicy: 'invalid' },
    ],
    [domainHandler, '/api/sso/domain-verification', 'PATCH', {
      error: 'Invalid payload.',
      code: 'invalid_payload',
    }],
  ] as const;
  for (const [handler, path, method, expected, body = {}] of cases) {
    const response = await invokeHttpRoute(
      handler,
      makeHttpRequest(
        new Request(`http://local${path}`, {
          ...{ duplex: 'half' },
          method,
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    expect(response.status).toStrictEqual(400);
    expect(await response.json()).toStrictEqual(expected);
  }
});

testCase('SSO unsupported methods return a plain response and the supported methods', async () => {
  for (
    const [handler, path, allow] of [
      [oidcHandler, '/api/sso/oidc', 'GET, PATCH'],
      [policyHandler, '/api/sso/policy', 'GET, PATCH, PUT'],
      [domainHandler, '/api/sso/domain-verification', 'GET, PATCH, PUT'],
    ] as const
  ) {
    const response = await invokeHttpRoute(
      handler,
      makeHttpRequest(new Request(`http://local${path}`, { method: 'DELETE' })),
    );
    expect(response.status).toStrictEqual(405);
    expect(await response.text()).toStrictEqual('Method Not Allowed');
    expect(response.headers.get('allow')).toBe(allow);
  }
});
