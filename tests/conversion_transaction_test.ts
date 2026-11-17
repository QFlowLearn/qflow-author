import { expect, test as testCase } from 'vitest';
import {
  cleanupFixture,
  createConversionFixture,
} from './helpers/conversion_transaction_fixture.ts';

import { createMemoryObjectStorage } from './memory_object_storage.ts';

import { eq, sql } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import {
  assessments,
  migrationItems,
  migrationRuns,
  questions,
  uploadsTable,
  users,
} from '../lib/db/schema.ts';
import { commitMigrationRun } from '../lib/import/migration_run_commit.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';

import { getQuestionRevision } from '../lib/services/questions.ts';
import type { ObjectWriteLifecycle } from '../lib/storage_contract.ts';

import { getAssessment } from '../lib/services/assessment_records.ts';

const NO_ASSET_STORAGE: ObjectWriteLifecycle = {
  putObject() {
    throw new Error('This fixture does not contain assets.');
  },
  deleteObject() {
    throw new Error('This fixture does not contain assets.');
  },
};

testCase(
  'conversion commit rolls back every authored row after a mid-transaction failure',
  async () => {
    let createdFixture: ConversionFixture | null = null;
    try {
      const fixture = await createConversionFixture({ includeInvalidItem: true });
      createdFixture = fixture;
      await expect(
        Promise.resolve().then(() =>
          commitMigrationRun(fixture.ctx, fixture.runId, {
            storage: NO_ASSET_STORAGE,
            approvedItemIds: fixture.itemIds,
            approval: true,
          })
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('is invalid')
      );
      expect(await tenantRowCount(questions, fixture.tenantId)).toStrictEqual(0);
      expect(await tenantRowCount(assessments, fixture.tenantId)).toStrictEqual(0);
      const run = await db.select({ status: migrationRuns.status })
        .from(migrationRuns)
        .where(eq(migrationRuns.id, fixture.runId))
        .limit(1);
      expect(run[0]?.status).toStrictEqual('analyzed');
    } finally {
      if (createdFixture) await cleanupFixture(createdFixture);
      else await shutdownDb().catch(() => {});
    }
  },
);

testCase(
  'conversion commit is idempotent and stale review commands cannot overwrite decisions',
  async () => {
    let createdFixture: ConversionFixture | null = null;
    try {
      const fixture = await createConversionFixture({ includeInvalidItem: false });
      createdFixture = fixture;
      const itemId = fixture.itemIds[0];
      await db.update(migrationItems).set({
        decision: 'pending',
        acceptedSnapshot: null,
        acceptedSnapshotHash: null,
        reviewedBy: null,
        reviewedAt: null,
      }).where(eq(migrationItems.id, itemId));
      const expected = {
        [itemId]: {
          contentHash: fixture.itemVersions[itemId].contentHash,
          contextHash: fixture.itemVersions[itemId].contextHash,
          decision: 'pending' as const,
        },
      };
      await updateMigrationItems(
        fixture.ctx,
        fixture.runId,
        [itemId],
        { kind: 'accept' },
        expected,
      );
      await expect(
        Promise.resolve().then(() =>
          updateMigrationItems(
            fixture.ctx,
            fixture.runId,
            [itemId],
            { kind: 'reject' },
            expected,
          )
        ),
      ).rejects.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('changed')
      );

      const accepted = await db.select().from(migrationItems)
        .where(eq(migrationItems.id, itemId))
        .limit(1);
      expect(accepted[0]?.decision).toStrictEqual('accepted');
      await db.update(users).set({
        displayName: 'Profile Changed After Acceptance',
        email: `changed-${fixture.userId.slice(0, 8)}@example.com`,
        emailNormalized: `changed-${fixture.userId.slice(0, 8)}@example.com`,
      }).where(eq(users.id, fixture.userId));
      await db.update(migrationRuns).set({
        approvalStatus: 'approved',
        submittedBy: fixture.userId,
        submittedAt: new Date(),
        decidedBy: fixture.userId,
        decidedAt: new Date(),
      }).where(eq(migrationRuns.id, fixture.runId));
      const first = await commitMigrationRun(fixture.ctx, fixture.runId, {
        storage: NO_ASSET_STORAGE,
        approvedItemIds: [itemId],
        approval: true,
      });
      const replay = await commitMigrationRun(fixture.ctx, fixture.runId, {
        storage: NO_ASSET_STORAGE,
        approvedItemIds: [itemId],
        approval: true,
      });
      expect(replay).toStrictEqual(first);
      expect(await tenantRowCount(questions, fixture.tenantId)).toStrictEqual(1);
      expect(await tenantRowCount(assessments, fixture.tenantId)).toStrictEqual(1);
      const committedItems = await db.select().from(migrationItems)
        .where(eq(migrationItems.id, itemId))
        .limit(1);
      const createdQuestionId = committedItems[0]?.createdQuestionId;
      const createdRevision = committedItems[0]?.createdRevision;
      if (!createdQuestionId || !createdRevision) {
        throw new Error('Committed conversion item is missing its question reference.');
      }
      const revision = await getQuestionRevision(
        fixture.ctx,
        createdQuestionId,
        createdRevision,
      );
      if (!revision) throw new Error('Committed question revision was not created.');
      expect(revision.provenance.origin._tag).toStrictEqual('Imported');
      if (revision.provenance.origin._tag !== 'Imported') {
        throw new Error('Committed conversion question is missing its imported origin.');
      }
      expect(revision.provenance.origin.assistance).toStrictEqual({
        _tag: 'DeterministicImport',
        adapter: { id: 'qti21', label: 'QTI 2.1', version: '1' },
      });
      expect(revision.provenance.origin.review.reviewer.id).toStrictEqual(fixture.userId);
      expect(revision.provenance.origin.providedBy.displayName).toStrictEqual(
        'Conversion Test User',
      );
      expect(revision.provenance.origin.review.reviewer.displayName).toStrictEqual(
        'Conversion Test User',
      );
      expect(revision.provenance.event.author.displayName).toStrictEqual(
        'Profile Changed After Acceptance',
      );
      expect(JSON.stringify(revision.provenance).includes('storageKey')).toStrictEqual(false);
    } finally {
      if (createdFixture) await cleanupFixture(createdFixture);
      else await shutdownDb().catch(() => {});
    }
  },
);

