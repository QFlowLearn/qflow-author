import { expect, test as testCase } from 'vitest';

import { currentMutationVocabularyVersion } from './helpers/enrichment_mutation_fixture.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { enrichmentSchemeVersions } from '../lib/db/bank_enrichment_schema.ts';
import { BankEnrichmentSetup } from '../lib/services/bank_enrichment_setup.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { removeEnrichmentCategory } from '../lib/bank_enrichment_editor.ts';
import { uuidV5 } from '../lib/uuid_v5.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { enrichmentConfigFixture as config } from './helpers/enrichment_provider_fixture.ts';
import { finishTestEnrichment } from './helpers/enrichment_test_worker.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  correctQuestions,
  currentQuestion,
  mutationBank,
  mutationNow,
  mutationWrites,
} from './helpers/enrichment_mutation_fixture.ts';

const assigned = (id: string) => ({ state: 'assigned', valueIds: [id] }) as const;
const finish = async (id: string) =>
  expect((await finishTestEnrichment(id, await uuidV5(id, 'execution')))._tag).toStrictEqual(
    'Completed',
  );

testCase(
  'edited vocabulary previews an affected subset, refreshes from the root, and updates only chosen fields',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const bank = await mutationBank(ctx, 8);
        await correctQuestions(ctx, bank.versionId, bank.ids.slice(0, 3), {
          subject: assigned('life'),
          topic: assigned('cells'),
          difficulty: assigned('hard'),
        });
        await correctQuestions(ctx, bank.versionId, bank.ids.slice(3, 6), {
          subject: assigned('physical'),
          topic: assigned('energy'),
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
        const versionId = crypto.randomUUID();
        if (
          !((await new BankEnrichmentStore(db, mutationNow).saveVersion(ctx, {
            id: versionId,
            schemeId: bank.schemeId,
            expectedVersion: await currentMutationVocabularyVersion(ctx, bank.schemeId),
            definition,
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentStore(db, mutationNow).saveVersion(ctx, { id: versionId, schemeId',
          );
        }
        const setup = new BankEnrichmentSetup(db, mutationNow),
          read = new BankEnrichmentJobRead(db, mutationNow);
        const sourceId = crypto.randomUUID();
        if (
          !((await setup.begin(
            ctx,
            sourceId,
            { _tag: 'Filtered', queryString: 'tags=source-science' },
            base.audience,
            versionId,
            config,
          )).ok)
        ) {
          expect.unreachable(
            "Expected (await setup.begin( ctx, sourceId, { _tag: 'Filtered', queryString: 'tags=source-science' ",
          );
        }
        await finish(sourceId);
        const outside = await addEnrichmentQuestions(ctx, 1);
        // An outside item retains the earlier vocabulary and cannot expand the frozen root.
        await correctQuestions(ctx, bank.versionId, outside, {
          subject: assigned('life'),
          topic: assigned('cells'),
          difficulty: assigned('hard'),
        });
        const beforeVersionCount = await currentMutationVocabularyVersion(ctx, bank.schemeId);
        const beforeQuestions = await db.select().from(questions).where(
          eq(questions.tenantId, ctx.tenantId),
        ).orderBy(questions.id);
        const beforeRevisions = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        ).orderBy(questionRevisions.id);
        const changed = removeEnrichmentCategory(definition, 'topic', 'cells', 'organisms');
        const previewId = crypto.randomUUID();
        const choice = { selection: 'affected', dimensions: ['topic'] };
        const preview = await setup.preview(ctx, sourceId, previewId, changed, choice, config);
        if (!(preview.ok)) expect.unreachable(JSON.stringify(preview));
        expect(await setup.preview(ctx, sourceId, previewId, changed, choice, config))
          .toStrictEqual(preview);
        await finish(previewId);
        const found = await read.get(ctx, previewId);
        if (!(found.ok && found.value.kind === 'preview' && found.value.result)) {
          expect.unreachable(
            "Expected found.ok && found.value.kind === 'preview' && found.value.result",
          );
        }
        expect(found.value.scopeCount).toStrictEqual(3);
        expect(found.value.result.definition).toStrictEqual(changed);
        const expanded = removeEnrichmentCategory(changed, 'subject', 'physical', 'life');
        expect(
          await setup.start(ctx, previewId, expanded, 'replace_captured', ['difficulty'], config),
        ).toStrictEqual({ ok: false, code: 'affected_scope_changed' });
        expect(
          (await db.select().from(enrichmentSchemeVersions).where(
            eq(enrichmentSchemeVersions.schemeId, bank.schemeId),
          )).length,
        ).toStrictEqual(beforeVersionCount);
        const refreshedId = crypto.randomUUID();
        if (
          !((await setup.preview(ctx, previewId, refreshedId, expanded, {
            selection: 'current',
            dimensions: ['topic'],
          }, config)).ok)
        ) {
          expect.unreachable(
            "Expected (await setup.preview(ctx, previewId, refreshedId, expanded, { selection: 'current', dimens",
          );
        }
        await finish(refreshedId);
        const refreshed = await read.get(ctx, refreshedId);
        if (!(refreshed.ok && refreshed.value.kind === 'preview' && refreshed.value.result)) {
          expect.unreachable(
            "Expected refreshed.ok && refreshed.value.kind === 'preview' && refreshed.value.result",
          );
        }
        expect(
          refreshed.value.scopeCount,
          'Refresh must use the original eight-question root, not only the first three affected questions.',
        ).toStrictEqual(6);
        expect(refreshed.value.result.definition).toStrictEqual(expanded);
        const scope = await new BankEnrichmentScopes(db, mutationNow).get(
          ctx,
          refreshed.value.snapshotId,
        );
        if (!(scope.ok && scope.value.scope._tag === 'Affected')) {
          expect.unreachable("Expected scope.ok && scope.value.scope._tag === 'Affected'");
        }
        expect(scope.value.scope.sourceScope._tag).toStrictEqual('Filtered');
        const run = await setup.start(
          ctx,
          refreshedId,
          expanded,
          'replace_captured',
          ['difficulty'],
          config,
        );
        if (!(run.ok)) expect.unreachable(JSON.stringify(run));
        await finish(run.value);
        const writes = await mutationWrites(ctx, run.value);
        expect(writes.length).toStrictEqual(6);
        if (!(writes.every((w) => w.dimension === 'difficulty'))) {
          expect.unreachable("Expected writes.every((w) => w.dimension === 'difficulty')");
        }
        expect(writes.map((w) => w.questionId).sort()).toStrictEqual(bank.ids.slice(0, 6).sort());
        const current = await currentQuestion(ctx, bank.schemeId, bank.ids[0]);
        expect(current.topic?.value).toStrictEqual(assigned('cells'));
        expect(current.difficulty?.value).toStrictEqual(assigned('easy'));
        expect((await currentQuestion(ctx, bank.schemeId, outside[0])).difficulty?.value)
          .toStrictEqual(assigned('hard'));
        expect(
          await db.select().from(questions).where(eq(questions.tenantId, ctx.tenantId)).orderBy(
            questions.id,
          ),
        ).toStrictEqual(beforeQuestions);
        expect(
          await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ).orderBy(questionRevisions.id),
        ).toStrictEqual(beforeRevisions);
      });
    } finally {
      await shutdownDb();
    }
  },
);
