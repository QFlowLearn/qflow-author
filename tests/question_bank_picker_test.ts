import { expect, test as testCase } from 'vitest';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { parseLibrarySearchResponse } from '../lib/question_bank_picker.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import { BankEnrichmentBrowse } from '../lib/services/bank_enrichment_browse.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { applyQuestionBankBulkCommand } from '../lib/services/question_bank_bulk.ts';
import {
  parseQuestionBankPickerQuery,
  parseQuestionBankQuery,
} from '../lib/services/question_bank_query.ts';
import { bankSearchApiRoute as handlerEndpoint } from '../lib/http/routes/assessment_api/bank_search.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';

const handler = handlerEndpoint.handle;

async function search(ctx: RequestContext, params: URLSearchParams) {
  return await invokeHttpMethod(
    handler,
    'GET',
    makeHttpRequest(
      new Request(`http://local/api/items/search?${params}`),
      {
        auth: ctx,
        state: {
          interfaceLocale: 'en-US' as const,
          i18n: createI18n('en-US', catalogForLocale('en-US')),
        },
      },
    ),
  );
}

testCase('picker shares bank selection parsing and can address the entire large bank', () => {
  const params = new URLSearchParams({
    q: ' cell ',
    tags: 'ARC,science',
    collection: crypto.randomUUID(),
    scheme: crypto.randomUUID(),
    topic: `${crypto.randomUUID()}:cells`,
    difficulty: 'unassigned',
  });
  expect(parseQuestionBankPickerQuery(params)).toStrictEqual({
    ...parseQuestionBankQuery(params),
    pageSize: 10,
  });
  expect(parseQuestionBankPickerQuery(new URLSearchParams('page=779')).page).toStrictEqual(779);
  const bounded = parseQuestionBankPickerQuery(new URLSearchParams('page=10000&pageSize=50'));
  expect([bounded.page, bounded.pageSize]).toStrictEqual([10_000, 50]);
  for (
    const raw of [
      'scheme=bad',
      'subject=outside',
      'collection=bad',
      'scheme=&scheme=',
      'page=1e30',
      'page=-1',
      'page=0',
      'page=1.5',
      'page=10001',
      'page=1&page=2',
      'pageSize=0',
      'pageSize=51',
      'pageSize=10&pageSize=20',
      'limit=10',
      'offset=0',
      'view=overview',
    ]
  ) {
    expect(() => parseQuestionBankPickerQuery(new URLSearchParams(raw))).toThrowError(Error);
  }
});