testCase('conversion commit rejects source XML changed after accepted review', async () => {
  let createdFixture: ConversionFixture | null = null;
  try {
    const fixture = await createConversionFixture({ includeInvalidItem: false });
    createdFixture = fixture;
    const itemId = fixture.itemIds[0];
    await db.update(migrationItems).set({
      sourceXml: '<qti-assessment-item identifier="changed-after-review"/>',
    }).where(eq(migrationItems.id, itemId));

    await expect(
      Promise.resolve().then(() =>
        commitMigrationRun(fixture.ctx, fixture.runId, {
          storage: NO_ASSET_STORAGE,
          approvedItemIds: [itemId],
          approval: true,
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('changed after its accepted review')
    );
    expect(await tenantRowCount(questions, fixture.tenantId)).toStrictEqual(0);
    expect(await tenantRowCount(assessments, fixture.tenantId)).toStrictEqual(0);
  } finally {
    if (createdFixture) await cleanupFixture(createdFixture);
    else await shutdownDb().catch(() => {});
  }
});

testCase('concurrent conversion commits clean only the losing attempt assets', async () => {
  let createdFixture: ConversionFixture | null = null;
  let stagingTimeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const fixture = await createConversionFixture({
      includeInvalidItem: false,
      includeAsset: true,
    });
    createdFixture = fixture;
    const writes: string[] = [];
    const deletes: string[] = [];
    let releaseStaging: (() => void) | undefined;
    const bothAttemptsStaged = new Promise<void>((resolve, reject) => {
      releaseStaging = () => {
        if (stagingTimeoutId !== undefined) clearTimeout(stagingTimeoutId);
        resolve();
      };
      stagingTimeoutId = setTimeout(
        () => reject(new Error('Both concurrent import attempts did not reach asset staging.')),
        2_000,
      );
    });
    const storage: ObjectWriteLifecycle = {
      async putObject(input) {
        writes.push(input.key);
        if (writes.length === 2) releaseStaging?.();
        await bothAttemptsStaged;
      },
      deleteObject(key) {
        deletes.push(key);
        return Promise.resolve();
      },
    };
    const commit = () =>
      commitMigrationRun(fixture.ctx, fixture.runId, {
        storage,
        approvedItemIds: fixture.itemIds,
        approval: true,
      });

    const [first, second] = await Promise.all([commit(), commit()]);

    expect(first).toStrictEqual(second);
    expect(writes.length).toStrictEqual(2);
    if (!(writes[0] !== writes[1])) expect.unreachable('Expected writes[0] !== writes[1]');
    expect(deletes.length).toStrictEqual(1);
    const storedUploads = await db.select({ path: uploadsTable.path }).from(uploadsTable)
      .where(eq(uploadsTable.tenantId, fixture.tenantId));
    expect(storedUploads.length).toStrictEqual(1);
    expect(writes.includes(storedUploads[0].path)).toStrictEqual(true);
    expect(deletes.includes(storedUploads[0].path)).toStrictEqual(false);
  } finally {
    if (stagingTimeoutId !== undefined) clearTimeout(stagingTimeoutId);
    if (createdFixture) await cleanupFixture(createdFixture);
    else await shutdownDb().catch(() => {});
  }
});

testCase(
  'conversion commit persists ordered question batches across chunk boundaries',
  async () => {
    let createdFixture: ConversionFixture | null = null;
    try {
      const fixture = await createConversionFixture({
        includeInvalidItem: false,
        validItemCount: 101,
      });
      createdFixture = fixture;

      const committed = await commitMigrationRun(fixture.ctx, fixture.runId, {
        storage: NO_ASSET_STORAGE,
        approvedItemIds: fixture.itemIds,
        approval: true,
      });

      expect(committed.itemResults.length).toStrictEqual(fixture.itemIds.length);
      expect(committed.itemResults.map((item) => item.href)).toStrictEqual(
        fixture.itemIds.map((_, index) => `items/${index + 1}.xml`),
      );
      expect(await tenantRowCount(questions, fixture.tenantId)).toStrictEqual(
        fixture.itemIds.length,
      );
    } finally {
      if (createdFixture) await cleanupFixture(createdFixture);
      else await shutdownDb().catch(() => {});
    }
  },
);

type ConversionFixture = Awaited<ReturnType<typeof createConversionFixture>>;

testCase(
  'conversion commits mixed unscored text without changing question count or replay identities',
  async () => {
    const text = '  Read <script> literally.\nThen answer.  ';
    const fixture = await createConversionFixture({
      includeInvalidItem: false,
      validItemCount: 2,
      text,
    });
    try {
      const options = {
        storage: NO_ASSET_STORAGE,
        approvedItemIds: fixture.itemIds,
        approval: true,
      };
      const result = await commitMigrationRun(fixture.ctx, fixture.runId, options);
      if (!(result.destination._tag === 'Assessment')) {
        expect.unreachable("Expected result.destination._tag === 'Assessment'");
      }
      const saved = await getAssessment(fixture.ctx, result.destination.assessmentId);
      if (!saved) expect.unreachable('Expected saved');
      expect(saved.targetCount).toStrictEqual(2);
      expect(saved.parts[0].placements.length).toStrictEqual(3);
      const placement = saved.parts[0].placements[1];
      if (!('content' in placement)) expect.unreachable("Expected 'content' in placement");
      expect(placement.content).toStrictEqual({ kind: 'text', text });
      expect(placement.fixed).toStrictEqual(true);
      expect(await commitMigrationRun(fixture.ctx, fixture.runId, options)).toStrictEqual(result);
      expect((await getAssessment(fixture.ctx, result.destination.assessmentId))?.parts)
        .toStrictEqual(saved.parts);
      expect(await tenantRowCount(questions, fixture.tenantId)).toStrictEqual(2);
    } finally {
      await cleanupFixture(fixture);
    }
  },
);

async function tenantRowCount(
  table: typeof questions | typeof assessments,
  tenantId: string,
): Promise<number> {
  const rows = await db.select({ count: sql<number>`COUNT(*)` })
    .from(table)
    .where(eq(table.tenantId, tenantId));
  return Number(rows[0]?.count ?? 0);
}

testCase(
  'bank commit retains referenced assets and replays without new objects or assessments',
  async () => {
    const fixture = await createConversionFixture({
      includeInvalidItem: false,
      includeAsset: true,
      bank: true,
    });
    const storage = createMemoryObjectStorage();
    try {
      const options = { storage, approvedItemIds: fixture.itemIds, approval: true };
      const first = await commitMigrationRun(fixture.ctx, fixture.runId, options);
      expect(first.destination).toStrictEqual({ _tag: 'WorkspaceBank', collectionId: null });
      const before = await db.select().from(uploadsTable).where(
        eq(uploadsTable.tenantId, fixture.tenantId),
      );
      expect(before.length).toStrictEqual(1);
      expect(await storage.readObject(before[0].path)).toStrictEqual(new Uint8Array([1, 2, 3]));
      expect(await commitMigrationRun(fixture.ctx, fixture.runId, options)).toStrictEqual(first);
      expect(
        await db.select().from(uploadsTable).where(eq(uploadsTable.tenantId, fixture.tenantId)),
      ).toStrictEqual(before);
      expect(await tenantRowCount(assessments, fixture.tenantId)).toStrictEqual(0);
    } finally {
      await cleanupFixture(fixture);
    }
  },
);

testCase(
  'conversion commits an unscored image through the same owned asset staging and replay path',
  async () => {
    const fixture = await createConversionFixture({
      includeInvalidItem: false,
      includeAsset: true,
      content: [{
        kind: 'image',
        src: 'assets/a.png',
        alt: 'Imported image description',
        longDescription: 'Literal long description.',
      }],
    });
    const storage = createMemoryObjectStorage();
    try {
      const options = { storage, approvedItemIds: fixture.itemIds, approval: true };
      const committed = await commitMigrationRun(fixture.ctx, fixture.runId, options);
      if (!(committed.destination._tag === 'Assessment')) {
        expect.unreachable("Expected committed.destination._tag === 'Assessment'");
      }
      const assessment = await getAssessment(fixture.ctx, committed.destination.assessmentId);
      if (!assessment) expect.unreachable('Expected assessment');
      expect(assessment.targetCount).toStrictEqual(1);
      const placement = assessment.parts[0].placements[1];
      if (!('content' in placement && placement.content.kind === 'image')) {
        expect.unreachable("Expected 'content' in placement && placement.content.kind === 'image'");
      }
      expect(placement.content.alt).toStrictEqual('Imported image description');
      expect(placement.content.longDescription).toStrictEqual('Literal long description.');
      const stored = await db.select().from(uploadsTable).where(
        eq(uploadsTable.tenantId, fixture.tenantId),
      );
      expect(stored.length).toStrictEqual(1);
      expect(placement.content.src).toStrictEqual(stored[0].url);
      expect(await storage.readObject(stored[0].path)).toStrictEqual(new Uint8Array([1, 2, 3]));
      expect(await commitMigrationRun(fixture.ctx, fixture.runId, options)).toStrictEqual(
        committed,
      );
      expect((await getAssessment(fixture.ctx, committed.destination.assessmentId))?.parts)
        .toStrictEqual(assessment.parts);
    } finally {
      await cleanupFixture(fixture);
    }
  },
);
