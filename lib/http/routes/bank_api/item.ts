import { getQuestionRevision } from '../../../services/questions.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared bank API endpoint contract and implementation. */
export const itemBankRoute = defineHttpRoute('/api/items/:id', { '*': handle });

async function handle(ctx: HttpRequest) {
  const { params } = ctx;
  const id = params.id;
  const auth = requireAuthContext(ctx.state);
  const revision = await getQuestionRevision(auth, id);
  if (!revision) return new Response('Not Found', { status: 404 });

  return new Response(
    JSON.stringify({
      id,
      xml: revision.qtiXml,
      title: typeof revision.body?.title === 'string' ? revision.body.title : null,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
