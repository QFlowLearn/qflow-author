import { expect, test as testCase } from 'vitest';

import { db, shutdownDb } from '../lib/db.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { parseEnrichmentDefinition } from '../lib/services/bank_enrichment_contract.ts';
import {
  parseQuestionBankFilterForm,
  parseQuestionBankQuery,
} from '../lib/services/question_bank_query.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';

testCase(
  'difficulty sorting requires an explicit category set and clearing it clears the sort',
  () => {
    expect(() => parseQuestionBankQuery(new URLSearchParams('sort=difficulty'))).toThrowError(
      Error,
    );
    for (const sort of ['difficulty', ' difficulty ']) {
      const parsed = parseQuestionBankFilterForm(
        new URLSearchParams({
          loadedScheme: crypto.randomUUID(),
          scheme: '',
          sort,
          direction: ' asc ',
        }),
      );
      if (!parsed) expect.unreachable('Expected parsed');
      expect(parseQuestionBankQuery(parsed).sort).toStrictEqual(undefined);
    }
    for (
      const invalid of ['&sort=title', '&direction=desc', '&direction=invalid', '&unexpected=1']
    ) {
      expect(() =>
        parseQuestionBankFilterForm(
          new URLSearchParams(
            `loadedScheme=&scheme=&sort=difficulty&direction=asc${invalid}`,
          ),
        )
      ).toThrowError(Error);
    }
  },
);

testCase(
  'difficulty order uses producing definitions with stable pages and missing values last in both directions',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const ids = await addEnrichmentQuestions(ctx, 120);
        const schemeId = crypto.randomUUID(), v1 = crypto.randomUUID(), v2 = crypto.randomUUID();
        const store = new BankEnrichmentStore(db, () => new Date());
        const definition = parseEnrichmentDefinition({
          ...enrichmentDefinitionFixture(),
          difficulty: [
            { id: 'hard', label: 'Z foundation', definition: 'First configured level.' },
            { id: 'easy', label: 'A application', definition: 'Second configured level.' },
            { id: 'moderate', label: 'M synthesis', definition: 'Third configured level.' },
          ],
        });
        if (!definition) expect.unreachable('Expected definition');
        if (
          !((await store.saveVersion(ctx, { id: v1, schemeId, expectedVersion: 0, definition })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { id: v1, schemeId, expectedVersion: 0, definition })).ok',
          );
        }
        const assign = (versionId: string, questionIds: readonly string[], level: string) =>
          assignOverviewFixture(ctx, schemeId, versionId, questionIds, {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: { state: 'assigned', valueIds: ['cells'] },
            difficulty: { state: 'assigned', valueIds: [level] },
          });
        await assign(v1, ids.slice(0, 105), 'hard');
        await assign(v1, ids.slice(105, 110), 'easy');
        await assign(v1, ids.slice(110, 115), 'moderate');
        await assignOverviewFixture(ctx, schemeId, v1, [ids[115]], {
          difficulty: { state: 'unassigned', reason: 'insufficient_context' },
        });
        if (
          !((await store.saveVersion(ctx, {
            id: v2,
            schemeId,
            expectedVersion: 1,
            definition: {
              ...definition,
              audience: 'A different audience',
              difficulty: [...definition.difficulty].reverse(),
            },
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { id: v2, schemeId, expectedVersion: 1, definition: { ...def',
          );
        }
        await assign(v2, [ids[0]], 'hard');
        await assign(v2, [ids[105]], 'easy');
        const query = (direction: string, page: number, extra = '') =>
          parseQuestionBankQuery(
            new URLSearchParams(
              `scheme=${schemeId}&sort=difficulty&direction=${direction}&page=${page}${extra}`,
            ),
          );
        const expected = {
          asc: [
            ids[105],
            ids[0],
            ...ids.slice(1, 105).sort(),
            ...ids.slice(106, 110).sort(),
            ...ids.slice(110, 115).sort(),
            ...ids.slice(115).sort(),
          ],
          desc: [
            ids[0],
            ids[105],
            ...ids.slice(110, 115).sort(),
            ...ids.slice(106, 110).sort(),
            ...ids.slice(1, 105).sort(),
            ...ids.slice(115).sort(),
          ],
        };
        for (const direction of ['asc', 'desc'] as const) {
          const first = await listQuestionBank(ctx, query(direction, 1));
          const second = await listQuestionBank(ctx, query(direction, 2));
          expect(first.items.length).toStrictEqual(100);
          expect(second.items.length).toStrictEqual(20);
          expect(first.total).toStrictEqual(120);
          expect([...first.items, ...second.items].map((item) => item.id)).toStrictEqual(
            expected[direction],
          );
          const filtered = await listQuestionBank(
            ctx,
            query(direction, 1, `&subject=${v2}:life&topic=${v2}:cells&tags=source-science&q=Cell`),
          );
          expect(filtered.items.map((item) => item.id)).toStrictEqual(
            expected[direction].slice(0, 2),
          );
        }
        await withEnrichmentWorkspace(async (other) => {
          expect((await listQuestionBank(other, query('asc', 1))).total).toStrictEqual(0);
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);
