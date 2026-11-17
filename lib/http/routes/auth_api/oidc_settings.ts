import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { projectOidcSettingsResponse } from '../../oidc_settings_contract.ts';
import {
  listOidcTenantConfigs,
  OidcTenantConfigError,
  type OidcTenantConfigInput,
  updateOidcTenantConfigs,
} from '../../../services/oidc_tenant_configs.ts';
import { OIDC_PROVIDER_IDS, type OidcProviderId } from '../../../oidc_provider.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { redact, type Redacted } from '../../../redacted.ts';
import { requireRole } from '../../../services/roles.ts';
import { requireAuthContext } from '../../../tenants.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadConfigs(tenantId: string) {
  return projectOidcSettingsResponse(await listOidcTenantConfigs(tenantId));
}

function parseInput(
  payload: unknown,
): Partial<Record<OidcProviderId, OidcTenantConfigInput>> | null {
  if (!isRecord(payload)) return null;
  if (Object.keys(payload).some((key) => !OIDC_PROVIDER_IDS.some((provider) => provider === key))) {
    return null;
  }
  const out: Partial<Record<OidcProviderId, OidcTenantConfigInput>> = {};
  for (const provider of OIDC_PROVIDER_IDS) {
    const value = payload[provider];
    if (value === undefined) continue;
    if (!isRecord(value)) return null;
    const parsed = parseProviderInput(value);
    if (!parsed) return null;
    out[provider] = parsed;
  }
  return Object.keys(out).length ? out : null;
}

const OIDC_INPUT_FIELDS = new Set([
  'enabled',
  'clientId',
  'clientSecret',
  'microsoftTenant',
]);

function parseProviderInput(row: Record<string, unknown>): OidcTenantConfigInput | null {
  const keys = Object.keys(row);
  if (!keys.length || keys.some((key) => !OIDC_INPUT_FIELDS.has(key))) return null;
  const input: {
    enabled?: boolean;
    clientId?: string | null;
    clientSecret?: Redacted<string> | null;
    microsoftTenant?: string | null;
  } = {};
  if (Object.hasOwn(row, 'enabled')) {
    if (typeof row.enabled !== 'boolean') return null;
    input.enabled = row.enabled;
  }
  if (Object.hasOwn(row, 'clientId')) {
    if (row.clientId !== null && typeof row.clientId !== 'string') return null;
    input.clientId = row.clientId;
  }
  if (Object.hasOwn(row, 'clientSecret')) {
    if (row.clientSecret === null) input.clientSecret = null;
    else if (typeof row.clientSecret === 'string' && row.clientSecret.trim()) {
      input.clientSecret = redact(row.clientSecret);
    } else return null;
  }
  if (Object.hasOwn(row, 'microsoftTenant')) {
    if (row.microsoftTenant !== null && typeof row.microsoftTenant !== 'string') return null;
    input.microsoftTenant = row.microsoftTenant;
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const oidcSettingsAuthRoute = defineHttpRoute('/api/sso/oidc', {
  GET: read,
  PATCH: write,
});

async function read(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const denied = requireRole('admin', auth.role, ctx.req);
  if (denied) return denied;
  const configs = await loadConfigs(auth.tenantId);
  return json(configs);
}

async function write(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const denied = requireRole('admin', auth.role, ctx.req);
  if (denied) return denied;
  const payload = await ctx.req.json().catch(() => null);
  const input = parseInput(payload);
  if (!input) return json({ error: 'Invalid payload.', code: 'invalid_payload' }, 400);
  try {
    const configs = await updateOidcTenantConfigs(auth.tenantId, input, ctx.runtime);
    return json(projectOidcSettingsResponse(configs));
  } catch (cause: unknown) {
    if (cause instanceof OidcTenantConfigError) {
      return json({ error: cause.message, code: 'invalid_oidc_configuration' }, 400);
    }
    console.error(JSON.stringify({
      event: 'oidc_settings_update_failed',
      tenantId: auth.tenantId,
      cause: safeErrorSummary(cause),
    }));
    return json({ error: 'Unable to save OIDC settings.', code: 'oidc_update_failed' }, 500);
  }
}
