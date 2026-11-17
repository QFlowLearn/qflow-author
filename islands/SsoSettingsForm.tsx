import LoginPolicySettingsCard from '../components/sso_settings/LoginPolicySettingsCard.tsx';
import OidcSettingsCard from '../components/sso_settings/OidcSettingsCard.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import type { I18nPayload } from '../lib/i18n/payload.ts';

/** Tenant SSO administration island composed from independently owned settings cards. */
export default function SsoSettingsForm({ payload }: { readonly payload: I18nPayload }) {
  return (
    <I18nProvider payload={payload}>
      <div class='space-y-6'>
        <OidcSettingsCard />
        <LoginPolicySettingsCard />
      </div>
    </I18nProvider>
  );
}
