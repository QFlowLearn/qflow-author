import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { enrichmentPageServices } from '../../bank_enrichment.ts';
import { parseBankProposalCommand } from '../../../bank_question_proposal.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isCanonicalUuid } from '../../../uuid.ts';

export const proposalsApiRoute = defineHttpRoute('/api/assessments/:id/question-proposals', {
  POST: handlePOST,
});

async function handlePOST(ctx: HttpRequest) {
  const command = parseBankProposalCommand(await ctx.req.json().catch(() => null));
  if (!command || !isCanonicalUuid(ctx.params.id)) {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }
  const result = await enrichmentPageServices(ctx).questionProposals.run(
    requireAuthContext(ctx.state),
    ctx.params.id,
    command,
  );
  if (!result.ok) {
    const status = {
      invalid_input: 400,
      scheme_required: 400,
      category_required: 400,
      unsupported_selection: 409,
      forbidden: 403,
      not_found: 404,
      storage_failed: 503,
    };
    return Response.json({ error: result.code }, { status: status[result.code] });
  }
  return Response.json(result.value);
}
