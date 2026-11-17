import { getQuestionMeta } from '../../../services/questions.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared bank API endpoint contract and implementation. */
export const metaBankRoute = defineHttpRoute('/api/items/:id/meta', { GET: handleGET });

async function handleGET(ctx: HttpRequest) {
  const { params } = ctx;
  const id = params.id;
  const auth = requireAuthContext(ctx.state);
  const meta = await getQuestionMeta(auth, id);
  if (!meta) return new Response('Not Found', { status: 404 });
  return new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } });
}
