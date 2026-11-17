import { validateQtiXml } from '../../../qti_validate.ts';
import { toFieldIssues } from '../../../validation_fields.ts';
import { getQuestionMeta, getQuestionRevision } from '../../../services/questions.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

// Validate a single item snapshot XML with the runtime XML parser.
// GET /api/items/:id/validate[?rev=number]
// Response: { ok: boolean, errors?: Array<{ line: number, col: number, message: string }> }

/** Shared bank API endpoint contract and implementation. */
export const validateBankRoute = defineHttpRoute('/api/items/:id/validate', { '*': handle });

async function handle(ctx: HttpRequest) {
  const { params, url } = ctx;
  const { id } = params;
  const auth = requireAuthContext(ctx.state);
  const revParam = url.searchParams.get('rev');
  let rev: number | undefined = revParam ? Number(revParam) : undefined;

  // resolve revision
  if (rev == null) {
    const meta = await getQuestionMeta(auth, id);
    rev = meta?.latestRevision ?? 1;
  }
  const revision = await getQuestionRevision(auth, id, rev);
  const xml = revision?.qtiXml;
  if (!xml) {
    return new Response(
      JSON.stringify({
        ok: false,
        errors: [{ line: 0, col: 0, message: `Missing XML for item ${id} r${rev}` }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  const result = await validateQtiXml(xml);
  const payload = result.ok ? result : { ...result, issues: toFieldIssues(result.errors) };
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}
