import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { placementApiRoute as removeRouteEndpoint } from '../lib/http/routes/assessment_api/placement.ts';
import { removalsApiRoute as listRouteEndpoint } from '../lib/http/routes/assessment_api/removals.ts';
import { restoreApiRoute as restoreRouteEndpoint } from '../lib/http/routes/assessment_api/restore.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { prepareQuestionPublication } from '../lib/services/publish.ts';
import { saveQuestionRevisionInTransaction } from '../lib/services/questions.ts';

import { and, eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentParts,
  assessmentPlacementRemovals,
  assessmentPlacements,
  assessments,
  organizationMemberships,
  questionRevisions,
  questions,
} from '../lib/db/schema.ts';
import { parseAssessmentBlueprint } from '../lib/assessment_blueprint.ts';
import {
  createAssessmentPlacementRemovalService,
  PLACEMENT_REMOVAL_WINDOW_MS,
} from '../lib/services/assessment_placement_removal.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { setPlacementFollowLatest } from '../lib/services/assessment_structure.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { RequestContext } from '../lib/tenants.ts';

const removeRoute = removeRouteEndpoint.handle;
const listRoute = listRouteEndpoint.handle;
const restoreRoute = restoreRouteEndpoint.handle;

async function fixture(ctx: RequestContext) {
  const blueprint = parseAssessmentBlueprint({
    _tag: 'Defined',
    version: 1,
    outcomes: [{ id: 'cities', title: 'Identify cities', weight: 100 }],
    targets: [{
      id: 'target',
      outcomeId: 'cities',
      count: 3,
      cognitiveDemand: 'remember',
      difficulty: 'easy',
      questionType: 'single_select',
    }],
  });
  const assessment = await createAssessmentDraft(ctx, { title: 'Placement recovery', blueprint });
  const initial = await getAssessment(ctx, assessment.id);
  assertQuestionOnlyAssessmentFixture(initial);
  const partId = initial.parts[0].id;
  const items = [];
  for (const title of ['First', 'Middle', 'Last']) {
    const saved = await saveAssessmentQuestion(ctx, assessment.id, {
      _tag: 'Create',
      partId,
      blueprintTargetId: 'target',
      draft: {
        type: 'single_select',
        itemLanguage: newAuthoringItemLanguage(),
        title,
        bodyHtml: '<p>Which city is in France?</p>',
        choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
        correctId: 'A',
      },
    });
    if (!(saved.ok)) expect.unreachable('Expected saved.ok');
    items.push(saved.value);
  }
  return { assessmentId: assessment.id, partId, items };
}

async function placements(partId: string) {
  return await db.select().from(assessmentPlacements).where(
    eq(assessmentPlacements.assessmentPartId, partId),
  ).orderBy(assessmentPlacements.position);
}

