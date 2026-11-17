import AccountSettingsPage from '../../../../components/auth/AccountSettingsPage.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { parseUserSettingsPatch, parseUserTheme, type UserSettings } from '../../../settings.ts';
import { getAccountProfile, updateAccountProfile } from '../../../services/account.ts';
import { getUserSettings, saveUserSettings } from '../../../services/user_settings.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { buildLocaleCookie } from '../../../i18n/locale.ts';

/** Build the post-save redirect and locale cookie for account settings. */
export function accountSettingsRedirect(
  url: URL,
  locale: UserSettings['interfaceLocale'],
): Response {
  const redirect = new URL('/settings?success=1', url.origin);
  const headers = new Headers({ location: redirect.pathname + redirect.search });
  headers.append('set-cookie', buildLocaleCookie(url, locale));
  return new Response(null, { status: 302, headers });
}

const methods = {
  async GET(ctx: HttpRequest) {
    const auth = requireAuthContext(ctx.state);
    const url = ctx.url;
    const success = url.searchParams.get('success') === '1';

    const user = await getAccountProfile(auth);
    if (!user) return new Response('Not Found', { status: 404 });

    const settings = await getUserSettings(auth.userId);

    return ctx.render(
      <AccountSettingsPage
        data={{
          user,
          settings,
          success,
        }}
        i18n={ctx.state.i18n}
      />,
    );
  },
  async POST(ctx: HttpRequest) {
    const auth = requireAuthContext(ctx.state);
    const form = await ctx.req.formData();
    const displayName = String(form.get('displayName') ?? '').trim();
    const theme = parseUserTheme(form.get('theme'));
    const interfaceLocale = parseUserSettingsPatch({ interfaceLocale: form.get('interfaceLocale') })
      ?.interfaceLocale;
    if (theme === null || !interfaceLocale) {
      return new Response(ctx.state.i18n.t('settings.invalidAccountSettings'), { status: 400 });
    }

    await updateAccountProfile(auth, {
      displayName: displayName ? displayName : null,
    });

    const currentSettings = await getUserSettings(auth.userId);
    const nextSettings: UserSettings = { ...currentSettings, theme, interfaceLocale };
    await saveUserSettings(auth.userId, nextSettings);

    return accountSettingsRedirect(ctx.url, interfaceLocale);
  },
};

export const accountSettingsRoute = defineHttpRoute('/settings', {
  GET: methods.GET,
  HEAD: methods.GET,
  POST: methods.POST,
});
