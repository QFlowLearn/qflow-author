import { expect, test as testCase } from 'vitest';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentQuestionCopies } from '../lib/db/assessment_copy_schema.ts';
import { assessmentPlacements } from '../lib/db/assessment_schema.ts';
import { organizationMemberships, users } from '../lib/db/principal_schema.ts';
import { questions } from '../lib/db/question_schema.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import {
  saveAssessmentQuestion,
  type SaveAssessmentQuestionCommand,
} from '../lib/services/assessment_question_authoring.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

type CopyCommand = Extract<SaveAssessmentQuestionCommand, { readonly _tag: 'Variant' }>;

async function createSource(ctx: RequestContext) {
  const assessment = await createAssessmentDraft(ctx, { title: 'Copy retry acceptance' });
  const initial = await getAssessment(ctx, assessment.id);
  if (!initial) expect.unreachable('Expected initial');
  const source = await saveAssessmentQuestion(ctx, assessment.id, {
    _tag: 'Create',
    partId: initial.parts[0].id,
    draft: {
      type: 'single_select',
      title: 'Copy this source',
      itemLanguage: newAuthoringItemLanguage(),
      bodyHtml: '<p>Choose a city. <a href="https://example.com/cities">City reference</a></p>',
      maximumScore: 3.125,
      choices: [
        { id: 'A', html: '<p><strong>Paris</strong></p>', fixed: true },
        { id: 'B', text: 'Berlin', label: 'City' },
      ],
      correctId: 'A',
    },
  });
  if (!(source.ok)) expect.unreachable('Expected source.ok');
  const command: CopyCommand = {
    _tag: 'Variant',
    requestId: crypto.randomUUID(),
    partId: initial.parts[0].id,
    sourcePlacementId: source.value.placementId,
    sourceItemId: source.value.itemId,
    sourceRevision: 1,
    targetType: 'single_select',
  };
  return { assessmentId: assessment.id, source: source.value, command };
}

async function workspaceState(ctx: RequestContext, assessmentId: string) {
  const assessment = await getAssessment(ctx, assessmentId);
  if (!assessment) expect.unreachable('Expected assessment');
  return {
    assessment,
    questionIds: (await db.select({ id: questions.id }).from(questions)
      .where(eq(questions.tenantId, ctx.tenantId))).map((row) => row.id).sort(),
    receipts: await db.select().from(assessmentQuestionCopies)
      .where(eq(assessmentQuestionCopies.tenantId, ctx.tenantId)),
  };
}

