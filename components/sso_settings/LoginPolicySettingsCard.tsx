import LocalizedTimestamp from '../../islands/LocalizedTimestamp.tsx';
import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import {
  parseSsoSettingsError,
  type SsoSettingsErrorCode,
} from '../../lib/http/sso_settings_contract.ts';

import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import Select from '../ui/Select.tsx';
import {
  type DomainVerificationAction,
  type DomainVerificationResponse,
  parseDomainVerificationActionResponse,
  parseDomainVerificationListResponse,
  parseSsoPolicySettingsResponse,
  type SsoPolicySettingsResponse,
} from '../../lib/http/sso_settings_contract.ts';
import { parseSsoDomain, type SsoDomain } from '../../lib/sso_domain.ts';
import {
  parseSsoLoginPolicy,
  parseSsoRouteProvider,
  type SsoLoginPolicy,
  type SsoRouteProvider,
} from '../../lib/sso_policy.ts';

type EditableDomainRoute = {
  readonly domain: string;
  readonly provider: SsoRouteProvider;
};

type SsoPolicyFormState = {
  readonly loginPolicy: SsoLoginPolicy;
  readonly domainRoutes: readonly EditableDomainRoute[];
};

const POLICY_ERROR_IDS: Readonly<Record<SsoSettingsErrorCode, string>> = {
  forbidden: 'settings.sso.errors.forbidden',
  invalid_payload: 'settings.sso.errors.invalidResponse',
  invalid_oidc_configuration: 'settings.sso.errors.invalidResponse',
  invalid_policy_configuration: 'settings.sso.errors.invalidConfiguration',
  dns_verification_failed: 'settings.sso.errors.dnsFailed',
  https_verification_failed: 'settings.sso.errors.httpsFailed',
  oidc_update_failed: 'settings.sso.errors.service',
  policy_update_failed: 'settings.sso.errors.saveFailed',
  domain_verification_failed: 'settings.sso.errors.verifyFailed',
};

export function policyErrorDescriptor(
  payload: unknown,
): { id: string; values?: { domain: string } } {
  const parsed = parseSsoSettingsError(payload);
  if (!parsed) return { id: 'settings.sso.errors.invalidResponse' };
  if (
    (parsed.code === 'dns_verification_failed' || parsed.code === 'https_verification_failed') &&
    parsed.params
  ) {
    return { id: POLICY_ERROR_IDS[parsed.code], values: { domain: parsed.params.domain } };
  }
  return { id: POLICY_ERROR_IDS[parsed.code] };
}

export function verificationLoadErrorDescriptor(payload: unknown): { id: string } {
  const parsed = parseSsoSettingsError(payload);
  if (parsed?.code === 'forbidden') return { id: 'settings.sso.errors.forbidden' };
  return { id: 'settings.sso.errors.invalidResponse' };
}

const EMPTY_POLICY_FORM: SsoPolicyFormState = {
  loginPolicy: 'allow_password',
  domainRoutes: [],
};

function toPolicyFormState(config: SsoPolicySettingsResponse): SsoPolicyFormState {
  return {
    loginPolicy: config.loginPolicy,
    domainRoutes: config.domainRoutes.map((route) => ({
      domain: route.domain,
      provider: route.provider,
    })),
  };
}

export function formatVerifiedAt(
  value: string | null | undefined,
  i18n: I18n,
) {
  if (!value) return i18n.t('settings.sso.routes.unavailable');
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return i18n.t('settings.sso.routes.unavailable');
  return <LocalizedTimestamp value={date.toISOString()} locale={i18n.locale} />;
}

export function LoginPolicyPendingStatus({
  loading,
  saving,
  action,
  domain,
  i18n,
}: {
  loading: boolean;
  saving: boolean;
  action: DomainVerificationAction | null;
  domain: SsoDomain | null;
  i18n: I18n;
}) {
  if (!loading && !saving && !action) return null;
  const message = loading
    ? i18n.t('settings.sso.loading')
    : saving
    ? i18n.t('settings.sso.savingPolicy')
    : action === 'prepare'
    ? i18n.t('settings.sso.verificationPreparing', {
      domain: domain ?? i18n.t('settings.sso.routes.invalidDomain'),
    })
    : action === 'verify_dns'
    ? i18n.t('settings.sso.verificationDns', {
      domain: domain ?? i18n.t('settings.sso.routes.invalidDomain'),
    })
    : i18n.t('settings.sso.verificationHttps', {
      domain: domain ?? i18n.t('settings.sso.routes.invalidDomain'),
    });
  return <div role='status' aria-live='polite'>{message}</div>;
}

