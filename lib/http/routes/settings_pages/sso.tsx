import { mountIsland } from '../../../rendering/mount_island.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import SsoSettingsFormView from '../../../../islands/SsoSettingsForm.tsx';
import { createI18nPayload } from '../../../i18n/payload.ts';
import type { I18n } from '../../../i18n/messages.ts';
import type { I18nPayload } from '../../../i18n/payload.ts';
import { roleAtLeast } from '../../../roles.ts';
import { requireAuthContext } from '../../../tenants.ts';

const methods = {
  GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!roleAtLeast(auth.role, 'admin')) {
      return new Response(ctx.state.i18n.t('settings.sso.error.forbidden'), { status: 403 });
    }
    return ctx.render(
      <SsoSettingsPage
        i18n={ctx.state.i18n}
        payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['settings'])}
      />,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsSsoPageRoute = defineHttpRoute('/settings/sso', {
  ...methods,
  HEAD: methods.GET,
});

export default function SsoSettingsPage({ i18n, payload }: { i18n: I18n; payload: I18nPayload }) {
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.sso.title')}</h1>
        <p class='text-sm text-base-content/70'>
          {i18n.t('settings.sso.subtitle')}
        </p>
      </div>
      <SsoSettingsForm payload={payload} />
    </section>
  );
}

const SsoSettingsForm = mountIsland({ component: 'SsoSettingsForm', View: SsoSettingsFormView });
