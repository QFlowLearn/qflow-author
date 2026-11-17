import { expect, test as testCase } from 'vitest';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentAssignments, enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../lib/db/bank_schema.ts';
import { questionRevisions } from '../lib/db/question_schema.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { BankEnrichmentBrowse } from '../lib/services/bank_enrichment_browse.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentClassification,
  parseEnrichmentDefinition,
} from '../lib/services/bank_enrichment_contract.ts';
import { parseQuestionBankQuery } from '../lib/services/question_bank_query.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';

async function assign(
  ctx: RequestContext,
  schemeId: string,
  versionId: string,
  questionId: string,
  classification: EnrichmentClassification,
) {
  const [revision] = await db.select().from(questionRevisions).where(
    and(eq(questionRevisions.questionId, questionId), eq(questionRevisions.revision, 1)),
  );
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const [previous] = await db.select().from(enrichmentAssignments).where(
      and(
        eq(enrichmentAssignments.schemeId, schemeId),
        eq(enrichmentAssignments.questionId, questionId),
        eq(enrichmentAssignments.dimension, dimension),
      ),
    );
    const id = crypto.randomUUID();
    await db.insert(enrichmentChanges).values({
      id,
      tenantId: ctx.tenantId,
      schemeId,
      questionId,
      versionId,
      revisionId: revision.id,
      dimension,
      value: classification[dimension],
      origin: 'human',
      operationId: crypto.randomUUID(),
      previousChangeId: previous?.changeId ?? null,
      createdBy: ctx.userId,
      createdAt: new Date(),
    });
    await db.insert(enrichmentAssignments).values({
      tenantId: ctx.tenantId,
      schemeId,
      questionId,
      dimension,
      changeId: id,
    }).onConflictDoUpdate({
      target: [
        enrichmentAssignments.tenantId,
        enrichmentAssignments.schemeId,
        enrichmentAssignments.questionId,
        enrichmentAssignments.dimension,
      ],
      set: { changeId: id },
    });
  }
}
const assigned = (
  subject: string,
  topic: string,
  difficulty: string,
): EnrichmentClassification => ({
  subject: { state: 'assigned', valueIds: [subject] },
  topic: { state: 'assigned', valueIds: [topic] },
  difficulty: { state: 'assigned', valueIds: [difficulty] },
});

