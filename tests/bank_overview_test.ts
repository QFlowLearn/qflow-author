import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import { questionRevisions } from '../lib/db/question_schema.ts';
import { bankEnrichmentStatusFilter } from '../lib/services/bank_enrichment_query.ts';
import { questionBankGroupHref, questionBankHref } from '../lib/question_bank_link.ts';
import { BankEnrichmentBrowse } from '../lib/services/bank_enrichment_browse.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { parseEnrichmentDefinition } from '../lib/services/bank_enrichment_contract.ts';
import { parseEnrichmentScope } from '../lib/services/bank_enrichment_scope_contract.ts';
import {
  parseQuestionBankQuery,
  type QuestionBankQuery,
} from '../lib/services/question_bank_query.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';

testCase(
  'overview navigation validates views, preserves filters, and captures only selection',
  () => {
    const scheme = crypto.randomUUID(), version = crypto.randomUUID();
    const query = parseQuestionBankQuery(
      new URLSearchParams(
        `view=overview&scheme=${scheme}&subject=${version}:life&q=cell&tags=science&sort=title&direction=asc&page=2`,
      ),
    );
    expect(
      parseQuestionBankQuery(new URL(questionBankHref(query, 2), 'https://qflow.test').searchParams)
        .view,
    ).toStrictEqual('overview');
    const scope = parseEnrichmentScope({
      _tag: 'Filtered',
      queryString: questionBankHref(query, 2).split('?')[1],
    });
    if (!(scope?._tag === 'Filtered')) expect.unreachable("Expected scope?._tag === 'Filtered'");
    expect(scope.query.view).toStrictEqual(undefined);
    expect(scope.query.enrichment).toStrictEqual(query.enrichment);
    for (const raw of ['view=bad', 'view=overview&view=questions']) {
      expect(() => parseQuestionBankQuery(new URLSearchParams(raw))).toThrowError(Error);
    }
    const narrowed = parseQuestionBankQuery(
      new URL(
        questionBankGroupHref(query, { subject: { kind: 'unconstrained', freshness: 'outdated' } }),
        'https://qflow.test',
      )
        .searchParams,
    );
    expect(narrowed.view).toStrictEqual(undefined);
    expect(narrowed.page).toStrictEqual(1);
    expect(narrowed.enrichment?.subject).toStrictEqual({
      kind: 'value',
      versionId: version,
      valueId: 'life',
      freshness: 'outdated',
    });
    expect(narrowed.search).toStrictEqual('cell');
    expect(narrowed.tags).toStrictEqual(['science']);
  },
);

