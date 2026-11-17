import { parseBankSelectionCommand } from '../../../assessment_bank_selection.ts';
import { appendBankSelection } from '../../../services/assessment_bank_selection.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isCanonicalUuid } from '../../../uuid.ts';

export const placementsApiRoute = defineHttpRoute('/api/assessments/:id/placements', {
  POST: handlePOST,
});

async function handlePOST(ctx: HttpRequest) {
  const input: unknown = await ctx.req.json().catch(() => null);
  const command = parseBankSelectionCommand(input);
  if (!command || !isCanonicalUuid(ctx.params.id)) {
    return Response.json({ error: 'invalid_selection' }, { status: 400 });
  }
  const result = await appendBankSelection(
    requireAuthContext(ctx.state),
    ctx.params.id,
    command,
  );
  if (!result.ok) {
    const status = {
      forbidden: 403,
      not_found: 404,
      unavailable: 409,
      conflict: 409,
      unsupported_selection: 409,
      storage_failed: 503,
    };
    return Response.json({ error: result.code }, { status: status[result.code] });
  }
  return Response.json(result.value, { status: 201 });
}