testCase(
  'versioned browse labels survive merges and audience changes while filters compose with collections',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        try {
          const ids = await addEnrichmentQuestions(ctx, 3);
          const store = new BankEnrichmentStore(db, () => new Date());
          const browse = new BankEnrichmentBrowse(db);
          const schemeId = crypto.randomUUID(), v1 = crypto.randomUUID(), v2 = crypto.randomUUID();
          const definition = enrichmentDefinitionFixture();
          if (
            !((await store.saveVersion(ctx, { id: v1, schemeId, expectedVersion: 0, definition }))
              .ok)
          ) {
            expect.unreachable(
              'Expected (await store.saveVersion(ctx, { id: v1, schemeId, expectedVersion: 0, definition })).ok',
            );
          }
          await assign(ctx, schemeId, v1, ids[0], assigned('physical', 'energy', 'easy'));
          await assign(ctx, schemeId, v1, ids[1], assigned('life', 'cells', 'easy'));
          const unassigned = { state: 'unassigned', reason: 'insufficient_context' } as const;
          await assign(ctx, schemeId, v1, ids[2], {
            subject: unassigned,
            topic: unassigned,
            difficulty: unassigned,
          });
          const next = parseEnrichmentDefinition({
            ...definition,
            audience: 'Grade 9 science',
            subjects: [{ ...definition.subjects[0], label: 'Science' }],
            topics: [{ ...definition.topics[0], label: 'Cell biology' }],
            difficulty: definition.difficulty.map((c) =>
              c.id === 'easy' ? { ...c, label: 'Introductory' } : c
            ),
            replacements: [{ dimension: 'subject', fromId: 'physical', toId: 'life' }, {
              dimension: 'topic',
              fromId: 'energy',
              toId: 'cells',
            }],
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
          await assign(ctx, schemeId, v2, ids[1], assigned('life', 'cells', 'easy'));
          const query = (suffix = '') =>
            parseQuestionBankQuery(new URLSearchParams(`scheme=${schemeId}${suffix}`));
          const view = await browse.read(ctx, query(), ids);
          if (!(view.ok && view.value.selection)) expect.unreachable(JSON.stringify(view));
          const selected = view.value.selection;
          expect(selected.scheme.audience).toStrictEqual('Grade 9 science');
          expect(
            selected.facets.difficulty.categories.filter((c) => c.id === 'easy').map((
              c,
            ) => [c.version, c.audience, c.label, c.count]),
          ).toStrictEqual([[2, 'Grade 9 science', 'Introductory', 1], [
            1,
            'Grade 6 science',
            'Easy',
            1,
          ]]);
          expect(selected.facets.subject.categories.find((c) => c.id === 'physical')?.count)
            .toStrictEqual(1);
          const physicalFacets = await browse.read(ctx, query(`&subject=${v1}:physical`), []);
          if (!(physicalFacets.ok && physicalFacets.value.selection)) {
            expect.unreachable('Expected physicalFacets.ok && physicalFacets.value.selection');
          }
          expect(
            physicalFacets.value.selection.facets.topic.categories.filter((c) => c.count > 0).map((
              c,
            ) => c.label),
          ).toStrictEqual(['Energy']);
          expect(
            physicalFacets.value.selection.facets.difficulty.categories.filter((c) => c.count > 0)
              .map((c) => c.version),
          ).toStrictEqual([1]);
          const old = selected.rows[ids[0]].topic;
          if (!(old.state === 'classified')) {
            expect.unreachable("Expected old.state === 'classified'");
          }
          expect(old.categories).toStrictEqual([{ id: 'energy', label: 'Energy' }]);
          expect(old.version).toStrictEqual(1);
          expect(old.audience).toStrictEqual('Grade 6 science');
          const current = selected.rows[ids[1]].topic;
          if (!(current.state === 'classified')) {
            expect.unreachable("Expected current.state === 'classified'");
          }
          expect(current.categories).toStrictEqual([{ id: 'cells', label: 'Cell biology' }]);
          expect(
            (await listQuestionBank(ctx, query(`&difficulty=${v1}:easy`))).items.map((q) => q.id),
          ).toStrictEqual([ids[0]]);
          expect(
            (await listQuestionBank(ctx, query(`&difficulty=${v2}:easy`))).items.map((q) => q.id),
          ).toStrictEqual([ids[1]]);
          expect((await listQuestionBank(ctx, query('&topic=unassigned'))).items.map((q) => q.id))
            .toStrictEqual([ids[2]]);
          expect(selected.facets.topic.pending).toStrictEqual(0);
          expect(selected.facets.topic.outside).toStrictEqual(0);
          const [source] = await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, ids[1]),
          );
          await saveQuestionRevisionFixture(ctx, {
            questionId: ids[1],
            title: 'Changed question',
            body: { ...source.body, title: 'Changed question' },
            tags: ['source-science'],
            qtiXml: source.qtiXml,
            provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
            draftState: 'published',
          });
          const stale = await browse.read(ctx, query('&topic=outdated'), [ids[1]]);
          if (!(stale.ok && stale.value.selection)) {
            expect.unreachable('Expected stale.ok && stale.value.selection');
          }
          expect(stale.value.selection.facets.topic.outdated).toStrictEqual(1);
          const staleValue = stale.value.selection.rows[ids[1]].topic;
          if (!(staleValue.state === 'classified' && staleValue.outdated)) {
            expect.unreachable("Expected staleValue.state === 'classified' && staleValue.outdated");
          }
          expect((await listQuestionBank(ctx, query('&topic=outdated'))).items.map((q) => q.id))
            .toStrictEqual([ids[1]]);
          const collectionId = crypto.randomUUID();
          if (
            !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
              _tag: 'Create',
              collectionId,
              name: 'Energy',
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
              questionIds: [ids[0], ids[2]],
            })).ok)
          ) {
            expect.unreachable(
              "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'AddItems', collection",
            );
          }
          const collectionQuery = query(
            `&collection=${collectionId}&tags=source-science&subject=${v1}:physical&origin=Authored`,
          );
          const collection = await browse.read(ctx, collectionQuery, [ids[0]]);
          if (!(collection.ok && collection.value.selection)) {
            expect.unreachable('Expected collection.ok && collection.value.selection');
          }
          expect(
            collection.value.selection.facets.topic.categories.filter((c) => c.count > 0).map((c) =>
              c.label
            ),
          ).toStrictEqual(['Energy']);
          expect((await listQuestionBank(ctx, collectionQuery)).items.map((q) => q.id))
            .toStrictEqual([
              ids[0],
            ]);
          const otherScheme = crypto.randomUUID(), otherVersion = crypto.randomUUID();
          if (
            !((await store.saveVersion(ctx, {
              id: otherVersion,
              schemeId: otherScheme,
              expectedVersion: 0,
              definition,
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await store.saveVersion(ctx, { id: otherVersion, schemeId: otherScheme, expectedVersion: ',
            );
          }
          await assign(
            ctx,
            otherScheme,
            otherVersion,
            ids[1],
            assigned('physical', 'energy', 'easy'),
          );
          expect((await listQuestionBank(ctx, query(`&subject=${v1}:physical`))).total)
            .toStrictEqual(1);
          expect(await browse.read(ctx, query(`&topic=${otherVersion}:energy`), [])).toStrictEqual({
            ok: false,
            code: 'invalid_input',
          });
          expect(
            await new BankEnrichmentScopes(db, () => new Date()).capture(ctx, crypto.randomUUID(), {
              _tag: 'Filtered',
              queryString: `scheme=${schemeId}&topic=${otherVersion}:energy`,
            }),
          ).toStrictEqual({ ok: false, code: 'invalid_input' });
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
