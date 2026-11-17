import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import {
  parseSsoPolicySettingsUpdate,
  projectSsoPolicySettingsResponse,
} from '../../sso_settings_contract.ts';
import {
  getTenantSsoSettings,
  SsoPolicyInputError,
  upsertTenantSsoSettings,
} from '../../../services/sso_policy.ts';
import { requireRole } from '../../../services/roles.ts';
import { requireAuthContext } from '../../../tenants.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const ssoPolicyAuthRoute = defineHttpRoute('/api/sso/policy', {
  GET: read,
  PATCH: write,
  PUT: write,
});

async function read(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const denied = requireRole('admin', auth.role, ctx.req);
  if (denied) return denied;
  const settings = await getTenantSsoSettings(auth.tenantId);
  return json(projectSsoPolicySettingsResponse(settings));
}

async function write(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const denied = requireRole('admin', auth.role, ctx.req);
  if (denied) return denied;
  const payload = await ctx.req.json().catch(() => null);
  const input = parseSsoPolicySettingsUpdate(payload);
  if (!input) return json({ error: 'Invalid payload.', code: 'invalid_payload' }, 400);
  try {
    const settings = await upsertTenantSsoSettings(auth.tenantId, input);
    return json(projectSsoPolicySettingsResponse(settings));
  } catch (cause: unknown) {
    if (cause instanceof SsoPolicyInputError) {
      return json({ error: cause.message, code: 'invalid_policy_configuration' }, 400);
    }
    console.error(JSON.stringify({
      event: 'sso_policy_update_failed',
      tenantId: auth.tenantId,
      cause: safeErrorSummary(cause),
    }));
    return json({
      error: 'Unable to save SSO policy settings.',
      code: 'policy_update_failed',
    }, 500);
  }
}