/** Interactive login-policy and domain-verification card within the tenant SSO island. */
export default function LoginPolicySettingsCard() {
  const i18n = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verificationSavingDomain, setVerificationSavingDomain] = useState<SsoDomain | null>(null);
  const [verificationAction, setVerificationAction] = useState<DomainVerificationAction | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<SsoPolicyFormState>(EMPTY_POLICY_FORM);
  const [domainVerifications, setDomainVerifications] = useState<
    ReadonlyMap<SsoDomain, DomainVerificationResponse>
  >(new Map());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [policyResult, verificationResult] = await Promise.all([
          fetch('/api/sso/policy'),
          fetch('/api/sso/domain-verification'),
        ]);
        if (!active) return;
        const policyPayload: unknown = await policyResult.json().catch(() => null);
        if (!active) return;
        if (!policyResult.ok) {
          const descriptor = policyErrorDescriptor(policyPayload);
          setError(i18n.t(descriptor.id, descriptor.values));
        } else {
          const settings = parseSsoPolicySettingsResponse(policyPayload);
          if (!settings) setError(i18n.t('settings.sso.errors.invalidResponse'));
          else setForm(toPolicyFormState(settings));
        }
        const verificationPayload: unknown = await verificationResult.json().catch(() => null);
        if (!active) return;
        if (!verificationResult.ok) {
          const descriptor = verificationLoadErrorDescriptor(verificationPayload);
          setError(i18n.t(descriptor.id));
        } else {
          const verifications = parseDomainVerificationListResponse(verificationPayload);
          if (!verifications) setError(i18n.t('settings.sso.errors.invalidResponse'));
          else {
            setDomainVerifications(
              new Map(verifications.domains.map((record) => [record.domain, record])),
            );
          }
        }
      } catch (_cause: unknown) {
        if (active) setError(i18n.t('settings.sso.errors.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [i18n]);

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/sso/policy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          loginPolicy: form.loginPolicy,
          domainRoutes: form.domainRoutes,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok && !payload) {
        setError(i18n.t('settings.sso.errors.invalidResponse'));
        return;
      }
      if (!response.ok) {
        const descriptor = policyErrorDescriptor(payload);
        setError(i18n.t(descriptor.id, descriptor.values));
        return;
      }
      const settings = parseSsoPolicySettingsResponse(payload);
      if (!settings) {
        setError(i18n.t('settings.sso.errors.invalidResponse'));
        return;
      }
      setForm(toPolicyFormState(settings));
      setSuccess(i18n.t('settings.sso.saved'));
    } catch (_cause: unknown) {
      setError(i18n.t('settings.sso.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function runDomainVerificationAction(
    domainInput: string,
    action: DomainVerificationAction,
  ): Promise<void> {
    const domain = parseSsoDomain(domainInput);
    if (!domain) {
      setError(i18n.t('settings.sso.errors.invalidDomain'));
      return;
    }

    setVerificationSavingDomain(domain);
    setVerificationAction(action);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/sso/domain-verification', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain, action }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const descriptor = policyErrorDescriptor(payload);
        setError(i18n.t(descriptor.id, descriptor.values ?? { domain }));
        return;
      }
      const result = parseDomainVerificationActionResponse(payload);
      if (!result) {
        setError(i18n.t('settings.sso.errors.invalidResponse'));
        return;
      }
      setDomainVerifications((current) => {
        const next = new Map(current);
        next.set(result.record.domain, result.record);
        return next;
      });
      setSuccess(
        action === 'prepare'
          ? i18n.t('settings.sso.verificationPrepared')
          : i18n.t('settings.sso.verified'),
      );
    } catch (_cause: unknown) {
      setError(i18n.t('settings.sso.errors.verifyFailed'));
    } finally {
      setVerificationSavingDomain(null);
      setVerificationAction(null);
    }
  }

  return (
    <form class='ds-card ds-card-border max-w-4xl' onSubmit={save}>
      <div class='ds-card-body space-y-4'>
        <LoginPolicyPendingStatus
          loading={loading}
          saving={saving}
          action={verificationAction}
          domain={verificationSavingDomain}
          i18n={i18n}
        />
        <div class='space-y-1'>
          <h2 class='text-xl font-medium'>{i18n.t('settings.sso.policy.title')}</h2>
          <p class='text-sm text-base-content/70'>
            {i18n.t('settings.sso.policy.subtitle')}
          </p>
        </div>

        {error && <div class='ds-alert ds-alert-error text-sm' role='alert'>{error}</div>}
        {success && <div class='ds-alert text-sm' role='status'>{success}</div>}

        <label class='flex flex-col'>
          <span>{i18n.t('settings.sso.policy.label')}</span>
          <Select
            name='loginPolicy'
            value={form.loginPolicy}
            onChange={(event) => {
              const loginPolicy = parseSsoLoginPolicy(event.currentTarget.value);
              if (loginPolicy) setForm((current) => ({ ...current, loginPolicy }));
            }}
          >
            <option value='allow_password'>{i18n.t('settings.sso.policy.allowPassword')}</option>
            <option value='prefer_sso'>{i18n.t('settings.sso.policy.preferSso')}</option>
            <option value='require_sso'>{i18n.t('settings.sso.policy.requireSso')}</option>
          </Select>
        </label>

        <div class='space-y-3'>
          <div class='text-sm font-medium'>{i18n.t('settings.sso.routes.title')}</div>
          {form.domainRoutes.length === 0 && (
            <div class='text-sm text-base-content/70'>{i18n.t('settings.sso.routes.empty')}</div>
          )}
          {form.domainRoutes.map((route, index) => {
            const domain = parseSsoDomain(route.domain);
            const verification = domain ? domainVerifications.get(domain) : undefined;
            const verified = Boolean(verification?.verifiedAt);
            return (
              <div key={index} class='space-y-3 rounded-box border border-base-200 p-3'>
                <div class='grid gap-3 md:grid-cols-[2fr,1fr,auto]'>
                  <label class='flex flex-col'>
                    <span>{i18n.t('settings.sso.routes.domain')}</span>
                    <Input
                      name={`domainRoute-${index}`}
                      value={route.domain}
                      onInput={(event) => {
                        const domainValue = event.currentTarget.value;
                        setForm((current) => ({
                          ...current,
                          domainRoutes: current.domainRoutes.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, domain: domainValue } : row
                          ),
                        }));
                      }}
                      placeholder={i18n.t('settings.sso.routes.domainPlaceholder')}
                    />
                  </label>
                  <label class='flex flex-col'>
                    <span>{i18n.t('settings.sso.routes.provider')}</span>
                    <Select
                      name={`domainProvider-${index}`}
                      value={route.provider}
                      onChange={(event) => {
                        const provider = parseSsoRouteProvider(event.currentTarget.value);
                        if (!provider) return;
                        setForm((current) => ({
                          ...current,
                          domainRoutes: current.domainRoutes.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, provider } : row
                          ),
                        }));
                      }}
                    >
                      <option value='google'>Google OIDC</option>
                      <option value='microsoft'>Microsoft OIDC</option>
                    </Select>
                  </label>
                  <div class='flex items-end'>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={() => {
                        setForm((current) => ({
                          ...current,
                          domainRoutes: current.domainRoutes.filter((_, rowIndex) =>
                            rowIndex !== index
                          ),
                        }));
                      }}
                      aria-label={i18n.t('settings.sso.routes.removeFor', {
                        domain: domain ?? i18n.t('settings.sso.routes.invalidDomain'),
                      })}
                    >
                      {i18n.t('settings.sso.routes.remove')}
                    </Button>
                  </div>
                </div>
                <div class='space-y-2 text-sm'>
                  <div class={verified ? 'text-success' : 'text-base-content/70'}>
                    {verified
                      ? i18n.rich('settings.sso.routes.verified', {
                        date: formatVerifiedAt(verification?.verifiedAt, i18n),
                      })
                      : i18n.t('settings.sso.routes.notVerified')}
                  </div>
                  {verification && (
                    <div class='space-y-1 text-base-content/70'>
                      <div>
                        {i18n.t('settings.sso.routes.dnsTxt')}{' '}
                        <code>{verification.expectedDnsTxt}</code>
                      </div>
                      <div>
                        {i18n.t('settings.sso.routes.httpsPath')}{' '}
                        <code>{verification.httpsVerificationUrl}</code>
                      </div>
                    </div>
                  )}
                  <div class='flex flex-wrap gap-2'>
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => runDomainVerificationAction(route.domain, 'prepare')}
                      disabled={verificationSavingDomain !== null &&
                        verificationSavingDomain === domain}
                      aria-label={i18n.t('settings.sso.routes.prepareFor', {
                        domain: domain ?? i18n.t('settings.sso.routes.invalidDomain'),
                      })}
                    >
                      {i18n.t('settings.sso.routes.prepare')}
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => runDomainVerificationAction(route.domain, 'verify_dns')}
                      disabled={verificationSavingDomain !== null &&
                        verificationSavingDomain === domain}
                      aria-label={i18n.t('settings.sso.routes.verifyDnsFor', {
                        domain: domain ?? i18n.t('settings.sso.routes.invalidDomain'),
                      })}
                    >
                      {i18n.t('settings.sso.routes.verifyDns')}
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => runDomainVerificationAction(route.domain, 'verify_https')}
                      disabled={verificationSavingDomain !== null &&
                        verificationSavingDomain === domain}
                      aria-label={i18n.t('settings.sso.routes.verifyHttpsFor', {
                        domain: domain ?? i18n.t('settings.sso.routes.invalidDomain'),
                      })}
                    >
                      {i18n.t('settings.sso.routes.verifyHttps')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          <div>
            <Button
              type='button'
              onClick={() => {
                setForm((current) => ({
                  ...current,
                  domainRoutes: [...current.domainRoutes, { domain: '', provider: 'google' }],
                }));
              }}
            >
              {i18n.t('settings.sso.routes.add')}
            </Button>
          </div>
        </div>
      </div>
      <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
        <Button variant='primary' type='submit' disabled={loading || saving}>
          {saving ? i18n.t('settings.sso.savingPolicy') : i18n.t('settings.sso.save')}
        </Button>
      </div>
    </form>
  );
}
