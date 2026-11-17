import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { enrichmentPageServices } from '../../bank_enrichment.ts';
import { listBankCollections } from '../../../services/bank_collections.ts';
import type { LibrarySearch } from '../../../question_bank_picker.ts';
import {
  parseQuestionBankPickerQuery,
  QuestionBankInputError,
} from '../../../services/question_bank_query.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const bankSearchApiRoute = defineHttpRoute('/api/items/search', {
  GET: handleGET,
  HEAD: handleGET,
});

async function handleGET(ctx: HttpRequest) {
  let query;
  try {
    query = parseQuestionBankPickerQuery(ctx.url.searchParams);
  } catch (cause: unknown) {
    if (cause instanceof QuestionBankInputError) {
      return Response.json({ error: 'invalid_query', message: cause.message }, { status: 400 });
    }
    throw cause;
  }
  const auth = requireAuthContext(ctx.state);
  const [result, collections] = await Promise.all([
    enrichmentPageServices(ctx).browse.page(auth, query, {
      locale: ctx.state.interfaceLocale,
      typeLabel: (type) => ctx.state.i18n.t('assessments.builder.questionTypeLabel', { type }),
    }),
    listBankCollections(auth),
  ]);
  if (!collections.ok) return Response.json({ error: collections.code }, { status: 403 });
  if (!result.ok) {
    const status = { forbidden: 403, not_found: 404, invalid_input: 400, storage_failed: 503 };
    return Response.json({ error: result.code }, { status: status[result.code] });
  }
  const { bank: page, enrichment } = result.value;
  return Response.json(
    {
      items: page.items.map((item) => ({
        id: item.id,
        title: item.title,
        excerpt: item.excerpt ?? '',
        tags: item.tags,
        latestRev: item.revision,
        updatedAt: item.updatedAt,
        type: item.type,
      })),
      hasMore: page.page < page.pageCount,
      total: page.total,
      enrichment,
      collections: collections.collections.map(({ id, name }) => ({ id, name })),
    } satisfies LibrarySearch,
  );
}