testCase(
  'copy retries replay once under concurrency, preserving source and independent copies',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const fixture = await createSource(ctx);
        try {
          const before = await getQuestionRevision(ctx, fixture.source.itemId, 1);
          if (!before) expect.unreachable('Expected before');
          const results = await Promise.allSettled([
            saveAssessmentQuestion(ctx, fixture.assessmentId, fixture.command),
            saveAssessmentQuestion(ctx, fixture.assessmentId, fixture.command),
          ]);
          const values = results.map((result) => {
            if (!(result.status === 'fulfilled')) {
              expect.unreachable("Expected result.status === 'fulfilled'");
            }
            if (!(result.value.ok)) expect.unreachable('Expected result.value.ok');
            return result.value.value;
          });
          expect(values[0]).toStrictEqual(values[1]);
          if (!(values[0].itemId !== fixture.source.itemId)) {
            expect.unreachable('Expected values[0].itemId !== fixture.source.itemId');
          }
          const committed = await workspaceState(ctx, fixture.assessmentId);
          expect(committed.questionIds.length).toStrictEqual(2);
          expect(committed.receipts.length).toStrictEqual(1);
          const replay = await saveAssessmentQuestion(ctx, fixture.assessmentId, fixture.command);
          if (!(replay.ok)) expect.unreachable('Expected replay.ok');
          expect(replay.value).toStrictEqual(values[0]);
          expect(await workspaceState(ctx, fixture.assessmentId)).toStrictEqual(committed);
          const independent = await saveAssessmentQuestion(ctx, fixture.assessmentId, {
            ...fixture.command,
            requestId: crypto.randomUUID(),
          });
          if (!(independent.ok)) expect.unreachable('Expected independent.ok');
          if (!(independent.value.itemId !== values[0].itemId)) {
            expect.unreachable('Expected independent.value.itemId !== values[0].itemId');
          }
          const saved = await workspaceState(ctx, fixture.assessmentId);
          expect(saved.questionIds.length).toStrictEqual(3);
          expect(saved.receipts.length).toStrictEqual(2);
          expect(
            assessmentQuestionPlacements(saved.assessment.parts[0].placements).map((row) => row.id),
          ).toStrictEqual([
            fixture.source.placementId,
            independent.value.placementId,
            values[0].placementId,
          ]);
          const copied = await getQuestionRevision(ctx, values[0].itemId, 1);
          if (!copied) expect.unreachable('Expected copied');
          // The independent generated copy deliberately does not retain source-XML preservation mode.
          expect(copied.body).toStrictEqual({ ...before.body, preserveSourceXml: false });
          expect(await getQuestionRevision(ctx, fixture.source.itemId, 1)).toStrictEqual(before);
          // A committed replay does not need the source placement still to exist.
          await db.delete(assessmentPlacements).where(
            eq(assessmentPlacements.id, fixture.source.placementId),
          );
          const withoutSource = await saveAssessmentQuestion(
            ctx,
            fixture.assessmentId,
            fixture.command,
          );
          if (!(withoutSource.ok)) expect.unreachable('Expected withoutSource.ok');
          expect(withoutSource.value).toStrictEqual(values[0]);
        } finally {
          await deleteAssessment(ctx, fixture.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'copy receipts reject changed commands, revoked authority and removed or revised copies',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const fixture = await createSource(ctx);
        try {
          const copy = await saveAssessmentQuestion(ctx, fixture.assessmentId, fixture.command);
          if (!(copy.ok)) expect.unreachable('Expected copy.ok');
          const committed = await workspaceState(ctx, fixture.assessmentId);
          for (
            const patch of [
              { targetType: 'multi_select' as const },
              { sourceRevision: 2 },
              { sourcePlacementId: crypto.randomUUID() },
              { sourceItemId: crypto.randomUUID() },
              { partId: crypto.randomUUID() },
              { blueprintTargetId: 'other-target' },
            ]
          ) {
            const conflict = await saveAssessmentQuestion(ctx, fixture.assessmentId, {
              ...fixture.command,
              ...patch,
            });
            if (conflict.ok) expect.unreachable('Expected !conflict.ok');
            expect(conflict.status).toStrictEqual(409);
            expect(conflict.error.error).toStrictEqual('copy_request_conflict');
            expect(await workspaceState(ctx, fixture.assessmentId)).toStrictEqual(committed);
          }
          await db.update(organizationMemberships).set({ role: 'viewer' }).where(and(
            eq(organizationMemberships.tenantId, ctx.tenantId),
            eq(organizationMemberships.userId, ctx.userId),
          ));
          const forbidden = await saveAssessmentQuestion(
            ctx,
            fixture.assessmentId,
            fixture.command,
          );
          if (forbidden.ok) expect.unreachable('Expected !forbidden.ok');
          expect(forbidden.status).toStrictEqual(403);
          expect(await workspaceState(ctx, fixture.assessmentId)).toStrictEqual(committed);
          await db.update(organizationMemberships).set({ role: 'owner' }).where(and(
            eq(organizationMemberships.tenantId, ctx.tenantId),
            eq(organizationMemberships.userId, ctx.userId),
          ));
          const copyRevision = await getQuestionRevision(ctx, copy.value.itemId, 1);
          if (!copyRevision) expect.unreachable('Expected copyRevision');
          const editedCopy = await saveAssessmentQuestion(ctx, fixture.assessmentId, {
            _tag: 'Revise',
            expectedParentRevision: copy.value.revision,
            placementId: copy.value.placementId,
            itemId: copy.value.itemId,
            draft: {
              ...parsePersistedDraft(copyRevision.body, 'single_select'),
              title: 'Edited copy',
            },
          });
          if (!(editedCopy.ok)) expect.unreachable('Expected editedCopy.ok');
          const revised = await saveAssessmentQuestion(ctx, fixture.assessmentId, fixture.command);
          if (revised.ok) expect.unreachable('Expected !revised.ok');
          expect(revised.status).toStrictEqual(409);
          expect(revised.error.error).toStrictEqual('copy_unavailable');
          await db.delete(assessmentPlacements).where(
            eq(assessmentPlacements.id, copy.value.placementId),
          );
          const removedState = await workspaceState(ctx, fixture.assessmentId);
          const removed = await saveAssessmentQuestion(ctx, fixture.assessmentId, fixture.command);
          if (removed.ok) expect.unreachable('Expected !removed.ok');
          expect(removed.status).toStrictEqual(409);
          expect(removed.error.error).toStrictEqual('copy_unavailable');
          expect(await workspaceState(ctx, fixture.assessmentId)).toStrictEqual(removedState);
        } finally {
          await deleteAssessment(ctx, fixture.assessmentId);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'copy request collisions across tenants abort the losing transaction without orphan items',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    try {
      await withEnrichmentWorkspace(async (firstCtx) => {
        await withEnrichmentWorkspace(async (secondCtx) => {
          const first = await createSource(firstCtx);
          const second = await createSource(secondCtx);
          try {
            const requestId = crypto.randomUUID();
            const requests = [
              { ctx: firstCtx, fixture: first },
              { ctx: secondCtx, fixture: second },
            ];
            const results = await Promise.allSettled(
              requests.map(({ ctx, fixture }) =>
                saveAssessmentQuestion(ctx, fixture.assessmentId, { ...fixture.command, requestId })
              ),
            );
            const outcomes = results.map((result) => {
              if (!(result.status === 'fulfilled')) {
                expect.unreachable("Expected result.status === 'fulfilled'");
              }
              return result.value;
            });
            expect(outcomes.filter((result) => result.ok).length).toStrictEqual(1);
            for (const [index, { ctx, fixture }] of requests.entries()) {
              const outcome = outcomes[index];
              const state = await workspaceState(ctx, fixture.assessmentId);
              expect(state.questionIds.length).toStrictEqual(outcome.ok ? 2 : 1);
              expect(state.assessment.targetCount).toStrictEqual(outcome.ok ? 2 : 1);
              expect(state.receipts.length).toStrictEqual(outcome.ok ? 1 : 0);
              if (!outcome.ok) {
                expect(outcome.status).toStrictEqual(409);
                expect(outcome.error.error).toStrictEqual('copy_request_conflict');
                const retry = await saveAssessmentQuestion(ctx, fixture.assessmentId, {
                  ...fixture.command,
                  requestId,
                });
                if (retry.ok) expect.unreachable('Expected !retry.ok');
                expect(retry.status).toStrictEqual(409);
                expect(await workspaceState(ctx, fixture.assessmentId)).toStrictEqual(state);
              }
            }
          } finally {
            await deleteAssessment(firstCtx, first.assessmentId);
            await deleteAssessment(secondCtx, second.assessmentId);
          }
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'failed copies reserve no receipt and committed receipts belong to one assessment and actor',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const first = await createSource(ctx);
        const other = await createSource(ctx);
        const otherUserId = crypto.randomUUID();
        try {
          const command = { ...first.command, sourceRevision: 2 };
          const before = await workspaceState(ctx, first.assessmentId);
          const failed = await saveAssessmentQuestion(ctx, first.assessmentId, command);
          if (failed.ok) expect.unreachable('Expected !failed.ok');
          expect(failed.status).toStrictEqual(404);
          expect(await workspaceState(ctx, first.assessmentId)).toStrictEqual(before);
          const original = await getQuestionRevision(ctx, first.source.itemId, 1);
          if (!original) expect.unreachable('Expected original');
          const revised = await saveAssessmentQuestion(ctx, first.assessmentId, {
            _tag: 'Revise',
            expectedParentRevision: first.source.revision,
            placementId: first.source.placementId,
            itemId: first.source.itemId,
            draft: {
              ...parsePersistedDraft(original.body, 'single_select'),
              title: 'Now revision two',
            },
          });
          if (!(revised.ok)) expect.unreachable('Expected revised.ok');
          const copied = await saveAssessmentQuestion(ctx, first.assessmentId, command);
          if (!(copied.ok)) expect.unreachable('Expected copied.ok');
          expect((await workspaceState(ctx, first.assessmentId)).receipts.length).toStrictEqual(1);
          const otherBefore = await workspaceState(ctx, other.assessmentId);
          const otherAssessment = await saveAssessmentQuestion(ctx, other.assessmentId, {
            ...other.command,
            requestId: command.requestId,
          });
          if (otherAssessment.ok) expect.unreachable('Expected !otherAssessment.ok');
          expect(otherAssessment.status).toStrictEqual(409);
          expect(await workspaceState(ctx, other.assessmentId)).toStrictEqual(otherBefore);
          await db.insert(users).values({
            id: otherUserId,
            email: `${otherUserId}@example.com`,
            emailNormalized: `${otherUserId}@example.com`,
          });
          await db.insert(organizationMemberships).values({
            id: crypto.randomUUID(),
            tenantId: ctx.tenantId,
            userId: otherUserId,
            role: 'owner',
          });
          const committed = await workspaceState(ctx, first.assessmentId);
          const otherActor = await saveAssessmentQuestion(
            { ...ctx, userId: otherUserId },
            first.assessmentId,
            command,
          );
          if (otherActor.ok) expect.unreachable('Expected !otherActor.ok');
          expect(otherActor.status).toStrictEqual(409);
          expect(await workspaceState(ctx, first.assessmentId)).toStrictEqual(committed);
        } finally {
          await deleteAssessment(ctx, first.assessmentId);
          await deleteAssessment(ctx, other.assessmentId);
          await db.delete(users).where(eq(users.id, otherUserId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