testCase(
  'saved removal reloads and restores exact placement, revision policy, alignment and immutable publications with safe retries',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const f = await fixture(ctx);
        try {
          let instant = new Date('2026-10-06T12:00:00.000Z');
          const service = createAssessmentPlacementRemovalService({
            database: db,
            now: () => instant,
          });
          const middle = f.items[1];
          const original = await placements(f.partId);
          const revisions = await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          );
          const [revision] = revisions.filter((row) => row.questionId === middle.itemId);
          if (!revision) expect.unreachable('Expected revision');
          const versionId = crypto.randomUUID(), linkId = crypto.randomUUID();
          await db.execute(
            sql`INSERT INTO assessment_versions (id, assessment_id, version, label, published_at, published_by) VALUES (${versionId}, ${f.assessmentId}, 1, 'Immutable QA edition', now(), ${ctx.userId})`,
          );
          await db.execute(
            sql`INSERT INTO assessment_question_links (id, assessment_version_id, question_revision_id, position, points) VALUES (${linkId}, ${versionId}, ${revision.id}, 2, 1)`,
          );
          const published = await db.execute(
            sql`SELECT * FROM assessment_question_links WHERE assessment_version_id = ${versionId}`,
          );
          const command = { removalId: crypto.randomUUID(), expectedRevision: 1 };
          const removed = await service.remove(ctx, f.assessmentId, middle.placementId, command);
          if (!(removed.ok)) expect.unreachable('Expected removed.ok');
          expect(removed.value.snapshotRev).toStrictEqual(1);
          expect(removed.value.blueprintTargetId).toStrictEqual('target');
          expect((await placements(f.partId)).map((row) => row.id)).toStrictEqual([
            f.items[0].placementId,
            f.items[2].placementId,
          ]);
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(2);
          expect(await service.remove(ctx, f.assessmentId, middle.placementId, command))
            .toStrictEqual(removed);
          const reloaded = createAssessmentPlacementRemovalService({
            database: db,
            now: () => instant,
          });
          expect(await reloaded.list(ctx, f.assessmentId)).toStrictEqual({
            ok: true,
            value: [removed.value],
          });
          const restored = await Promise.all([
            reloaded.restore(ctx, f.assessmentId, command.removalId),
            service.restore(ctx, f.assessmentId, command.removalId),
          ]);
          if (!(restored[0].ok && restored[1].ok)) {
            expect.unreachable('Expected restored[0].ok && restored[1].ok');
          }
          expect(restored[0].value.beforePlacementId).toStrictEqual(f.items[2].placementId);
          expect(await service.list(ctx, f.assessmentId)).toStrictEqual({ ok: true, value: [] });
          expect(restored[0]).toStrictEqual(restored[1]);
          expect(await placements(f.partId)).toStrictEqual(original);
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(3);
          expect(
            await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, ctx.tenantId),
            ),
          ).toStrictEqual(revisions);
          expect(
            await db.execute(
              sql`SELECT * FROM assessment_question_links WHERE assessment_version_id = ${versionId}`,
            ),
          ).toStrictEqual(published);
          instant = new Date(instant.getTime() + PLACEMENT_REMOVAL_WINDOW_MS + 1);
          if (!((await service.restore(ctx, f.assessmentId, command.removalId)).ok)) {
            expect.unreachable(
              'Expected (await service.restore(ctx, f.assessmentId, command.removalId)).ok',
            );
          }
          expect(await placements(f.partId)).toStrictEqual(original);
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(3);
          await setPlacementFollowLatest(ctx, f.assessmentId, middle.placementId);
          const latestRemoved = await service.remove(ctx, f.assessmentId, middle.placementId, {
            removalId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          if (!(latestRemoved.ok && latestRemoved.value.snapshotRev === null)) {
            expect.unreachable(
              'Expected latestRemoved.ok && latestRemoved.value.snapshotRev === null',
            );
          }
          const publication = await prepareQuestionPublication(ctx, {
            ...restored[0].value.draft,
            itemId: middle.itemId,
            title: 'Later bank revision',
          });
          if (!(publication.ok)) expect.unreachable('Expected publication.ok');
          await db.transaction((tx) =>
            saveQuestionRevisionInTransaction(tx, ctx, publication.prepared.saveInput)
          );
          const follow = await service.restore(ctx, f.assessmentId, latestRemoved.value.id);
          if (!(follow.ok)) expect.unreachable('Expected follow.ok');
          expect(follow.value.placement.snapshotRev).toStrictEqual(null);
          expect(follow.value.revision).toStrictEqual(2);
          expect(follow.value.draft.title).toStrictEqual('Later bank revision');
          expect((await placements(f.partId))[1].pinnedRevision).toStrictEqual(null);
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(3);
        } finally {
          await deleteAssessment(ctx, f.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'saved recovery handles chronological removals and rejects changed part order without overwriting questions',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const f = await fixture(ctx);
        try {
          const service = createAssessmentPlacementRemovalService({
            database: db,
            now: () => new Date('2026-10-06T12:00:00.000Z'),
          });
          const a = await service.remove(ctx, f.assessmentId, f.items[0].placementId, {
            removalId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          const b = await service.remove(ctx, f.assessmentId, f.items[1].placementId, {
            removalId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          if (!(a.ok && b.ok)) expect.unreachable('Expected a.ok && b.ok');
          const history = await service.list(ctx, f.assessmentId);
          if (!(history.ok)) expect.unreachable('Expected history.ok');
          expect(history.value.map((row) => row.id)).toStrictEqual([b.value.id, a.value.id]);
          expect(await service.restore(ctx, f.assessmentId, a.value.id)).toStrictEqual({
            ok: false,
            code: 'conflict',
          });
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(1);
          if (!((await service.restore(ctx, f.assessmentId, b.value.id)).ok)) {
            expect.unreachable(
              'Expected (await service.restore(ctx, f.assessmentId, b.value.id)).ok',
            );
          }
          if (!((await service.restore(ctx, f.assessmentId, a.value.id)).ok)) {
            expect.unreachable(
              'Expected (await service.restore(ctx, f.assessmentId, a.value.id)).ok',
            );
          }
          expect((await placements(f.partId)).map((row) => row.id)).toStrictEqual(
            f.items.map((item) => item.placementId),
          );
          const removed = await service.remove(ctx, f.assessmentId, f.items[1].placementId, {
            removalId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          if (!(removed.ok)) expect.unreachable('Expected removed.ok');
          const current = await getAssessment(ctx, f.assessmentId);
          assertQuestionOnlyAssessmentFixture(current);
          await saveAssessmentArrangementFixture(
            ctx,
            f.assessmentId,
            current.parts.map((part) => ({ ...part, placements: [...part.placements].reverse() })),
          );
          const before = await placements(f.partId);
          expect(await service.restore(ctx, f.assessmentId, removed.value.id)).toStrictEqual({
            ok: false,
            code: 'conflict',
          });
          expect(await placements(f.partId)).toStrictEqual(before);
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(2);
        } finally {
          await deleteAssessment(ctx, f.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'saved recovery rechecks actor, workspace authority, revision, expiry and missing parts',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const f = await fixture(ctx);
        try {
          let instant = new Date('2026-10-06T12:00:00.000Z');
          const service = createAssessmentPlacementRemovalService({
            database: db,
            now: () => instant,
          });
          const command = { removalId: crypto.randomUUID(), expectedRevision: 2 };
          expect(await service.remove(ctx, f.assessmentId, f.items[1].placementId, command))
            .toStrictEqual({
              ok: false,
              code: 'conflict',
            });
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(3);
          const removed = await service.remove(ctx, f.assessmentId, f.items[1].placementId, {
            ...command,
            expectedRevision: 1,
          });
          if (!(removed.ok)) expect.unreachable('Expected removed.ok');
          await withEnrichmentWorkspace(async (other) => {
            expect(await service.restore(other, f.assessmentId, removed.value.id)).toStrictEqual({
              ok: false,
              code: 'not_found',
            });
            await db.insert(organizationMemberships).values({
              id: crypto.randomUUID(),
              tenantId: ctx.tenantId,
              userId: other.userId,
              role: 'instructor',
            });
            const anotherAuthor = { ...other, tenantId: ctx.tenantId, role: 'instructor' as const };
            expect(await service.list(anotherAuthor, f.assessmentId)).toStrictEqual({
              ok: true,
              value: [],
            });
            expect(await service.restore(anotherAuthor, f.assessmentId, removed.value.id))
              .toStrictEqual({
                ok: false,
                code: 'not_found',
              });
          });
          await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
            and(
              eq(organizationMemberships.tenantId, ctx.tenantId),
              eq(organizationMemberships.userId, ctx.userId),
            ),
          );
          expect(await service.restore(ctx, f.assessmentId, removed.value.id)).toStrictEqual({
            ok: false,
            code: 'forbidden',
          });
          await db.update(organizationMemberships).set({ role: 'owner' }).where(
            and(
              eq(organizationMemberships.tenantId, ctx.tenantId),
              eq(organizationMemberships.userId, ctx.userId),
            ),
          );
          instant = new Date(instant.getTime() + PLACEMENT_REMOVAL_WINDOW_MS);
          expect(await service.restore(ctx, f.assessmentId, removed.value.id)).toStrictEqual({
            ok: false,
            code: 'expired',
          });
          expect(await service.list(ctx, f.assessmentId)).toStrictEqual({ ok: true, value: [] });
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(2);
          instant = new Date('2026-10-06T12:00:00.000Z');
          await db.delete(assessmentParts).where(eq(assessmentParts.id, f.partId));
          expect(await service.restore(ctx, f.assessmentId, removed.value.id)).toStrictEqual({
            ok: false,
            code: 'unavailable',
          });
          expect(
            (await db.select().from(questions).where(eq(questions.tenantId, ctx.tenantId))).length,
          ).toStrictEqual(3);
        } finally {
          await deleteAssessment(ctx, f.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'saved removal and recovery roll back their receipt, placement and count together on store failure',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const f = await fixture(ctx);
        try {
          const database = {
            transaction: <T>(operation: Parameters<typeof db.transaction<T>>[0]) =>
              db.transaction(async (tx) => {
                await operation(tx);
                throw new Error('QA rollback before commit');
              }),
          };
          const service = createAssessmentPlacementRemovalService({
            database,
            now: () => new Date('2026-10-06T12:00:00.000Z'),
          });
          const normal = createAssessmentPlacementRemovalService({
            database: db,
            now: () => new Date('2026-10-06T12:00:00.000Z'),
          });
          const original = await placements(f.partId);
          const command = { removalId: crypto.randomUUID(), expectedRevision: 1 };
          expect(await service.remove(ctx, f.assessmentId, f.items[1].placementId, command))
            .toStrictEqual({
              ok: false,
              code: 'storage_failed',
            });
          expect(await placements(f.partId)).toStrictEqual(original);
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(3);
          expect(
            await db.select().from(assessmentPlacementRemovals).where(
              eq(assessmentPlacementRemovals.assessmentId, f.assessmentId),
            ),
          ).toStrictEqual([]);
          const removed = await normal.remove(ctx, f.assessmentId, f.items[1].placementId, command);
          if (!(removed.ok)) expect.unreachable('Expected removed.ok');
          expect(await service.restore(ctx, f.assessmentId, command.removalId)).toStrictEqual({
            ok: false,
            code: 'storage_failed',
          });
          expect((await placements(f.partId)).length).toStrictEqual(2);
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(2);
          expect(await normal.list(ctx, f.assessmentId)).toStrictEqual({
            ok: true,
            value: [removed.value],
          });
        } finally {
          await deleteAssessment(ctx, f.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'saved removal routes parse commands before mutation and expose reload/retry recovery',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const f = await fixture(ctx);
        try {
          const pid = f.items[1].placementId, id = f.assessmentId, removalId = crypto.randomUUID();
          const request = (
            handler: typeof removeRoute,
            method: 'GET' | 'POST' | 'DELETE',
            params: Record<string, string>,
            body?: unknown,
          ) =>
            invokeHttpRoute(
              handler,
              makeHttpRequest(
                new Request(`http://localhost/api/assessments/${id}/placements/${pid}`, {
                  method,
                  ...(body === undefined ? {} : {
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                  }),
                }),
                { auth: ctx, params },
              ),
            );
          for (
            const body of [
              undefined,
              {},
              { removalId, expectedRevision: 1, extra: true },
              { removalId: 'bad', expectedRevision: 1 },
            ]
          ) {
            expect((await request(removeRoute, 'DELETE', { id, pid }, body)).status).toStrictEqual(
              400,
            );
          }
          expect((await getAssessment(ctx, id))?.targetCount).toStrictEqual(3);
          const removed = await request(
            removeRoute,
            'DELETE',
            { id, pid },
            { removalId, expectedRevision: 1 },
          );
          expect(removed.status).toStrictEqual(200);
          const receipt: unknown = await removed.json();
          expect(
            await (await request(
              removeRoute,
              'DELETE',
              { id, pid },
              { removalId, expectedRevision: 1 },
            )).json(),
          ).toStrictEqual(receipt);
          const listed = await request(listRoute, 'GET', { id });
          expect(listed.status).toStrictEqual(200);
          expect(listed.headers.get('cache-control')).toStrictEqual('no-store');
          expect((await request(restoreRoute, 'POST', { id, rid: 'bad' })).status).toStrictEqual(
            400,
          );
          expect((await request(restoreRoute, 'POST', { id, rid: removalId })).status)
            .toStrictEqual(200);
          expect((await request(restoreRoute, 'POST', { id, rid: removalId })).status)
            .toStrictEqual(200);
          expect((await getAssessment(ctx, id))?.targetCount).toStrictEqual(3);
          expect((await placements(f.partId)).map((row) => row.id)).toStrictEqual(
            f.items.map((item) => item.placementId),
          );
        } finally {
          await deleteAssessment(ctx, f.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'recovery preserves the pinned title and rejects unavailable content, changed alignment and reused placement identities',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const f = await fixture(ctx);
        const other = await createAssessmentDraft(ctx, { title: 'Other assessment' });
        try {
          const service = createAssessmentPlacementRemovalService({
            database: db,
            now: () => new Date('2026-10-06T12:00:00.000Z'),
          });
          const original = (await placements(f.partId))[1];
          if (!(original.questionId !== null)) {
            expect.unreachable('Expected original.questionId !== null');
          }
          const first = await service.remove(ctx, f.assessmentId, original.id, {
            removalId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          if (!(first.ok)) expect.unreachable('Expected first.ok');
          const restored = await service.restore(ctx, f.assessmentId, first.value.id);
          if (!(restored.ok)) expect.unreachable('Expected restored.ok');
          const publication = await prepareQuestionPublication(ctx, {
            ...restored.value.draft,
            itemId: original.questionId,
            title: 'New bank title',
          });
          if (!(publication.ok)) expect.unreachable('Expected publication.ok');
          await db.transaction((tx) =>
            saveQuestionRevisionInTransaction(tx, ctx, publication.prepared.saveInput)
          );
          const removed = await service.remove(ctx, f.assessmentId, original.id, {
            removalId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          if (!(removed.ok)) expect.unreachable('Expected removed.ok');
          expect(removed.value.title).toStrictEqual('Middle');
          await db.update(questions).set({
            lifecycleState: 'archived',
            archivedAt: new Date(),
            archivedBy: ctx.userId,
          }).where(
            eq(questions.id, original.questionId),
          );
          expect(await service.restore(ctx, f.assessmentId, removed.value.id)).toStrictEqual({
            ok: false,
            code: 'unavailable',
          });
          await db.update(questions).set({
            lifecycleState: 'active',
            archivedAt: null,
            archivedBy: null,
          }).where(
            eq(questions.id, original.questionId),
          );
          const assessment = await getAssessment(ctx, f.assessmentId);
          assertQuestionOnlyAssessmentFixture(assessment);
          // Simulate a concurrent persisted blueprint replacement after the placement was removed.
          await db.update(assessments).set({
            blueprint: parseAssessmentBlueprint({ _tag: 'Unspecified', version: 1 }),
          }).where(eq(assessments.id, f.assessmentId));
          expect(await service.restore(ctx, f.assessmentId, removed.value.id)).toStrictEqual({
            ok: false,
            code: 'conflict',
          });
          await db.update(assessments).set({ blueprint: assessment.blueprint }).where(
            eq(assessments.id, f.assessmentId),
          );
          const otherAssessment = await getAssessment(ctx, other.id);
          assertQuestionOnlyAssessmentFixture(otherAssessment);
          await db.insert(assessmentPlacements).values({
            ...original,
            assessmentPartId: otherAssessment.parts[0].id,
          });
          expect(await service.restore(ctx, f.assessmentId, removed.value.id)).toStrictEqual({
            ok: false,
            code: 'conflict',
          });
          expect((await getAssessment(ctx, f.assessmentId))?.targetCount).toStrictEqual(2);
          expect((await placements(otherAssessment.parts[0].id))[0].id).toStrictEqual(original.id);
        } finally {
          await deleteAssessment(ctx, other.id);
          await deleteAssessment(ctx, f.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
