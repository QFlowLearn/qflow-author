import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { getAuthenticatedAccount } from '../../../services/account.ts';
import { requireAuthContext } from '../../../tenants.ts';

async function handle(ctx: HttpRequest): Promise<Response> {
  const auth = requireAuthContext(ctx.state);
  const account = await getAuthenticatedAccount(auth);
  if (!account) return new Response('Not Found', { status: 404 });

  const payload = {
    user: account.user,
    tenant: account.tenant,
    role: account.role,
  };

  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

export const meRoute = defineHttpRoute('/api/me', { '*': handle });
