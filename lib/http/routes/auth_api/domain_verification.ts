import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import {
  type DomainVerificationAction,
  domainVerificationFailureCode,
  parseDomainVerificationCommand,
  projectDomainVerificationResponse,
} from '../../sso_settings_contract.ts';
import {
  DomainOwnershipVerificationError,
  type DomainVerificationMethod,
  ensureDomainVerificationChallenge,
  listDomainVerificationsForTenant,
  verifyDomainOwnership,
} from '../../../services/domain_verification.ts';
import { requireRole } from '../../../services/roles.ts';
import { requireAuthContext } from '../../../tenants.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toMethod(action: DomainVerificationAction): DomainVerificationMethod {
  return action === 'verify_https' ? 'https' : 'dns';
}

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const domainVerificationAuthRoute = defineHttpRoute('/api/sso/domain-verification', {
  GET: read,
  PATCH: write,
  PUT: write,
});

async function read(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const denied = requireRole('admin', auth.role, ctx.req);
  if (denied) return denied;
  const records = await listDomainVerificationsForTenant(auth.tenantId);
  return json({ domains: records.map(projectDomainVerificationResponse) });
}

async function write(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const denied = requireRole('admin', auth.role, ctx.req);
  if (denied) return denied;
  const payload = await ctx.req.json().catch(() => null);
  const input = parseDomainVerificationCommand(payload);
  if (!input) return json({ error: 'Invalid payload.', code: 'invalid_payload' }, 400);
  try {
    const record = input.action === 'prepare'
      ? await ensureDomainVerificationChallenge(auth.tenantId, input.domain)
      : await verifyDomainOwnership(
        auth.tenantId,
        input.domain,
        toMethod(input.action),
        { signal: ctx.req.signal },
      );
    return json({ record: projectDomainVerificationResponse(record) });
  } catch (cause: unknown) {
    if (cause instanceof DomainOwnershipVerificationError) {
      return json({
        error: cause.message,
        code: domainVerificationFailureCode(toMethod(input.action)),
        params: { domain: input.domain },
      }, 422);
    }
    console.error(JSON.stringify({
      event: 'sso_domain_verification_failed',
      tenantId: auth.tenantId,
      domain: input.domain,
      action: input.action,
      cause: safeErrorSummary(cause),
    }));
    return json({ error: 'Unable to verify domain.', code: 'domain_verification_failed' }, 500);
  }
}
