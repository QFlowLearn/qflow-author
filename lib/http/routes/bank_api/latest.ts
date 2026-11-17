import { getQuestionMeta, getQuestionRevision } from '../../../services/questions.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared bank API endpoint contract and implementation. */
export const latestBankRoute = defineHttpRoute('/api/items/:id/latest', { '*': handle });

async function handle(ctx: HttpRequest) {
  const { params } = ctx;
  const id = params.id;
  const auth = requireAuthContext(ctx.state);
  const meta = await getQuestionMeta(auth, id);
  if (!meta) return new Response('Not Found', { status: 404 });
  const latestRev = meta.latestRevision;
  const revision = await getQuestionRevision(auth, id, latestRev);
  return new Response(
    JSON.stringify({
      id,
      latestRev,
      title: meta.title,
      xml: revision?.qtiXml ?? null,
      draft: revision?.body ?? null,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
