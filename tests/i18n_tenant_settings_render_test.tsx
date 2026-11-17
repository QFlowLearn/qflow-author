import { expect, test as testCase } from 'vitest';
import { makeHttpRequest } from './helpers/http_route.ts';

import { renderPage as render } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import TenantSettingsPage, {
  settingsTenantPageRoute as handlerEndpoint,
} from '../lib/http/routes/settings_pages/tenant.tsx';

const handler = handlerEndpoint.handle;

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const tenant = { bankDisplayName: null, name: 'North Star Workspace', slug: 'north-star' };
const errors = ['forbidden', 'not_found', 'invalid_name', 'update_failed'] as const;
const errorIds = {
  forbidden: 'forbidden',
  not_found: 'notFound',
  invalid_name: 'invalidName',
  update_failed: 'updateFailed',
} as const;

for (const locale of locales) {
  testCase(`tenant settings renders states in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const normal = render(
      <TenantSettingsPage i18n={i18n} data={{ canManageBankName: true, tenant }} />,
    );
    for (const id of ['title', 'subtitle', 'name', 'slug', 'save', 'back']) {
      expect(normal).toContain(i18n.t(`settings.tenant.${id}`));
    }
    expect(normal).toContain(tenant.name);
    expect(normal).toContain(tenant.slug);
    expect(normal).toContain('disabled');
    if (normal.includes('settings.tenant.')) {
      expect.unreachable("Expected !normal.includes('settings.tenant.')");
    }

    const saved = render(
      <TenantSettingsPage i18n={i18n} data={{ canManageBankName: true, tenant, success: true }} />,
    );
    expect(saved).toContain(i18n.t('settings.tenant.saved'));
    expect(saved).toContain('role="status"');
    for (const code of errors) {
      const html = render(
        <TenantSettingsPage i18n={i18n} data={{ canManageBankName: true, tenant, error: code }} />,
      );
      expect(html).toContain(i18n.t(`settings.tenant.error.${errorIds[code]}`));
      expect(html).toContain('role="alert"');
      if (html.includes('settings.tenant.')) {
        expect.unreachable("Expected !html.includes('settings.tenant.')");
      }
    }
  });

  testCase(`tenant owner denial is localized in ${locale}`, async () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const state = {
      auth: { tenantId: 'tenant-test', userId: 'user-test', role: 'teaching_assistant' as const },
      interfaceLocale: locale,
      catalog: catalogForLocale(locale),
      i18n,
    };
    const getReq = new Request('https://example.test/settings/tenant');
    const getResponse = await handler(makeHttpRequest(getReq, { state: state, auth: state.auth }));
    expect(getResponse.status).toStrictEqual(403);
    expect(await getResponse.text()).toStrictEqual(i18n.t('settings.tenant.error.forbidden'));
    const postReq = new Request('https://example.test/settings/tenant', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: new FormData(),
    });
    const postResponse = await handler(
      makeHttpRequest(postReq, { state: state, auth: state.auth }),
    );
    expect(postResponse.status).toStrictEqual(403);
    expect(await postResponse.text()).toStrictEqual(i18n.t('settings.tenant.error.forbidden'));
  });
}

testCase('tenant settings copy differs between English and Spanish', () => {
  const en = createI18n('en-US', catalogForLocale('en-US'));
  const es = createI18n('es-ES', catalogForLocale('es-ES'));
  if (
    !(render(<TenantSettingsPage i18n={en} data={{ canManageBankName: true, tenant }} />) !==
      render(<TenantSettingsPage i18n={es} data={{ canManageBankName: true, tenant }} />))
  ) {
    expect.unreachable(
      'Expected render(<TenantSettingsPage i18n={en} data={{ canManageBankName: true, tenant }} />) !== re',
    );
  }
});