testCase(
  'bank duplicate counts include active matches and allow zero for archived questions',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const ids = await addEnrichmentQuestions(ctx, 2);
        const query = parseQuestionBankQuery(new URLSearchParams('lifecycle=archived'));
        const browse = new BankEnrichmentBrowse(db);
        if (
          !((await applyQuestionBankBulkCommand(ctx, {
            _tag: 'Archive',
            questionIds: [ids[0]],
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await applyQuestionBankBulkCommand(ctx, { _tag: 'Archive', questionIds: [ids[0]], })).ok",
          );
        }
        const archived = await browse.page(ctx, query, { locale: 'en-US' });
        if (!(archived.ok && archived.value.kind === 'questions')) {
          expect.unreachable("Expected archived.ok && archived.value.kind === 'questions'");
        }
        expect(archived.value.bank.items.map((item) => [item.id, item.duplicateCount]))
          .toStrictEqual([
            [ids[0], 0],
          ]);
        const active = await browse.page(ctx, parseQuestionBankPickerQuery(new URLSearchParams()), {
          locale: 'en-US',
        });
        if (!(active.ok)) expect.unreachable('Expected active.ok');
        // This access also verifies the questions-only query preserves its result type.
        expect(active.value.bank.items.map((item) => [item.id, item.duplicateCount])).toStrictEqual(
          [
            [ids[1], 1],
          ],
        );
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'picker API matches bank membership, versioned categories, counts and authorization',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const ids = await addEnrichmentQuestions(ctx, 24);
        const schemeId = crypto.randomUUID(), versionId = crypto.randomUUID();
        const store = new BankEnrichmentStore(db, () => new Date());
        if (
          !((await store.saveVersion(ctx, {
            id: versionId,
            schemeId,
            expectedVersion: 0,
            definition: enrichmentDefinitionFixture(),
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { id: versionId, schemeId, expectedVersion: 0, definition: e',
          );
        }
        await assignOverviewFixture(ctx, schemeId, versionId, ids.slice(0, 20), {
          subject: { state: 'assigned', valueIds: ['life'] },
          topic: { state: 'assigned', valueIds: ['cells'] },
          difficulty: { state: 'assigned', valueIds: ['moderate'] },
        });
        await assignOverviewFixture(ctx, schemeId, versionId, [ids[20]], {
          difficulty: { state: 'unassigned', reason: 'insufficient_context' },
        });
        const v2 = crypto.randomUUID();
        if (
          !((await store.saveVersion(ctx, {
            id: v2,
            schemeId,
            expectedVersion: 1,
            definition: { ...enrichmentDefinitionFixture(), audience: 'Advanced students' },
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { id: v2, schemeId, expectedVersion: 1, definition: { ...enr',
          );
        }
        await assignOverviewFixture(ctx, schemeId, v2, [ids[0]], {
          difficulty: { state: 'assigned', valueIds: ['hard'] },
        });
        const collectionId = crypto.randomUUID();
        try {
          if (
            !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
              _tag: 'Create',
              collectionId,
              name: 'Cell bank',
              description: '',
              position: 0,
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'Create', collectionId",
            );
          }
          if (
            !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
              _tag: 'AddItems',
              collectionId,
              questionIds: ids.slice(0, 16),
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'AddItems', collection",
            );
          }
          const filterCases: Record<string, string>[] = [
            {},
            { collection: collectionId },
            { collection: 'unfiled' },
            { scheme: schemeId },
            {
              scheme: schemeId,
              collection: collectionId,
              subject: `${versionId}:life`,
              topic: `${versionId}:cells`,
              difficulty: `${versionId}:moderate`,
              q: 'Cell',
              tags: 'source-science',
            },
            { scheme: schemeId, difficulty: `${v2}:hard` },
            { scheme: schemeId, difficulty: 'unassigned' },
            { scheme: schemeId, difficulty: 'outside' },
            { scheme: schemeId, difficulty: 'pending' },
            { scheme: schemeId, difficulty: 'outdated' },
          ];
          for (const filters of filterCases) {
            const params = new URLSearchParams(filters);
            const bank = await new BankEnrichmentBrowse(db).page(
              ctx,
              parseQuestionBankQuery(params),
              { locale: 'en-US' },
            );
            if (!(bank.ok && bank.value.kind === 'questions')) {
              expect.unreachable("Expected bank.ok && bank.value.kind === 'questions'");
            }
            const found: string[] = [];
            let hasMore = true;
            for (let pageNumber = 1; hasMore; pageNumber++) {
              const pageParams = new URLSearchParams(params);
              pageParams.set('page', String(pageNumber));
              const response = await search(ctx, pageParams);
              expect(response.status).toStrictEqual(200);
              const raw = await response.json();
              const page = parseLibrarySearchResponse(raw);
              if (!page) expect.unreachable('The HTTP result must satisfy the browser contract');
              expect(page.total).toStrictEqual(bank.value.bank.total);
              expect(page.collections).toStrictEqual([{ id: collectionId, name: 'Cell bank' }]);
              expect(page.enrichment.selection?.facets).toStrictEqual(
                bank.value.enrichment.selection?.facets,
              );
              if (page.enrichment.selection) {
                for (const item of page.items) {
                  expect(page.enrichment.selection.rows[item.id]).toStrictEqual(
                    bank.value.enrichment.selection?.rows[item.id],
                  );
                }
                expect(parseLibrarySearchResponse({
                  ...raw,
                  enrichment: {
                    ...raw.enrichment,
                    selection: { ...raw.enrichment.selection, rows: {} },
                  },
                })).toStrictEqual(page.items.length ? null : page);
              }
              found.push(...page.items.map((item) => item.id));
              hasMore = page.hasMore;
            }
            expect(found).toStrictEqual(bank.value.bank.items.map((item) => item.id));
          }
          const unknown = await search(
            ctx,
            new URLSearchParams({ scheme: schemeId, topic: `${v2}:not_configured` }),
          );
          expect(unknown.status).toStrictEqual(400);
          await withEnrichmentWorkspace(async (other) => {
            expect((await search(other, new URLSearchParams({ scheme: schemeId }))).status)
              .toStrictEqual(404);
            const response = await search(other, new URLSearchParams({ collection: collectionId }));
            const page = parseLibrarySearchResponse(await response.json());
            if (!page) expect.unreachable('Expected page');
            expect(page.total).toStrictEqual(0);
            expect(page.collections).toStrictEqual([]);
          });
          expect(
            (await search({ ...ctx, userId: crypto.randomUUID() }, new URLSearchParams())).status,
          ).toStrictEqual(403);
        } finally {
          await db.delete(bankCollectionItems).where(
            eq(bankCollectionItems.tenantId, ctx.tenantId),
          );
          await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, ctx.tenantId));
          await db.delete(bankCollections).where(eq(bankCollections.tenantId, ctx.tenantId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'picker pagination reaches records beyond 5000 without loading earlier pages',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const [sourceId] = await addEnrichmentQuestions(ctx, 1);
        const [source] = await db.select().from(questionRevisions).where(
          eq(questionRevisions.questionId, sourceId),
        );
        // Bulk persistence fixture: copies of one real published question, with independent identities.
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`INSERT INTO questions (id, tenant_id, stable_key, title, owner_user_id, lifecycle_state)
          SELECT gen_random_uuid(), ${ctx.tenantId}, 'picker-' || n, 'Page fixture ' || n,
            ${ctx.userId}, 'active' FROM generate_series(1, 5011) n`,
          );
          await tx.execute(
            sql`INSERT INTO question_revisions (id, question_id, tenant_id, draft_state, revision,
          body, review_suggestions, provenance, content_hash, search_text, compatibility, qti_xml, published_at)
          SELECT gen_random_uuid(), id, tenant_id, 'published', 1, ${
            JSON.stringify(source.body)
          }::jsonb,
            '[]'::jsonb, ${JSON.stringify(source.provenance)}::jsonb, ${source.contentHash},
            title, ${JSON.stringify(source.compatibility)}::jsonb, ${source.qtiXml}, now()
          FROM questions WHERE tenant_id = ${ctx.tenantId} AND id <> ${sourceId}`,
          );
          await tx.execute(
            sql`UPDATE questions q SET latest_revision_id = r.id FROM question_revisions r
          WHERE q.id = r.question_id AND q.tenant_id = ${ctx.tenantId}`,
          );
        });
        const penultimate = await search(ctx, new URLSearchParams('page=501'));
        const page = parseLibrarySearchResponse(await penultimate.json());
        if (!page) expect.unreachable('Expected page');
        expect(page.total).toStrictEqual(5012);
        expect(page.items.length).toStrictEqual(10);
        if (!(page.hasMore)) expect.unreachable('Expected page.hasMore');
        const last = parseLibrarySearchResponse(
          await (await search(ctx, new URLSearchParams('page=502'))).json(),
        );
        if (!last) expect.unreachable('Expected last');
        expect(last.items.length).toStrictEqual(2);
        expect(last.hasMore).toStrictEqual(false);
        expect(new Set([...page.items, ...last.items].map((item) => item.id)).size).toStrictEqual(
          12,
        );
        const bankPage = await listQuestionBank(
          ctx,
          parseQuestionBankQuery(new URLSearchParams('page=501&pageSize=10')),
        );
        expect(bankPage.items.map((item) => item.duplicateCount)).toStrictEqual(
          new Array(10).fill(5012),
        );
        expect(
          (await db.select({ id: questions.id }).from(questions).where(
            eq(questions.tenantId, ctx.tenantId),
          )).length,
        ).toStrictEqual(5012);
      });
    } finally {
      await shutdownDb();
    }
  },
);
