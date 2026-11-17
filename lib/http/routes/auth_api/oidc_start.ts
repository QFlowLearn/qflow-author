import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import type { LoginErrorCode } from '../../auth_feedback.ts';
import { buildOidcAuthorizationUrl } from '../../../oidc_protocol.ts';
import {
  createOidcLoginState,
  getOidcProviderConfigForPublicLogin,
  getOidcProviderConfigForTenant,
} from '../../../services/oidc.ts';
import { parseAuthReturnPath } from '../../auth_return_path.ts';
import { resolveTenantIdForHost } from '../../../services/tenants.ts';

/** Shared HTTP contract and implementation for this authentication endpoint. */
export const oidcStartAuthRoute = defineHttpRoute('/auth/oidc/:provider', { 'GET': handle });

function redirectWithError(url: URL, code: LoginErrorCode): Response {
  const redirect = new URL('/login', url.origin);
  redirect.searchParams.set('error', code);
  const next = parseAuthReturnPath(url.searchParams.get('next'));
  if (next) redirect.searchParams.set('next', next);
  return new Response(null, {
    status: 302,
    headers: { location: redirect.pathname + redirect.search },
  });
}

async function handle(ctx: HttpRequest) {
  try {
    const provider = ctx.params.provider;
    const hostTenantId = await resolveTenantIdForHost(ctx.url.hostname);
    const publicProvider = hostTenantId
      ? null
      : await getOidcProviderConfigForPublicLogin(provider, ctx.runtime);
    const tenantId = hostTenantId ?? publicProvider?.tenantId ?? null;
    const config = hostTenantId
      ? await getOidcProviderConfigForTenant(hostTenantId, provider, ctx.runtime)
      : publicProvider?.config ?? null;
    if (!tenantId || !config) return new Response('Provider not configured.', { status: 404 });

    const url = ctx.url;
    const next = parseAuthReturnPath(url.searchParams.get('next'));

    const loginState = await createOidcLoginState({
      tenantId,
      provider: config.id,
      redirectPath: next,
    });

    const redirectUri = new URL('/auth/oidc/callback', ctx.url).toString();
    const authUrl = buildOidcAuthorizationUrl({
      config,
      state: loginState.state,
      nonce: loginState.nonce,
      redirectUri,
    });

    return new Response(null, { status: 302, headers: { location: authUrl } });
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'oidc_login_start_error',
      provider: ctx.params.provider,
      hostname: ctx.url.hostname,
      cause: safeErrorSummary(cause),
    }));
    return redirectWithError(ctx.url, 'sign_in_unavailable');
  }
}
