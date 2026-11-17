import { expect, test as testCase } from 'vitest';

import { currentMutationVocabularyVersion } from './helpers/enrichment_mutation_fixture.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentSnapshotItems, enrichmentSnapshots } from '../lib/db/bank_enrichment_schema.ts';
import { BankEnrichmentAffectedScopes } from '../lib/services/bank_enrichment_affected_scope.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { parseEnrichmentScope } from '../lib/services/bank_enrichment_scope_contract.ts';
import { removeEnrichmentCategory } from '../lib/bank_enrichment_editor.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  correctQuestions,
  mutationBank,
  mutationNow,
} from './helpers/enrichment_mutation_fixture.ts';

const assigned = (id: string) => ({ state: 'assigned', valueIds: [id] }) as const;

testCase(
  'affected snapshots retain frozen roots, include earlier category versions, and exclude recycled identities',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const bank = await mutationBank(ctx, 105);
        const outside = await addEnrichmentQuestions(ctx, 1);
        await correctQuestions(ctx, bank.versionId, [...bank.ids.slice(0, 80), ...outside], {
          subject: assigned('life'),
          topic: assigned('cells'),
          difficulty: assigned('hard'),
        });
        const base = enrichmentDefinitionFixture();
        const definition = {
          ...base,
          topics: [...base.topics, {
            id: 'organisms',
            label: 'Organisms',
            definition: 'Structures of living organisms.',
            subjectId: 'life',
          }],
        };
        const store = new BankEnrichmentStore(db, mutationNow);
        const v2 = crypto.randomUUID();
        if (
          !((await store.saveVersion(ctx, {
            id: v2,
            schemeId: bank.schemeId,
            expectedVersion: await currentMutationVocabularyVersion(ctx, bank.schemeId),
            definition,
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { id: v2, schemeId: bank.schemeId, expectedVersion: await cu',
          );
        }
        await correctQuestions(ctx, v2, bank.ids.slice(0, 40), {
          subject: null,
          topic: assigned('cells'),
          difficulty: null,
        });
        const changed = removeEnrichmentCategory(definition, 'topic', 'cells', 'organisms');
        const affected = new BankEnrichmentAffectedScopes(db, mutationNow);
        const id = crypto.randomUUID();
        const result = await affected.capture(ctx, id, bank.snapshotId, v2, changed);
        if (!(result.ok)) expect.unreachable(JSON.stringify(result));
        expect(result.value.itemCount).toStrictEqual(80);
        expect(result.value.scope._tag).toStrictEqual('Affected');
        expect(parseEnrichmentScope(result.value.scope), 'Clients cannot forge affected scopes.')
          .toStrictEqual(null);
        const references = await db.select().from(enrichmentSnapshotItems).where(
          eq(enrichmentSnapshotItems.snapshotId, id),
        );
        expect(references.map((r) => r.questionId).sort()).toStrictEqual(
          bank.ids.slice(0, 80).sort(),
        );
        const root = await db.select().from(enrichmentSnapshotItems).where(
          eq(enrichmentSnapshotItems.snapshotId, bank.snapshotId),
        );
        for (const ref of references) {
          expect(ref.revisionId).toStrictEqual(
            root.find((r) => r.questionId === ref.questionId)?.revisionId,
          );
        }
        await correctQuestions(ctx, v2, [bank.ids[79]], {
          subject: null,
          topic: assigned('organisms'),
          difficulty: null,
        });
        expect(await affected.capture(ctx, id, bank.snapshotId, v2, changed)).toStrictEqual(result);
        const refreshed = await affected.capture(ctx, crypto.randomUUID(), id, v2, changed);
        if (!(refreshed.ok && refreshed.value.scope._tag === 'Affected')) {
          expect.unreachable("Expected refreshed.ok && refreshed.value.scope._tag === 'Affected'");
        }
        expect(refreshed.value.itemCount).toStrictEqual(79);
        expect(refreshed.value.scope.sourceSnapshotId).toStrictEqual(bank.snapshotId);
        expect(
          await affected.capture(ctx, id, bank.snapshotId, v2, {
            ...changed,
            audience: 'Grade 9 science',
          }),
        ).toStrictEqual({ ok: false, code: 'operation_conflict' });
        const selectedId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentScopes(db, mutationNow).capture(ctx, selectedId, {
            _tag: 'Selected',
            questionIds: [bank.ids[0], bank.ids[80]],
          })).ok)
        ) {
          expect.unreachable(
            "Expected (await new BankEnrichmentScopes(db, mutationNow).capture(ctx, selectedId, { _tag: 'Selecte",
          );
        }
        const selected = await affected.capture(ctx, crypto.randomUUID(), selectedId, v2, changed);
        if (!(selected.ok && selected.value.scope._tag === 'Affected')) {
          expect.unreachable("Expected selected.ok && selected.value.scope._tag === 'Affected'");
        }
        expect(selected.value.itemCount).toStrictEqual(1);
        expect(selected.value.scope.sourceScope._tag).toStrictEqual('Selected');
        await withEnrichmentWorkspace(async (other) => {
          expect(await affected.capture(other, crypto.randomUUID(), bank.snapshotId, v2, changed))
            .toStrictEqual({ ok: false, code: 'not_found' });
        });
        expect(
          await affected.capture(ctx, crypto.randomUUID(), bank.snapshotId, v2, {
            ...changed,
            replacements: [],
          }),
        ).toStrictEqual({ ok: false, code: 'invalid_input' });
        const emptyId = crypto.randomUUID();
        expect(await affected.capture(ctx, emptyId, bank.snapshotId, v2, definition)).toStrictEqual(
          {
            ok: false,
            code: 'empty_scope',
          },
        );
        expect(
          await db.select().from(enrichmentSnapshots).where(eq(enrichmentSnapshots.id, emptyId)),
        ).toStrictEqual([]);

        // Reusing an ID after a removed version denotes a new category, not old assignments.
        if (
          !((await store.saveVersion(ctx, {
            id: crypto.randomUUID(),
            schemeId: bank.schemeId,
            expectedVersion: await currentMutationVocabularyVersion(ctx, bank.schemeId),
            definition: changed,
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { id: crypto.randomUUID(), schemeId: bank.schemeId, expected',
          );
        }
        const v4 = crypto.randomUUID();
        if (
          !((await store.saveVersion(ctx, {
            id: v4,
            schemeId: bank.schemeId,
            expectedVersion: await currentMutationVocabularyVersion(ctx, bank.schemeId),
            definition,
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { id: v4, schemeId: bank.schemeId, expectedVersion: await cu',
          );
        }
        expect(await affected.capture(ctx, crypto.randomUUID(), bank.snapshotId, v4, changed))
          .toStrictEqual({
            ok: false,
            code: 'empty_scope',
          });
        await correctQuestions(ctx, v4, [bank.ids[0]], {
          subject: null,
          topic: assigned('cells'),
          difficulty: null,
        });
        const recycled = await affected.capture(
          ctx,
          crypto.randomUUID(),
          bank.snapshotId,
          v4,
          changed,
        );
        if (!(recycled.ok)) expect.unreachable('Expected recycled.ok');
        expect(recycled.value.itemCount).toStrictEqual(1);
      });
    } finally {
      await shutdownDb();
    }
  },
);