testCase(
  'overview partitions the full selection and every drill-down agrees with bank results',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        try {
          const ids = await addEnrichmentQuestions(ctx, 108);
          const schemeId = crypto.randomUUID(), v1 = crypto.randomUUID(), v2 = crypto.randomUUID();
          const store = new BankEnrichmentStore(db, () => new Date());
          const definition = parseEnrichmentDefinition({
            ...enrichmentDefinitionFixture(),
            topics: [
              ...enrichmentDefinitionFixture().topics,
              {
                id: 'genetics',
                subjectId: 'life',
                label: 'Genetics',
                definition: 'Inherited traits.',
              },
            ],
          });
          if (!definition) expect.unreachable('Expected definition');
          if (
            !((await store.saveVersion(ctx, { id: v1, schemeId, expectedVersion: 0, definition }))
              .ok)
          ) {
            expect.unreachable(
              'Expected (await store.saveVersion(ctx, { id: v1, schemeId, expectedVersion: 0, definition })).ok',
            );
          }
          const life = {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: { state: 'assigned', valueIds: ['cells', 'genetics'] },
            difficulty: { state: 'assigned', valueIds: ['easy'] },
          } as const;
          await assignOverviewFixture(ctx, schemeId, v1, ids.slice(0, 104), life);
          await assignOverviewFixture(ctx, schemeId, v1, [ids[104]], {
            subject: { state: 'assigned', valueIds: ['physical'] },
            topic: { state: 'assigned', valueIds: ['energy'] },
            difficulty: { state: 'assigned', valueIds: ['hard'] },
          });
          await assignOverviewFixture(ctx, schemeId, v1, [ids[105]], {
            subject: { state: 'unassigned', reason: 'insufficient_context' },
            difficulty: { state: 'assigned', valueIds: ['easy'] },
          });
          const browse = new BankEnrichmentBrowse(db);
          const query = (suffix = '') =>
            parseQuestionBankQuery(
              new URLSearchParams(`view=overview&scheme=${schemeId}${suffix}`),
            );
          const verify = async (q: QuestionBankQuery) => {
            const result = await browse.page(ctx, q, { locale: 'en-US' });
            if (
              !(result.ok && result.value.kind === 'overview' && result.value.enrichment.selection)
            ) expect.unreachable(JSON.stringify(result));
            const overview = result.value.enrichment.selection.overview;
            if ('items' in result.value.bank) {
              expect.unreachable('Overview does not expose a question-list projection.');
            }
            if ('rows' in result.value.enrichment.selection) {
              expect.unreachable("Expected !('rows' in result.value.enrichment.selection)");
            }
            expect(overview.total).toStrictEqual(result.value.bank.total);
            expect(overview.rows.reduce((sum, row) => sum + row.total, 0)).toStrictEqual(
              overview.total,
            );
            for (const row of overview.rows) {
              expect(row.counts.reduce((sum, count) => sum + count, 0)).toStrictEqual(row.total);
              if (row.total) {
                const target = parseQuestionBankQuery(
                  new URL(
                    questionBankGroupHref(q, { subject: row.bucket.filter }),
                    'https://qflow.test',
                  ).searchParams,
                );
                expect((await listQuestionBank(ctx, target)).total).toStrictEqual(row.total);
              }
              for (let index = 0; index < overview.columns.length; index++) {
                if (!row.counts[index]) continue;
                const target = parseQuestionBankQuery(
                  new URL(
                    questionBankGroupHref(q, {
                      subject: row.bucket.filter,
                      difficulty: overview.columns[index].filter,
                    }),
                    'https://qflow.test',
                  ).searchParams,
                );
                expect((await listQuestionBank(ctx, target)).total).toStrictEqual(
                  row.counts[index],
                );
              }
            }
            for (const row of overview.rows) {
              for (const topic of row.topics) {
                expect(topic.total).toStrictEqual(
                  topic.counts.reduce((sum, count) => sum + count, 0),
                );
                const target = (difficulty?: typeof overview.columns[number]['filter']) =>
                  parseQuestionBankQuery(
                    new URL(
                      questionBankGroupHref(q, {
                        subject: row.bucket.filter,
                        topic: topic.bucket.filter,
                        ...(difficulty ? { difficulty } : {}),
                      }),
                      'https://qflow.test',
                    ).searchParams,
                  );
                expect((await listQuestionBank(ctx, target())).total).toStrictEqual(topic.total);
                for (let index = 0; index < overview.columns.length; index++) {
                  expect(
                    (await listQuestionBank(ctx, target(overview.columns[index].filter))).total,
                  ).toStrictEqual(topic.counts[index]);
                }
              }
            }
            for (const status of overview.statuses) {
              const target = parseQuestionBankQuery(
                new URL(
                  questionBankGroupHref(q, {
                    [status.dimension]: bankEnrichmentStatusFilter(status.kind),
                  }),
                  'https://qflow.test',
                ).searchParams,
              );
              expect((await listQuestionBank(ctx, target)).total).toStrictEqual(status.count);
            }
            return overview;
          };
          const all = await verify(query('&page=2'));
          expect(all.total).toStrictEqual(108);
          expect(
            (await listQuestionBank(ctx, query())).items.length,
            'Listing always returns questions, regardless of presentation.',
          ).toStrictEqual(100);
          expect(
            all.rows.find((r) =>
              r.bucket.filter.kind === 'value' && r.bucket.filter.versionId === v1 &&
              r.bucket.filter.valueId === 'life'
            )?.total,
          ).toStrictEqual(104);
          const lifeTopics = all.rows.find((row) =>
            row.bucket.filter.kind === 'value' && row.bucket.filter.valueId === 'life'
          )?.topics;
          expect(lifeTopics?.map((topic) => [topic.bucket.category?.label, topic.total]))
            .toStrictEqual([[
              'Cells',
              104,
            ], ['Genetics', 104]]);
          const genetics = await verify(query(`&topic=${v1}:genetics`));
          expect(genetics.total).toStrictEqual(104);
          expect(
            genetics.rows.flatMap((row) => row.topics).map((topic) => topic.bucket.category?.label),
          ).toStrictEqual(['Genetics']);
          expect((await verify(query(`&subject=${v1}:physical&difficulty=${v1}:easy`))).total)
            .toStrictEqual(0);
          expect((await verify(query('&subject=outside'))).total).toStrictEqual(2);
          expect((await verify(query('&subject=unassigned'))).total).toStrictEqual(1);
          const collectionId = crypto.randomUUID();
          if (
            !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
              _tag: 'Create',
              collectionId,
              name: 'Selection',
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
              questionIds: [ids[0], ids[104], ids[107]],
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'AddItems', collection",
            );
          }
          expect(
            (await verify(
              query(`&collection=${collectionId}&tags=source-science&origin=Authored&q=Cell`),
            )).total,
          ).toStrictEqual(3);
          const next = parseEnrichmentDefinition({
            ...definition,
            audience: 'Adult science',
            difficulty: definition.difficulty.map((d) => ({
              ...d,
              label: d.id === 'easy' ? 'Introductory' : d.label,
            })),
          });
          if (!next) expect.unreachable('Expected next');
          if (
            !((await store.saveVersion(ctx, {
              id: v2,
              schemeId,
              expectedVersion: 1,
              definition: next,
            }))
              .ok)
          ) {
            expect.unreachable(
              'Expected (await store.saveVersion(ctx, { id: v2, schemeId, expectedVersion: 1, definition: next, })',
            );
          }
          await assignOverviewFixture(ctx, schemeId, v2, [ids[0]], life);
          await assignOverviewFixture(ctx, schemeId, v2, [ids[1]], { difficulty: life.difficulty });
          const mixed = await verify(query());
          expect(mixed.columns.filter((column) => column.category?.label === 'Easy').length)
            .toStrictEqual(1);
          expect(mixed.columns.filter((column) => column.category?.label === 'Introductory').length)
            .toStrictEqual(1);
          expect(
            mixed.rows.find((row) =>
              row.bucket.filter.kind === 'value' && row.bucket.filter.versionId === v1 &&
              row.bucket.filter.valueId === 'life'
            )?.total,
          ).toStrictEqual(103);
          const [source] = await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, ids[1]),
          );
          await saveQuestionRevisionFixture(ctx, {
            questionId: ids[1],
            title: 'Changed cell',
            body: { ...source.body, title: 'Changed cell' },
            tags: ['source-science'],
            qtiXml: source.qtiXml,
            provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
            draftState: 'published',
          });
          const [unassignedSource] = await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, ids[105]),
          );
          await saveQuestionRevisionFixture(ctx, {
            questionId: ids[105],
            title: 'Changed unassigned question',
            body: { ...unassignedSource.body, title: 'Changed unassigned question' },
            tags: ['source-science'],
            qtiXml: unassignedSource.qtiXml,
            provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
            draftState: 'published',
          });
          expect((await verify(query('&subject=outdated'))).total).toStrictEqual(2);
          expect((await verify(query('&topic=outdated'))).total).toStrictEqual(1);
          expect((await verify(query(`&topic=${v1}:genetics:outdated`))).total).toStrictEqual(1);
          expect((await verify(query('&subject=unassigned:outdated'))).total).toStrictEqual(1);

          expect((await verify(query(`&subject=${v1}:life:outdated`))).total).toStrictEqual(1);
          expect((await verify(query(`&subject=${v1}:life`))).total).toStrictEqual(103);
          for (const subject of ['outdated', `${v1}:life:outdated`, 'unassigned:outdated']) {
            const selected = query(`&subject=${subject}`);
            const result = await browse.read(ctx, selected, []);
            if (!(result.ok && result.value.selection && selected.enrichment)) {
              expect.unreachable(
                'Expected result.ok && result.value.selection && selected.enrichment',
              );
            }
            const facet = result.value.selection.facets.subject;
            expect(facet.outdated).toStrictEqual(2);
            expect(facet.unassigned).toStrictEqual(1);
            expect(facet.pending).toStrictEqual(0);
            expect(facet.outside).toStrictEqual(0);
            for (const category of facet.categories) {
              const target: import('../lib/services/question_bank_query.ts').QuestionBankQuery = {
                ...selected,
                enrichment: {
                  ...selected.enrichment,
                  subject: {
                    kind: 'value',
                    versionId: category.versionId,
                    valueId: category.id,
                    freshness: 'outdated',
                  } as const,
                },
              };
              expect((await listQuestionBank(ctx, target)).total).toStrictEqual(category.count);
            }
          }
          await withEnrichmentWorkspace(async (other) => {
            expect(await browse.page(other, query(), { locale: 'en-US' })).toStrictEqual({
              ok: false,
              code: 'not_found',
            });
            expect(
              await browse.page({ ...ctx, userId: other.userId }, query(), { locale: 'en-US' }),
            ).toStrictEqual({ ok: false, code: 'forbidden' });
          });
        } finally {
          await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, ctx.tenantId));
          await db.delete(bankCollectionItems).where(
            eq(bankCollectionItems.tenantId, ctx.tenantId),
          );
          await db.delete(bankCollections).where(eq(bankCollections.tenantId, ctx.tenantId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
