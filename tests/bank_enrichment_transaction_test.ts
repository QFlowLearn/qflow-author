import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  enrichmentAssignments,
  enrichmentChanges,
  enrichmentSchemes,
  enrichmentSchemeVersions,
  enrichmentSnapshotItems,
  enrichmentSnapshots,
} from '../lib/db/bank_enrichment_schema.ts';
import { bankCollectionItems, bankCollections } from '../lib/db/bank_schema.ts';
import { organizationMemberships, tenants, users } from '../lib/db/principal_schema.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentRunStore } from '../lib/services/bank_enrichment_run_store.ts';
import {
  enrichmentBatches,
  enrichmentRunItems,
  enrichmentRuns,
} from '../lib/db/bank_enrichment_job_schema.ts';
import { listQuestionBank } from '../lib/services/question_bank_read.ts';
import { parseQuestionBankQuery } from '../lib/services/question_bank_query.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';

const now = () => new Date('2026-09-11T12:00:00.000Z');

async function withWorkspace(test: (ctx: RequestContext) => Promise<void>) {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  try {
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Enrichment test' });
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      emailNormalized: `${userId}@example.com`,
    });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    await test(ctx);
  } finally {
    await db.delete(enrichmentBatches).where(eq(enrichmentBatches.tenantId, tenantId));
    await db.delete(enrichmentRunItems).where(eq(enrichmentRunItems.tenantId, tenantId));
    await db.delete(enrichmentRuns).where(eq(enrichmentRuns.tenantId, tenantId));
    await db.delete(enrichmentAssignments).where(eq(enrichmentAssignments.tenantId, tenantId));
    await db.delete(enrichmentChanges).where(eq(enrichmentChanges.tenantId, tenantId));
    await db.delete(enrichmentSchemeVersions).where(
      eq(enrichmentSchemeVersions.tenantId, tenantId),
    );
    await db.delete(enrichmentSchemes).where(eq(enrichmentSchemes.tenantId, tenantId));
    await db.delete(enrichmentSnapshotItems).where(eq(enrichmentSnapshotItems.tenantId, tenantId));
    await db.delete(enrichmentSnapshots).where(eq(enrichmentSnapshots.tenantId, tenantId));
    await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
    await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
    await db.update(questions).set({ latestRevisionId: null }).where(
      eq(questions.tenantId, tenantId),
    );
    await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
    await db.delete(questions).where(eq(questions.tenantId, tenantId));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(users).where(eq(users.id, userId));
  }
}

async function addQuestions(ctx: RequestContext, amount: number) {
  const draft = {
    ...TYPE_DRIVERS.single_select.defaults(),
    itemLanguage: newAuthoringItemLanguage(),
  };
  const qtiXml = exportQti3AssessmentItemXml(
    'single_select',
    prepareDriverDraftForBuild('single_select', draft),
    { identifier: 'enrichment-fixture' },
  );
  const ids: string[] = [];
  // Fixture writes share the existing question revision service and its transaction behavior.
  for (let index = 0; index < amount; index++) {
    const id = crypto.randomUUID();
    await saveQuestionRevisionFixture(ctx, {
      questionId: id,
      title: `Cell question ${index}`,
      body: { ...draft, type: 'single_select', title: `Cell question ${index}` },
      tags: ['biology', 'imported'],
      provenance: { _tag: 'Authored' },
      qtiXml,
      draftState: 'published',
    });
    ids.push(id);
  }
  return ids;
}

