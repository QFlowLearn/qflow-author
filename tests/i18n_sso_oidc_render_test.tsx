import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import OidcSettingsCard, {
  oidcErrorMessageIdFromPayload,
  oidcFormStateFromSettings,
  OidcPendingStatus,
} from '../components/sso_settings/OidcSettingsCard.tsx';
import { parseOidcSettingsResponse } from '../lib/http/oidc_settings_contract.ts';
import { parseSsoDomain } from '../lib/sso_domain.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import SsoSettingsPage from '../lib/http/routes/settings_pages/sso.tsx';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const errorCodes = [
  'forbidden',
  'invalid_payload',
  'invalid_oidc_configuration',
  'invalid_policy_configuration',
  'dns_verification_failed',
  'https_verification_failed',
  'oidc_update_failed',
  'policy_update_failed',
  'domain_verification_failed',
] as const;

testCase('OIDC error mapper accepts additive codes and ignores prose', () => {
  const expected: Record<(typeof errorCodes)[number], string> = {
    forbidden: 'settings.sso.oidc.error.forbidden',
    invalid_payload: 'settings.sso.oidc.error.invalidPayload',
    invalid_oidc_configuration: 'settings.sso.oidc.error.invalidConfiguration',
    invalid_policy_configuration: 'settings.sso.oidc.error.service',
    dns_verification_failed: 'settings.sso.oidc.error.service',
    https_verification_failed: 'settings.sso.oidc.error.service',
    oidc_update_failed: 'settings.sso.oidc.error.updateFailed',
    policy_update_failed: 'settings.sso.oidc.error.service',
    domain_verification_failed: 'settings.sso.oidc.error.service',
  };
  const domain = parseSsoDomain('login.example.com');
  if (!domain) throw new Error('valid domain fixture failed');
  for (const code of errorCodes) {
    const payload = code === 'dns_verification_failed' || code === 'https_verification_failed'
      ? { code, params: { domain } }
      : { code };
    if (!(oidcErrorMessageIdFromPayload(payload) === expected[code])) {
      expect.unreachable('Expected oidcErrorMessageIdFromPayload(payload) === expected[code]');
    }
  }
  if (!(oidcErrorMessageIdFromPayload(null) === 'settings.sso.oidc.error.invalidResponse')) {
    expect.unreachable(
      "Expected oidcErrorMessageIdFromPayload(null) === 'settings.sso.oidc.error.invalidResponse'",
    );
  }
  if (
    !(oidcErrorMessageIdFromPayload({ error: 'future', message: 'hostile secret' }) ===
      'settings.sso.oidc.error.invalidResponse')
  ) {
    expect.unreachable(
      "Expected oidcErrorMessageIdFromPayload({ error: 'future', message: 'hostile secret' }) === 'setting",
    );
  }
  if (
    !(oidcErrorMessageIdFromPayload({ error: 'forbidden', secret: 'do-not-render' }) ===
      'settings.sso.oidc.error.forbidden')
  ) {
    expect.unreachable(
      "Expected oidcErrorMessageIdFromPayload({ error: 'forbidden', secret: 'do-not-render' }) === 'settin",
    );
  }
  if (
    !(oidcErrorMessageIdFromPayload({
      error: 'dns_verification_failed',
      params: { domain: 'not canonical' },
    }) === 'settings.sso.oidc.error.invalidResponse')
  ) {
    expect.unreachable(
      "Expected oidcErrorMessageIdFromPayload({ error: 'dns_verification_failed', params: { domain: 'not c",
    );
  }
});

testCase('OIDC response parser rejects secrets and preserves write-only shape', () => {
  const provider = (id: 'google' | 'microsoft') => ({
    tenantId: 'tenant',
    provider: id,
    enabled: false,
    clientId: null,
    clientSecretConfigured: true,
    microsoftTenant: null,
    createdAt: null,
    updatedAt: null,
  });
  const safe = { google: provider('google'), microsoft: provider('microsoft') };
  if (!(parseOidcSettingsResponse(safe) !== null)) {
    expect.unreachable('Expected parseOidcSettingsResponse(safe) !== null');
  }
  expect(parseOidcSettingsResponse({
    ...safe,
    google: { ...safe.google, clientSecret: 'secret-value' },
  })).toStrictEqual(null);
  if (JSON.stringify(safe).includes('secret-value')) {
    expect.unreachable("Expected !JSON.stringify(safe).includes('secret-value')");
  }
  const projected = oidcFormStateFromSettings(safe);
  if (!(projected.google.clientSecret === '' && projected.microsoft.clientSecret === '')) {
    expect.unreachable(
      "Expected projected.google.clientSecret === '' && projected.microsoft.clientSecret === ''",
    );
  }
  if (!(projected.google.clientSecretConfigured && projected.microsoft.clientSecretConfigured)) {
    expect.unreachable(
      'Expected projected.google.clientSecretConfigured && projected.microsoft.clientSecretConfigured',
    );
  }
});

