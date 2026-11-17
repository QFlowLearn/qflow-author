import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { draftRequestJson, parseRevisionPublishRequest } from '../../../draft_request.ts';
import { parseDraftSessionId } from '../../../draft_session_id.ts';
import { publishHttpResponse } from '../../../services/publish.ts';
import { publishRevisionDraft } from '../../../services/revision_draft_publication.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared bank API endpoint contract and implementation. */
export const publishRevisionBankRoute = defineHttpRoute('/api/drafts/:id/publish', {
  'POST': handle,
});

async function handle(ctx: HttpRequest) {
  const draftSessionId = parseDraftSessionId(ctx.params.id);
  if (!draftSessionId) {
    return draftRequestJson({
      code: 'invalid_session',
      message: 'The working draft identifier is invalid.',
    });
  }
  const input: unknown = await ctx.req.json().catch(() => null);
  const parsed = parseRevisionPublishRequest(input);
  if (!('draft' in parsed)) return draftRequestJson(parsed, 400, []);
  const result = await publishRevisionDraft(requireAuthContext(ctx.state), {
    draftSessionId,
    sourceRevisionId: parsed.sourceRevisionId,
    draft: parsed.draft,
  });
  return publishHttpResponse(result);
}