testCase(
  'enrichment versions are immutable, retry-safe, permission checked and conflict on stale edits',
  async () => {
    try {
      await withWorkspace(async (ctx) => {
        const store = new BankEnrichmentStore(db, now);
        const command = {
          id: crypto.randomUUID(),
          schemeId: crypto.randomUUID(),
          expectedVersion: 0,
          definition: enrichmentDefinitionFixture(),
        };
        const first = await store.saveVersion(ctx, command);
        if (!(first.ok)) expect.unreachable('Expected first.ok');
        expect(first.value.version).toStrictEqual(1);
        expect(await store.saveVersion(ctx, command)).toStrictEqual(first);
        expect(
          await store.saveVersion(ctx, {
            ...command,
            definition: { ...command.definition, audience: 'Grade 10' },
          }),
        ).toStrictEqual({ ok: false, code: 'operation_conflict' });
        const updated = {
          ...command,
          id: crypto.randomUUID(),
          expectedVersion: 1,
          definition: { ...command.definition, name: 'Revised science scheme' },
        };
        const results = await Promise.all([
          store.saveVersion(ctx, updated),
          store.saveVersion(ctx, { ...updated, id: crypto.randomUUID() }),
        ]);
        expect(results.filter((r) => r.ok).length).toStrictEqual(1);
        expect(results.filter((r) => !r.ok && r.code === 'version_conflict').length).toStrictEqual(
          1,
        );
        expect(await store.getVersion(ctx, command.id)).toStrictEqual(first);
        await expect(
          Promise.resolve().then(() =>
            db.update(enrichmentSchemeVersions).set({ definition: updated.definition }).where(
              eq(enrichmentSchemeVersions.id, command.id),
            )
          ),
        ).rejects.toBeInstanceOf(Error);
        const removed = {
          ...command.definition,
          difficulty: command.definition.difficulty.slice(0, 2),
        };
        expect(
          await store.saveVersion(ctx, {
            ...command,
            id: crypto.randomUUID(),
            expectedVersion: 2,
            definition: removed,
          }),
        ).toStrictEqual({ ok: false, code: 'invalid_input' });
        if (
          !((await store.saveVersion(ctx, {
            ...command,
            id: crypto.randomUUID(),
            expectedVersion: 2,
            definition: {
              ...removed,
              replacements: [{ dimension: 'difficulty', fromId: 'hard', toId: 'moderate' }],
            },
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await store.saveVersion(ctx, { ...command, id: crypto.randomUUID(), expectedVersion: 2, d',
          );
        }
        await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
          eq(organizationMemberships.tenantId, ctx.tenantId),
        );
        expect(await store.saveVersion(ctx, { ...command, id: crypto.randomUUID() })).toStrictEqual(
          {
            ok: false,
            code: 'forbidden',
          },
        );
        if (!((await store.getVersion(ctx, command.id)).ok)) {
          expect.unreachable('Expected (await store.getVersion(ctx, command.id)).ok');
        }
        await withWorkspace(async (other) => {
          expect(await store.getVersion(other, command.id)).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
          await expect(
            Promise.resolve().then(() =>
              db.insert(enrichmentSchemeVersions).values({
                id: crypto.randomUUID(),
                schemeId: command.schemeId,
                tenantId: other.tenantId,
                version: 99,
                definition: command.definition,
                createdBy: other.userId,
                createdAt: now(),
              })
            ),
          ).rejects.toBeInstanceOf(Error);
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'scope captures all filtered questions beyond page 1 and pins revisions without touching sources',
  async () => {
    try {
      await withWorkspace(async (ctx) => {
        const ids = await addQuestions(ctx, 151);
        const collectionId = crypto.randomUUID();
        await db.insert(bankCollections).values({
          id: collectionId,
          tenantId: ctx.tenantId,
          name: 'Science',
          description: '',
          position: 0,
          createdAt: now(),
          updatedAt: now(),
        });
        await db.insert(bankCollectionItems).values(
          ids.map((questionId, position) => ({
            tenantId: ctx.tenantId,
            collectionId,
            questionId,
            position,
          })),
        );
        const beforeQuestions = await db.select().from(questions).where(
          eq(questions.tenantId, ctx.tenantId),
        ).orderBy(questions.id);
        const beforeRevisions = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, ctx.tenantId),
        ).orderBy(questionRevisions.id);
        const queryString = `collection=${collectionId}&tags=biology&page=2&pageSize=10`;
        const page = await listQuestionBank(
          ctx,
          parseQuestionBankQuery(new URLSearchParams(queryString)),
        );
        expect(page.items.length).toStrictEqual(10);
        expect(page.total).toStrictEqual(151);
        const scopes = new BankEnrichmentScopes(db, now);
        const id = crypto.randomUUID();
        const input = { _tag: 'Filtered', queryString };
        const snapshot = await scopes.capture(ctx, id, input);
        if (!(snapshot.ok)) expect.unreachable('Expected snapshot.ok');
        expect(snapshot.value.itemCount).toStrictEqual(151);
        const version = await new BankEnrichmentStore(db, now).saveVersion(ctx, {
          id: crypto.randomUUID(),
          schemeId: crypto.randomUUID(),
          expectedVersion: 0,
          definition: enrichmentDefinitionFixture(),
        });
        if (!(version.ok)) expect.unreachable('Expected version.ok');
        const runId = crypto.randomUUID();
        const run = await new BankEnrichmentRunStore(db, now).prepare(ctx, runId, {
          snapshotId: id,
          versionId: version.value.id,
          dimensions: ['subject', 'topic', 'difficulty'],
          replacement: 'preserve_manual',
        });
        expect(run).toStrictEqual({ ok: true, value: { id: runId, itemCount: 151 } });
        expect(
          (await db.select().from(enrichmentRunItems).where(eq(enrichmentRunItems.runId, runId)))
            .length,
        ).toStrictEqual(151);
        expect(await scopes.get(ctx, id)).toStrictEqual(snapshot);
        const captured = await db.select().from(enrichmentSnapshotItems).where(
          eq(enrichmentSnapshotItems.snapshotId, id),
        );
        expect(new Set(captured.map((item) => item.questionId))).toStrictEqual(new Set(ids));
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
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.collectionId, collectionId),
          )).length,
        ).toStrictEqual(151);
        await db.update(questions).set({ tags: ['changed'] }).where(eq(questions.id, ids[0]));
        const changedDraft = {
          ...TYPE_DRIVERS.single_select.defaults(),
          itemLanguage: newAuthoringItemLanguage(),
          promptHtml: 'A revised question about cells.',
        };
        await saveQuestionRevisionFixture(ctx, {
          questionId: ids[0],
          title: 'Revised cell question',
          body: { ...changedDraft, type: 'single_select', title: 'Revised cell question' },
          tags: ['changed'],
          provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
          draftState: 'published',
          qtiXml: exportQti3AssessmentItemXml(
            'single_select',
            prepareDriverDraftForBuild('single_select', changedDraft),
            { identifier: 'enrichment-revised' },
          ),
        });
        const revised = await db.select().from(questions).where(eq(questions.id, ids[0]));
        const capturedRevision = captured.find((item) => item.questionId === ids[0]);
        if (!capturedRevision) expect.unreachable('Expected capturedRevision');
        if (!(revised[0].latestRevisionId !== capturedRevision.revisionId)) {
          expect.unreachable(
            'Expected revised[0].latestRevisionId !== capturedRevision.revisionId',
          );
        }
        expect(
          await db.select().from(enrichmentSnapshotItems).where(
            eq(enrichmentSnapshotItems.snapshotId, id),
          ),
        ).toStrictEqual(captured);
        expect(await scopes.capture(ctx, id, input)).toStrictEqual(snapshot);
        const fresh = await scopes.capture(ctx, crypto.randomUUID(), input);
        if (!(fresh.ok)) expect.unreachable('Expected fresh.ok');
        expect(fresh.value.itemCount).toStrictEqual(150);
        expect(await scopes.capture(ctx, id, { _tag: 'Filtered', queryString: '' })).toStrictEqual({
          ok: false,
          code: 'operation_conflict',
        });
        await expect(
          Promise.resolve().then(() =>
            db.update(enrichmentSnapshots).set({ itemCount: 999 }).where(
              eq(enrichmentSnapshots.id, id),
            )
          ),
        ).rejects.toBeInstanceOf(Error);
        await expect(
          Promise.resolve().then(() =>
            db.update(enrichmentSnapshotItems).set({ revisionId: beforeRevisions[0].id }).where(
              eq(enrichmentSnapshotItems.snapshotId, id),
            )
          ),
        ).rejects.toBeInstanceOf(Error);
        const extra = await addQuestions(ctx, 1);
        const extraSource = await db.select().from(questions).where(eq(questions.id, extra[0]));
        const extraRevision = extraSource[0].latestRevisionId;
        if (!extraRevision) expect.unreachable('Expected extraRevision');
        await expect(
          Promise.resolve().then(() =>
            db.insert(enrichmentSnapshotItems).values({
              snapshotId: id,
              tenantId: ctx.tenantId,
              questionId: extra[0],
              revisionId: extraRevision,
            })
          ),
        ).rejects.toBeInstanceOf(Error);
        await withWorkspace(async (other) => {
          const otherIds = await addQuestions(other, 1);
          const invalidId = crypto.randomUUID();
          expect(
            await scopes.capture(ctx, invalidId, {
              _tag: 'Selected',
              questionIds: [ids[1], otherIds[0]],
            }),
          ).toStrictEqual({ ok: false, code: 'invalid_selection' });
          expect(await scopes.get(ctx, invalidId)).toStrictEqual({ ok: false, code: 'not_found' });
          expect(await scopes.get(other, id)).toStrictEqual({ ok: false, code: 'not_found' });
        });
        await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
          eq(organizationMemberships.tenantId, ctx.tenantId),
        );
        expect(await scopes.capture(ctx, crypto.randomUUID(), input)).toStrictEqual({
          ok: false,
          code: 'forbidden',
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase('assignment pointers cannot cross question, dimension or scheme boundaries', async () => {
  try {
    await withWorkspace(async (ctx) => {
      const ids = await addQuestions(ctx, 2);
      const revisions = await db.select().from(questionRevisions).where(
        eq(questionRevisions.tenantId, ctx.tenantId),
      );
      const source = revisions.find((row) => row.questionId === ids[0]);
      if (!source) expect.unreachable('Expected source');
      const store = new BankEnrichmentStore(db, now);
      const version = await store.saveVersion(ctx, {
        id: crypto.randomUUID(),
        schemeId: crypto.randomUUID(),
        expectedVersion: 0,
        definition: enrichmentDefinitionFixture(),
      });
      if (!(version.ok)) expect.unreachable('Expected version.ok');
      const change = {
        id: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        questionId: ids[0],
        revisionId: source.id,
        schemeId: version.value.schemeId,
        versionId: version.value.id,
        dimension: 'subject',
        value: { state: 'assigned', valueIds: ['life'] },
        origin: 'human',
        operationId: crypto.randomUUID(),
        createdBy: ctx.userId,
        createdAt: now(),
      };
      await db.insert(enrichmentChanges).values(change);
      const pointer = {
        tenantId: ctx.tenantId,
        questionId: ids[0],
        schemeId: version.value.schemeId,
        dimension: 'subject',
        changeId: change.id,
      };
      await db.insert(enrichmentAssignments).values(pointer);
      const snapshot = await new BankEnrichmentScopes(db, now).capture(ctx, crypto.randomUUID(), {
        _tag: 'Selected',
        questionIds: ids,
      });
      if (!(snapshot.ok)) expect.unreachable('Expected snapshot.ok');
      const runId = crypto.randomUUID();
      const runStore = new BankEnrichmentRunStore(db, now);
      const runInput = {
        snapshotId: snapshot.value.id,
        versionId: version.value.id,
        dimensions: ['subject', 'topic', 'difficulty'],
        replacement: 'preserve_manual',
      };
      const prepared = await runStore.prepare(ctx, runId, runInput);
      expect(prepared).toStrictEqual({ ok: true, value: { id: runId, itemCount: 2 } });
      const baseline = await db.select().from(enrichmentRunItems).where(
        eq(enrichmentRunItems.runId, runId),
      );
      expect(baseline.find((item) => item.questionId === ids[0])?.baseline).toStrictEqual({
        subject: change.id,
        topic: null,
        difficulty: null,
      });
      const laterChangeId = crypto.randomUUID();
      await db.insert(enrichmentChanges).values({
        ...change,
        id: laterChangeId,
        operationId: crypto.randomUUID(),
        previousChangeId: change.id,
      });
      await db.update(enrichmentAssignments).set({ changeId: laterChangeId }).where(
        eq(enrichmentAssignments.changeId, change.id),
      );
      expect(await runStore.prepare(ctx, runId, runInput)).toStrictEqual(prepared);
      expect(await db.select().from(enrichmentRunItems).where(eq(enrichmentRunItems.runId, runId)))
        .toStrictEqual(baseline);
      expect(await runStore.prepare(ctx, runId, { ...runInput, replacement: 'replace_captured' }))
        .toStrictEqual({ ok: false, code: 'operation_conflict' });
      await expect(
        Promise.resolve().then(() =>
          db.update(enrichmentRunItems).set({
            baseline: { subject: laterChangeId, topic: null, difficulty: null },
          }).where(eq(enrichmentRunItems.runId, runId))
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.update(enrichmentRuns).set({ dimensions: ['difficulty'] }).where(
            eq(enrichmentRuns.id, runId),
          )
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.update(enrichmentRuns).set({ state: 'queued' }).where(eq(enrichmentRuns.id, runId))
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.insert(enrichmentAssignments).values({ ...pointer, dimension: 'difficulty' })
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.insert(enrichmentAssignments).values({ ...pointer, questionId: ids[1] })
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.insert(enrichmentChanges).values({
            ...change,
            id: crypto.randomUUID(),
            questionId: ids[1],
          })
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.update(enrichmentChanges).set({ value: { state: 'assigned', valueIds: ['physical'] } })
            .where(eq(enrichmentChanges.id, change.id))
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(
        (await db.select().from(enrichmentChanges).where(eq(enrichmentChanges.id, change.id)))[0]
          .value,
      ).toStrictEqual(change.value);
    });
  } finally {
    await shutdownDb();
  }
});

testCase(
  'scheme examples reject foreign questions and mismatched revision references',
  async () => {
    try {
      await withWorkspace(async (ctx) => {
        const ids = await addQuestions(ctx, 2);
        const source = await db.select().from(questions).where(eq(questions.id, ids[0]));
        const store = new BankEnrichmentStore(db, now);
        const example = {
          questionId: ids[0],
          revisionId: source[0].latestRevisionId,
          classification: {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: { state: 'assigned', valueIds: ['cells'] },
            difficulty: { state: 'assigned', valueIds: ['easy'] },
          },
        };
        const command = {
          id: crypto.randomUUID(),
          schemeId: crypto.randomUUID(),
          expectedVersion: 0,
          definition: { ...enrichmentDefinitionFixture(), examples: [example] },
        };
        if (!((await store.saveVersion(ctx, command)).ok)) {
          expect.unreachable('Expected (await store.saveVersion(ctx, command)).ok');
        }
        expect(
          await store.saveVersion(ctx, {
            ...command,
            id: crypto.randomUUID(),
            expectedVersion: 1,
            definition: { ...command.definition, examples: [{ ...example, questionId: ids[1] }] },
          }),
        ).toStrictEqual({ ok: false, code: 'invalid_input' });
        await withWorkspace(async (other) => {
          expect(
            await store.saveVersion(other, {
              ...command,
              id: crypto.randomUUID(),
              schemeId: crypto.randomUUID(),
            }),
          ).toStrictEqual({ ok: false, code: 'invalid_input' });
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);