for (const locale of locales) {
  testCase(`OIDC pending statuses are live in ${locale}`, () => {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, { settings: catalog.settings });
    const payload = createI18nPayload(locale, catalog, ['settings']);
    for (const state of [{ loading: true, saving: false }, { loading: false, saving: true }]) {
      const html = render(
        <I18nProvider payload={payload}>
          <OidcPendingStatus {...state} />
        </I18nProvider>,
      );
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(
        i18n.t(state.saving ? 'settings.sso.oidc.saving' : 'settings.sso.oidc.loading'),
      );
    }
  });
}
for (const locale of locales) {
  testCase(`OIDC card renders localized content in ${locale}`, () => {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, { settings: catalog.settings });
    const payload = createI18nPayload(locale, catalog, ['settings']);
    const html = render(
      <I18nProvider payload={payload}>
        <OidcSettingsCard />
      </I18nProvider>,
    );
    for (const id of ['title', 'subtitle', 'save']) {
      expect(html).toContain(i18n.t(`settings.sso.oidc.${id}`));
    }
    expect(html).toContain(
      i18n.t('settings.sso.oidc.redirectInstruction', { redirectUrl: '/auth/oidc/callback' }),
    );
    expect(html).toContain(i18n.t('settings.sso.oidc.scopes', { scopes: 'openid email profile' }));
    expect(html).toContain(i18n.t('settings.sso.oidc.secretEnter'));
    expect(html).toContain(i18n.t('settings.sso.oidc.loading'));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('/auth/oidc/callback');
    if (html.includes('to the slug of the tenant')) {
      expect.unreachable("Expected !html.includes('to the slug of the tenant')");
    }
    if (html.includes('settings.sso.oidc.')) {
      expect.unreachable("Expected !html.includes('settings.sso.oidc.')");
    }
    if (html.includes('client-secret-value')) {
      expect.unreachable("Expected !html.includes('client-secret-value')");
    }
    if (
      !(Object.keys(payload.namespaces).length === 1 && payload.namespaces.settings !== undefined)
    ) {
      expect.unreachable(
        'Expected Object.keys(payload.namespaces).length === 1 && payload.namespaces.settings !== undefined',
      );
    }
  });
  testCase(`SSO route heading renders in ${locale}`, () => {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, { settings: catalog.settings });
    const payload = createI18nPayload(locale, catalog, ['settings']);
    const html = render(<SsoSettingsPage i18n={i18n} payload={payload} />);
    expect(html).toContain(i18n.t('settings.sso.title'));
    expect(html).toContain(i18n.t('settings.sso.subtitle'));
  });
}

testCase('English and Spanish OIDC output differs', () => {
  const en = catalogForLocale('en-US');
  const es = catalogForLocale('es-ES');
  const english = createI18n('en-US', { settings: en.settings });
  const spanish = createI18n('es-ES', { settings: es.settings });
  if (
    !(render(
      <I18nProvider payload={createI18nPayload('en-US', en, ['settings'])}>
        <OidcSettingsCard />
      </I18nProvider>,
    ) !==
      render(
        <I18nProvider payload={createI18nPayload('es-ES', es, ['settings'])}>
          <OidcSettingsCard />
        </I18nProvider>,
      ))
  ) {
    expect.unreachable(
      "Expected render( <I18nProvider payload={createI18nPayload('en-US', en, ['settings'])}> <OidcSetting",
    );
  }
  if (!(english.t('settings.sso.oidc.title') !== spanish.t('settings.sso.oidc.title'))) {
    expect.unreachable(
      "Expected english.t('settings.sso.oidc.title') !== spanish.t('settings.sso.oidc.title')",
    );
  }
});

testCase('regional English OIDC guidance uses its own spelling', () => {
  const us = catalogForLocale('en-US').settings;
  const gb = catalogForLocale('en-GB').settings;
  expect(us['settings.sso.oidc.redirectLabel']).toContain('authorized');
  expect(us['settings.sso.oidc.microsoft.step1']).toContain('admin center');
  expect(gb['settings.sso.oidc.redirectLabel']).toContain('authorised');
  expect(gb['settings.sso.oidc.microsoft.step1']).toContain('admin centre');
});
