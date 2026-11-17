import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { draftRequestJson, parseBankDraftPublishRequest } from '../../../draft_request.ts';
import { parseDraftSessionId } from '../../../draft_session_id.ts';
import { publishHttpResponse } from '../../../services/publish.ts';
import { publishBankDraft } from '../../../services/bank_drafts.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared bank API endpoint contract and implementation. */
export const createQuestionBankRoute = defineHttpRoute('/api/drafts/:id/create-question', {
  'POST': handle,
});

async function handle(ctx: HttpRequest) {
  const id = parseDraftSessionId(ctx.params.id);
  if (!id) return new Response(null, { status: 404 });
  const parsed = parseBankDraftPublishRequest(await ctx.req.json().catch(() => null));
  if (!('draft' in parsed)) return draftRequestJson(parsed);
  return publishHttpResponse(
    await publishBankDraft(requireAuthContext(ctx.state), { id, draft: parsed.draft }),
  );
}
