import { expect, test as testCase } from 'vitest';

import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';

import { count, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { bankCollectionItems } from '../lib/db/bank_schema.ts';
import { enrichmentSchemeVersions } from '../lib/db/bank_enrichment_schema.ts';
import {
  organizationItems,
  organizationRuns,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';

testCase(
  'failed preview rolls back vocabulary and setup; corrected input works without reload',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const command = {
        operationId: crypto.randomUUID(),
        collectionId: f.destinationId,
        expectedVersion: 0,
        definition: { ...enrichmentDefinitionFixture(), name: 'New vocabulary' },
        filing: [],
        sourceMappings: [],
      };
      const classifier = { kind: 'source_only' } as const;
      expect(await workspace.preview(f.ctx, command, classifier)).toStrictEqual({
        ok: false,
        code: 'empty_scope',
      });
      expect(await workspace.preview(f.ctx, command, classifier)).toStrictEqual({
        ok: false,
        code: 'empty_scope',
      });
      expect(
        await db.select({ total: count() }).from(organizationSetups).where(
          eq(organizationSetups.tenantId, f.ctx.tenantId),
        ),
      ).toStrictEqual([{ total: 1 }]);
      expect(
        await db.select({ total: count() }).from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.tenantId, f.ctx.tenantId),
        ),
      ).toStrictEqual([{ total: 1 }]);
      await db.insert(bankCollectionItems).values({
        tenantId: f.ctx.tenantId,
        collectionId: f.destinationId,
        questionId: f.ids[0],
        position: 0,
      });
      const corrected = {
        ...command,
        operationId: crypto.randomUUID(),
        definition: { ...command.definition, name: 'Corrected vocabulary' },
      };
      const result = await workspace.preview(f.ctx, corrected, classifier);
      if (!(result.ok)) expect.unreachable('Expected result.ok');
      expect(await workspace.preview(f.ctx, corrected, classifier)).toStrictEqual(result);
    });
  },
);

testCase(
  'collection preview rejects 10001 without saving setup, accepts 10000 and queues the full scope',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const [question] = await db.select().from(questions).where(eq(questions.id, f.ids[0]));
      const [revision] = await db.select().from(questionRevisions).where(
        eq(questionRevisions.id, question.latestRevisionId!),
      );
      // Copy a valid published fixture in bounded writes; no model calls are needed for scope validation.
      for (let offset = 0; offset < 9998; offset += 500) {
        const copies = Array.from(
          { length: Math.min(500, 9998 - offset) },
          () => ({ id: crypto.randomUUID(), revisionId: crypto.randomUUID() }),
        );
        await db.transaction(async (tx) => {
          await tx.insert(questions).values(
            copies.map((c) => ({ ...question, id: c.id, stableKey: c.id, latestRevisionId: null })),
          );
          await tx.insert(questionRevisions).values(
            copies.map((c) => ({ ...revision, id: c.revisionId, questionId: c.id })),
          );
          await tx.execute(
            sql`UPDATE questions q SET latest_revision_id = r.id FROM question_revisions r WHERE q.tenant_id = ${f.ctx.tenantId} AND r.question_id = q.id AND q.latest_revision_id IS NULL`,
          );
          await tx.insert(bankCollectionItems).values(
            copies.map((c, i) => ({
              tenantId: f.ctx.tenantId,
              collectionId: f.originId,
              questionId: c.id,
              position: offset + i,
            })),
          );
        });
      }
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const command = {
        operationId: crypto.randomUUID(),
        collectionId: f.originId,
        expectedVersion: 1,
        definition: { ...enrichmentDefinitionFixture(), name: 'Ten thousand questions' },
        filing: [],
        sourceMappings: [],
      };
      expect(await workspace.preview(f.ctx, command, { kind: 'source_only' })).toStrictEqual({
        ok: false,
        code: 'scope_too_large',
      });
      expect(
        await db.select({ total: count() }).from(organizationSetups).where(
          eq(organizationSetups.tenantId, f.ctx.tenantId),
        ),
      ).toStrictEqual([{ total: 1 }]);
      expect(
        await db.select({ total: count() }).from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.tenantId, f.ctx.tenantId),
        ),
      ).toStrictEqual([{ total: 1 }]);
      await db.update(questions).set({ latestRevisionId: null }).where(eq(questions.id, f.ids[0]));
      const preview = await workspace.preview(f.ctx, command, { kind: 'source_only' });
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      expect(
        await db.select({ total: count() }).from(organizationItems).where(
          eq(organizationItems.runId, preview.value),
        ),
      ).toStrictEqual([{ total: 100 }]);
      const progress = await workspace.run(f.ctx, preview.value);
      if (!(progress.ok)) expect.unreachable('Expected progress.ok');
      const run = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: progress.value.setupId,
        mode: 'apply',
      });
      if (!(run.ok)) expect.unreachable('Expected run.ok');
      expect(
        await db.select({ total: count() }).from(organizationItems).where(
          eq(organizationItems.runId, run.value),
        ),
      ).toStrictEqual([{ total: 10000 }]);
      if (!((await cancelOrganizationRun(db, f.ctx, run.value)).ok)) {
        expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, run.value)).ok');
      }
      if (!((await completeOrganizationUndoForTest(db, f.ctx, run.value, organizationNow())).ok)) {
        expect.unreachable(
          'Expected (await completeOrganizationUndoForTest(db, f.ctx, run.value, organizationNow())).ok',
        );
      }
      expect(
        await db.select({
          state: organizationRuns.state,
          processed: organizationRuns.undoProcessed,
        })
          .from(organizationRuns).where(eq(organizationRuns.id, run.value)),
      ).toStrictEqual([{ state: 'undone', processed: 10000 }]);
    });
  },
);
