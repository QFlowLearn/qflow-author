import { useEffect, useMemo, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import {
  parseSsoSettingsError,
  type SsoSettingsErrorCode,
} from '../../lib/http/sso_settings_contract.ts';

import Button from '../ui/Button.tsx';
import Checkbox from '../ui/Checkbox.tsx';
import Input from '../ui/Input.tsx';
import {
  type OidcSettingsResponse,
  parseOidcSettingsResponse,
} from '../../lib/http/oidc_settings_contract.ts';

type OidcProviderFormState = {
  readonly enabled: boolean;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly clientSecretConfigured: boolean;
  readonly microsoftTenant: string;
};

type OidcFormState = {
  readonly google: OidcProviderFormState;
  readonly microsoft: OidcProviderFormState;
};

type OidcProviderId = keyof OidcFormState;

type OidcProviderUpdatePayload = {
  readonly enabled: boolean;
  readonly clientId: string;
  readonly clientSecret?: string;
};

const EMPTY_OIDC_FORM: OidcFormState = {
  google: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    clientSecretConfigured: false,
    microsoftTenant: '',
  },
  microsoft: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    clientSecretConfigured: false,
    microsoftTenant: '',
  },
};

const OIDC_ERROR_IDS: Readonly<Record<SsoSettingsErrorCode, string>> = {
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

/** Map a parsed SSO API error to the OIDC card's localized message ID. */
export function oidcErrorMessageId(code: SsoSettingsErrorCode): string {
  return OIDC_ERROR_IDS[code];
}

/** Map any API response to a safe localized OIDC error message ID. */
export function oidcErrorMessageIdFromPayload(payload: unknown): string {
  const parsed = parseSsoSettingsError(payload);
  if (parsed) return oidcErrorMessageId(parsed.code);
  return 'settings.sso.oidc.error.invalidResponse';
}

/** Project the secret-free API response into write-only form state. */
export function oidcFormStateFromSettings(config: OidcSettingsResponse): OidcFormState {
  return {
    google: {
      enabled: config.google.enabled,
      clientId: config.google.clientId ?? '',
      clientSecret: '',
      clientSecretConfigured: config.google.clientSecretConfigured,
      microsoftTenant: '',
    },
    microsoft: {
      enabled: config.microsoft.enabled,
      clientId: config.microsoft.clientId ?? '',
      clientSecret: '',
      clientSecretConfigured: config.microsoft.clientSecretConfigured,
      microsoftTenant: config.microsoft.microsoftTenant ?? '',
    },
  };
}

function oidcProviderUpdate(form: OidcProviderFormState): OidcProviderUpdatePayload {
  return {
    enabled: form.enabled,
    clientId: form.clientId,
    ...(form.clientSecret.trim() ? { clientSecret: form.clientSecret } : {}),
  };
}

/** Interactive OIDC provider settings card within the tenant SSO island. */
export default function OidcSettingsCard() {
  const i18n = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<OidcFormState>(EMPTY_OIDC_FORM);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/sso/oidc');
        const payload: unknown = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) {
          setError(
            i18n.t(oidcErrorMessageIdFromPayload(payload)),
          );
          return;
        }
        const settings = parseOidcSettingsResponse(payload);
        if (!settings) {
          setError(i18n.t('settings.sso.oidc.error.invalidResponse'));
          return;
        }
        setForm(oidcFormStateFromSettings(settings));
      } catch (_cause: unknown) {
        if (active) setError(i18n.t('settings.sso.oidc.error.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const redirectUrl = useMemo(() => {
    if (typeof globalThis.location === 'undefined') return '/auth/oidc/callback';
    return `${globalThis.location.origin}/auth/oidc/callback`;
  }, []);

  function updateProvider(
    provider: OidcProviderId,
    patch: Partial<OidcProviderFormState>,
  ): void {
    setForm((current) => ({
      ...current,
      [provider]: { ...current[provider], ...patch },
    }));
  }

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/sso/oidc', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          google: oidcProviderUpdate(form.google),
          microsoft: {
            ...oidcProviderUpdate(form.microsoft),
            microsoftTenant: form.microsoft.microsoftTenant,
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(i18n.t(oidcErrorMessageIdFromPayload(payload)));
        return;
      }
      const settings = parseOidcSettingsResponse(payload);
      if (!settings) {
        setError(i18n.t('settings.sso.oidc.error.invalidResponse'));
        return;
      }
      setForm(oidcFormStateFromSettings(settings));
      setSuccess(i18n.t('settings.sso.oidc.saved'));
    } catch (_cause: unknown) {
      setError(i18n.t('settings.sso.oidc.error.updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class='ds-card ds-card-bordered max-w-4xl' onSubmit={save}>
      <div class='ds-card-body space-y-5'>
        <OidcPendingStatus loading={loading} saving={saving} />
        <div class='space-y-1'>
          <h2 class='text-xl font-medium'>{i18n.t('settings.sso.oidc.title')}</h2>
          <p class='text-sm text-base-content/70'>
            {i18n.t('settings.sso.oidc.subtitle')}
          </p>
        </div>

        <div class='rounded-box border border-base-200 bg-base-100 p-3 text-sm text-base-content/80'>
          <div>{i18n.t('settings.sso.oidc.redirectInstruction', { redirectUrl })}</div>
          <div class='mt-2'>
            {i18n.t('settings.sso.oidc.scopes', { scopes: 'openid email profile' })}
          </div>
          <div class='mt-2'>
            {i18n.t('settings.sso.oidc.publicLoginGuidance', {
              env: 'QFLOW_PUBLIC_OIDC_TENANT_SLUG',
            })}
          </div>
        </div>

        {error && <div class='ds-alert ds-alert-error text-sm' role='alert'>{error}</div>}
        {success && <div class='ds-alert text-sm' role='status'>{success}</div>}

        <div class='grid gap-4 md:grid-cols-2'>
          {(['google', 'microsoft'] as const).map((provider) => (
            <OidcProviderEditor
              key={provider}
              provider={provider}
              form={form[provider]}
              redirectUrl={redirectUrl}
              onChange={(patch) => updateProvider(provider, patch)}
            />
          ))}
        </div>
      </div>
      <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
        <Button variant='primary' type='submit' disabled={loading || saving}>
          {saving ? i18n.t('settings.sso.oidc.saving') : i18n.t('settings.sso.oidc.save')}
        </Button>
      </div>
    </form>
  );
}

/** Accessible live status for initial loading and in-flight saves. */
export function OidcPendingStatus({ loading, saving }: { loading: boolean; saving: boolean }) {
  const i18n = useI18n();
  if (!loading && !saving) return null;
  return (
    <div role='status' aria-live='polite' class='text-sm text-base-content/70'>
      {i18n.t(saving ? 'settings.sso.oidc.saving' : 'settings.sso.oidc.loading')}
    </div>
  );
}

function OidcProviderEditor(
  {
    provider,
    form,
    redirectUrl,
    onChange,
  }: {
    readonly provider: OidcProviderId;
    readonly form: OidcProviderFormState;
    readonly redirectUrl: string;
    readonly onChange: (patch: Partial<OidcProviderFormState>) => void;
  },
) {
  const i18n = useI18n();
  const label = provider === 'google' ? 'Google' : 'Microsoft';
  const enabledId = `${provider}-oidc-enabled`;
  const clientIdId = `${provider}-client-id`;
  const clientSecretId = `${provider}-client-secret`;
  const clientSecretHelpId = `${provider}-client-secret-help`;

  return (
    <fieldset class='space-y-4 rounded-box border border-base-200 p-4'>
      <legend class='sr-only'>
        {i18n.t('settings.sso.oidc.providerLegend', { provider: label })}
      </legend>
      <OidcProviderGuidance provider={provider} redirectUrl={redirectUrl} />
      <label class='ds-form-control' for={enabledId}>
        <span class='flex items-center gap-3'>
          <Checkbox
            id={enabledId}
            name={`${provider}Enabled`}
            checked={form.enabled}
            onChange={(event) => onChange({ enabled: event.currentTarget.checked })}
          />
          <span>{i18n.t('settings.sso.oidc.enable', { provider: label })}</span>
        </span>
      </label>
      <label class='ds-form-control' for={clientIdId}>
        <span>{i18n.t('settings.sso.oidc.clientId', { provider: label })}</span>
        <Input
          id={clientIdId}
          name={`${provider}ClientId`}
          value={form.clientId}
          onInput={(event) => onChange({ clientId: event.currentTarget.value })}
          required={form.enabled}
        />
      </label>
      <label class='ds-form-control' for={clientSecretId}>
        <span>{i18n.t('settings.sso.oidc.clientSecret', { provider: label })}</span>
        <Input
          id={clientSecretId}
          name={`${provider}ClientSecret`}
          type='password'
          autoComplete='new-password'
          value={form.clientSecret}
          onInput={(event) => onChange({ clientSecret: event.currentTarget.value })}
          required={form.enabled && !form.clientSecretConfigured}
          placeholder={form.clientSecretConfigured
            ? i18n.t('settings.sso.oidc.secretKeep')
            : i18n.t('settings.sso.oidc.secretEnter')}
          aria-describedby={clientSecretHelpId}
        />
        <span id={clientSecretHelpId} class='mt-1 text-xs text-base-content/70'>
          {form.clientSecretConfigured
            ? i18n.t('settings.sso.oidc.secretStored')
            : i18n.t('settings.sso.oidc.secretMissing')}
        </span>
      </label>
      {provider === 'microsoft' && (
        <label class='ds-form-control' for='microsoft-tenant'>
          <span>{i18n.t('settings.sso.oidc.microsoftTenant')}</span>
          <Input
            id='microsoft-tenant'
            name='microsoftTenant'
            value={form.microsoftTenant}
            onInput={(event) => onChange({ microsoftTenant: event.currentTarget.value })}
            required={form.enabled}
            pattern='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}'
            placeholder={i18n.t('settings.sso.oidc.microsoftTenantPlaceholder')}
            autoCapitalize='none'
            spellcheck={false}
            aria-describedby='microsoft-tenant-help'
          />
          <span id='microsoft-tenant-help' class='mt-1 text-xs text-base-content/70'>
            {i18n.t('settings.sso.oidc.microsoftTenantHelp')}
          </span>
        </label>
      )}
    </fieldset>
  );
}

function OidcProviderGuidance(
  { provider, redirectUrl }: { readonly provider: OidcProviderId; readonly redirectUrl: string },
) {
  const i18n = useI18n();
  if (provider === 'google') {
    return (
      <div class='space-y-1 text-xs text-base-content/70'>
        <div>
          {i18n.t('settings.sso.oidc.google.step1')}
        </div>
        <div>
          {i18n.t('settings.sso.oidc.redirectLabel', { redirectUrl })}
        </div>
        <div>{i18n.t('settings.sso.oidc.copyCredentials')}</div>
        <a
          class='link link-primary'
          href='https://developers.google.com/identity/openid-connect/openid-connect'
          target='_blank'
          rel='noopener noreferrer'
        >
          {i18n.t('settings.sso.oidc.google.docs')}
        </a>
      </div>
    );
  }

  return (
    <div class='space-y-1 text-xs text-base-content/70'>
      <div>
        {i18n.t('settings.sso.oidc.microsoft.step1')}
      </div>
      <div>
        {i18n.t('settings.sso.oidc.microsoft.redirect', { redirectUrl })}
      </div>
      <div>
        {i18n.t('settings.sso.oidc.microsoft.secret')}
      </div>
      <div>{i18n.t('settings.sso.oidc.microsoft.clientIdHelp')}</div>
      <a
        class='link link-primary'
        href='https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app'
        target='_blank'
        rel='noopener noreferrer'
      >
        {i18n.t('settings.sso.oidc.microsoft.docs')}
      </a>
    </div>
  );
}
