import { expect, test as testCase } from 'vitest';

import { assessments } from '../lib/db/assessment_schema.ts';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentPlacements, organizationMemberships } from '../lib/db/schema.ts';
import { assessmentArrangementVersion } from '../lib/assessment_arrangement_version.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { assessmentPlacementRemovalService } from '../lib/services/assessment_placement_removal.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assessmentArrangementCommandFixture } from './helpers/assessment_arrangement.ts';
import { arrangeApiRoute as arrangeRouteEndpoint } from '../lib/http/routes/assessment_api/arrange.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const arrangeRoute = arrangeRouteEndpoint.handle;

testCase(
  'arrangement compare-and-save serializes concurrent writers, retries without rewriting and rejects revocation',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Concurrent arrangement' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          for (const title of ['First', 'Middle', 'Last']) {
            const result = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type: 'single_select',
                title,
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Pick a city.</p>',
                choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                correctId: 'A',
              },
            });
            if (!(result.ok)) expect.unreachable('Expected result.ok');
          }
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const first = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            saved.parts.map((part) => ({ ...part, placements: [...part.placements].reverse() })),
          );
          const second = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            saved.parts.map((part) => ({ ...part, title: 'Other editor title' })),
          );
          expect(first.expectedVersion).toStrictEqual(second.expectedVersion);
          const outcomes = await Promise.all([
            saveAssessmentParts(ctx, assessment.id, first),
            saveAssessmentParts(ctx, assessment.id, second),
          ]);
          expect(outcomes.filter((result) => result.ok).length).toStrictEqual(1);
          const loser = outcomes.find((result) => !result.ok);
          if (!(loser && !loser.ok)) expect.unreachable('Expected loser && !loser.ok');
          expect(loser.error.code).toStrictEqual('stale_structure');
          const winner = outcomes[0].ok ? first : second;
          const current = await getAssessment(ctx, assessment.id);
          if (!current) expect.unreachable('Expected current');
          expect(current.parts.map((part) => part.placements)).toStrictEqual(
            winner.parts.map((part) => part.placements.map((placement) => ({ ...placement }))),
          );
          expect(current.targetCount).toStrictEqual(3);
          const rowsBefore = await db.select().from(assessmentPlacements).where(
            eq(assessmentPlacements.assessmentPartId, saved.parts[0].id),
          );
          const retry = await saveAssessmentParts(ctx, assessment.id, winner);
          if (!(retry.ok)) expect.unreachable('Expected retry.ok');
          expect(retry.version).toStrictEqual(
            await assessmentArrangementVersion(assessment.id, current.parts),
          );
          expect(
            await db.select().from(assessmentPlacements).where(
              eq(assessmentPlacements.assessmentPartId, saved.parts[0].id),
            ),
          ).toStrictEqual(rowsBefore);

          await db.delete(organizationMemberships).where(
            and(
              eq(organizationMemberships.tenantId, ctx.tenantId),
              eq(organizationMemberships.userId, ctx.userId),
            ),
          );
          const revoked = await saveAssessmentParts(ctx, assessment.id, winner);
          if (revoked.ok) expect.unreachable('Expected !revoked.ok');
          expect(revoked.error.code).toStrictEqual('forbidden');
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(current);
        } finally {
          // Fixture cleanup owns this assessment even after its actor's membership is revoked.
          await db.delete(assessments).where(eq(assessments.id, assessment.id));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'stale arrangement API cannot resurrect a removed question or discard updated settings',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Removal conflict' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          const created = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'single_select',
              title: 'Keep identity',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: '<p>Pick.</p>',
              choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
              correctId: 'A',
            },
          });
          if (!(created.ok)) expect.unreachable('Expected created.ok');
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const command = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            saved.parts.map((part) => ({ ...part, title: 'Local title' })),
          );
          const removal = await assessmentPlacementRemovalService.remove(
            ctx,
            assessment.id,
            created.value.placementId,
            { removalId: crypto.randomUUID(), expectedRevision: 1 },
          );
          if (!(removal.ok)) expect.unreachable('Expected removal.ok');
          const current = await getAssessment(ctx, assessment.id);
          if (!current) expect.unreachable('Expected current');
          expect(await assessmentArrangementVersion(assessment.id, current.parts)).not
            .toStrictEqual(command.expectedVersion);
          const wire = {
            ...command,
            parts: command.parts.map((part) => ({
              ...part,
              placements: part.placements.map((placement) =>
                'content' in placement ? placement : ({
                  ...placement,
                  snapshotRev: placement.snapshotRev ?? undefined,
                  blueprintTargetId: placement.blueprintTargetId ?? undefined,
                })
              ),
            })),
          };
          const response = await invokeHttpRoute(
            arrangeRoute,
            makeHttpRequest(
              new Request('http://local/api/assessments/' + assessment.id + '/arrange', {
                ...{ duplex: 'half' },
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(wire),
              }),
              { params: { id: assessment.id }, auth: ctx },
            ),
          );
          expect(response.status).toStrictEqual(409);
          expect(response.headers.get('cache-control')).toStrictEqual('private, no-store');
          const body: unknown = await response.json();
          expect(body).toStrictEqual({
            ok: false,
            error: {
              code: 'stale_structure',
              status: 409,
              message: 'The saved assessment arrangement has changed.',
            },
          });
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(current);
          const settings = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            current.parts.map((part) => ({
              ...part,
              options: {
                navigationMode: 'linear',
                instructionsHtml: '<p>New saved instructions.</p>',
              },
            })),
          );
          if (!((await saveAssessmentParts(ctx, assessment.id, settings)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, settings)).ok',
            );
          }
          const staleSettings = await saveAssessmentParts(ctx, assessment.id, command);
          if (staleSettings.ok) expect.unreachable('Expected !staleSettings.ok');
          expect(staleSettings.error.code).toStrictEqual('stale_structure');
          const final = await getAssessment(ctx, assessment.id);
          if (!final) expect.unreachable('Expected final');
          expect(final.parts[0].options).toStrictEqual(settings.parts[0].options);
          expect(final.parts[0].placements).toStrictEqual([]);
          expect(final.targetCount).toStrictEqual(0);
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
