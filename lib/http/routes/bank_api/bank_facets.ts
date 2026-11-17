import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { enrichmentPageServices } from '../../bank_enrichment.ts';
import {
  parseQuestionBankFilterForm,
  parseQuestionBankQuery,
  QuestionBankInputError,
} from '../../../services/question_bank_query.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** A bounded, authorized facet refresh using the question bank's exact count queries. */
const methods = {
  async GET(ctx: HttpRequest) {
    const auth = requireAuthContext(ctx.state);
    let query;
    try {
      const submitted = parseQuestionBankFilterForm(ctx.url.searchParams);
      query = parseQuestionBankQuery(submitted ?? ctx.url.searchParams);
    } catch (cause: unknown) {
      if (cause instanceof QuestionBankInputError) {
        return Response.json({ error: 'invalid_query' }, { status: 400 });
      }
      throw cause;
    }
    const result = await enrichmentPageServices(ctx).browse.read(auth, query, []);
    if (!result.ok) {
      const status = { forbidden: 403, not_found: 404, invalid_input: 400, storage_failed: 503 };
      return Response.json({ error: result.code }, { status: status[result.code] });
    }
    return Response.json(result.value);
  },
};

export const bankFacetsRoute = defineHttpRoute('/api/items/facets', {
  GET: methods.GET,
  HEAD: methods.GET,
});
