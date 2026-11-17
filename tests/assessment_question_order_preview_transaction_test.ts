import { expect, test as testCase } from 'vitest';

import { assessments } from '../lib/db/assessment_schema.ts';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { organizationMemberships, questionRevisions } from '../lib/db/schema.ts';
import { assessmentAdaptivePlans } from '../lib/db/assessment_schema.ts';
import { assessmentArrangementVersion } from '../lib/assessment_arrangement_version.ts';
import { adaptivePlanDocument } from '../lib/assessment_adaptive_plan.ts';
import { AssessmentQuestionOrderPreviews } from '../lib/services/assessment_question_order_preview.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';
import { questionOrderPreviewApiRoute as handlerEndpoint } from '../lib/http/routes/assessment_api/question_order_preview.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { parseQuestionOrderPreview } from '../lib/assessment_question_order_preview_response.ts';

const handler = handlerEndpoint.handle;

function request(auth: RequestContext, id: string, query: string, signal?: AbortSignal) {
  return invokeHttpMethod(
    handler,
    'GET',
    makeHttpRequest(
      new Request(`http://local/api/assessments/${id}/question-order-preview?${query}`, { signal }),
      { auth, params: { id } },
    ),
  );
}

async function expectFailure(
  auth: RequestContext,
  id: string,
  version: string,
  status: number,
  code: string,
  signal?: AbortSignal,
) {
  const response = await request(auth, id, `version=${version}`, signal);
  expect(response.status).toStrictEqual(status);
  expect(response.headers.get('cache-control')).toStrictEqual('private, no-store');
  expect(await response.json()).toStrictEqual({ error: code });
}

testCase(
  'question order preview rejects ambiguous queries before resolving authentication or database',
  async () => {
    const id = crypto.randomUUID();
    const version = 'a'.repeat(64);
    for (
      const query of [
        '',
        'version=',
        'version=bad',
        `version=${version.toUpperCase()}`,
        `version=${version}&version=${version}`,
        `version=${version}&seed=1`,
        `version=${version}&extra=1`,
      ]
    ) {
      const response = await invokeHttpMethod(
        handler,
        'GET',
        makeHttpRequest(
          new Request(`http://local/api/assessments/${id}/question-order-preview?${query}`),
          { omitAuth: true, params: { id } },
        ),
      );
      expect(response.status).toStrictEqual(400);
      expect(response.headers.get('cache-control')).toStrictEqual('private, no-store');
      expect(await response.json()).toStrictEqual({ error: 'invalid_input' });
    }
    const response = await invokeHttpMethod(
      handler,
      'GET',
      makeHttpRequest(
        new Request(
          `http://local/api/assessments/invalid/question-order-preview?version=${version}`,
        ),
        { omitAuth: true, params: { id: 'invalid' } },
      ),
    );
    expect(response.status).toStrictEqual(400);
    expect(await response.json()).toStrictEqual({ error: 'invalid_input' });
  },
);

testCase(
  'saved-policy previews use shared ordering, preserve pinned identities and never write an attempt or arrangement',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await withEnrichmentWorkspace(async (other) => {
          const assessment = await createAssessmentDraft(ctx, {
            title: 'Saved question order preview',
          });
          try {
            const initial = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(initial);
            const previews = new AssessmentQuestionOrderPreviews(db);
            const initialVersion = await assessmentArrangementVersion(assessment.id, initial.parts);
            await expectFailure(ctx, assessment.id, initialVersion, 422, 'empty_assessment');
            expect(
              await previews.preview(
                ctx,
                assessment.id,
                await assessmentArrangementVersion(assessment.id, initial.parts),
                { seed: 1 },
              ),
            ).toStrictEqual({ ok: false, code: 'empty_assessment' });
            const created = [];
            for (const title of ['Pinned original', 'Free two', 'Free three', 'Second part']) {
              const result = await saveAssessmentQuestion(ctx, assessment.id, {
                _tag: 'Create',
                partId: initial.parts[0].id,
                draft: {
                  type: 'single_select',
                  title,
                  itemLanguage: newAuthoringItemLanguage(),
                  bodyHtml: '<p>Choose Paris.</p>',
                  maximumScore: 3.125,
                  choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                  correctId: 'A',
                },
              });
              if (!(result.ok)) expect.unreachable('Expected result.ok');
              created.push(result.value);
            }
            const revised = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Revise',
              expectedParentRevision: created[0].revision,
              placementId: created[0].placementId,
              itemId: created[0].itemId,
              draft: {
                type: 'single_select',
                title: 'Changed latest',
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Choose Paris.</p>',
                maximumScore: 2.5,
                choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                correctId: 'A',
              },
            });
            if (!(revised.ok)) expect.unreachable('Expected revised.ok');
            expect(revised.value.revision).toStrictEqual(2);
            const latest = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(latest);
            const first = latest.parts[0];
            await saveAssessmentArrangementFixture(ctx, assessment.id, [{
              ...first,
              options: { shuffleQuestions: true, instructionsHtml: '<p>Read carefully.</p>' },
              placements: first.placements.slice(0, 3).map((placement, index) => ({
                ...placement,
                snapshotRev: index === 0 ? 1 : placement.snapshotRev,
                fixed: index === 0,
              })),
            }, {
              id: crypto.randomUUID(),
              title: 'Authored second part',
              options: { shuffleQuestions: false, timeLimits: { maxTime: 300 } },
              placements: first.placements.slice(3),
            }]);
            const before = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(before);
            const revisions = await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, ctx.tenantId),
            ).orderBy(questionRevisions.id);
            const version = await assessmentArrangementVersion(assessment.id, before.parts);
            const variants = new Set<string>();
            const examples = new Set<string>();
            for (let seed = 0; seed < 16; seed++) {
              const result = await previews.preview(ctx, assessment.id, version, { seed });
              if (!(result.ok)) expect.unreachable('Expected result.ok');
              expect(parseQuestionOrderPreview(result.value, version, before.parts)).toStrictEqual(
                result.value,
              );
              expect(result).toStrictEqual(
                await previews.preview(ctx, assessment.id, version, { seed }),
              );
              expect(result.value.version).toStrictEqual(version);
              expect(result.value.parts.map((part) => part.id)).toStrictEqual(
                before.parts.map((part) => part.id),
              );
              const part = result.value.parts[0];
              expect(part.shuffleQuestions).toStrictEqual(true);
              expect(part.questions[0]).toStrictEqual({
                placementId: created[0].placementId,
                itemId: created[0].itemId,
                revision: 1,
                title: 'Pinned original',
                authoredPosition: 1,
                fixed: true,
              });
              expect(part.questions.map((q) => q.placementId).sort()).toStrictEqual(
                before.parts[0].placements.map((p) => p.id).sort(),
              );
              expect(result.value.parts[1].shuffleQuestions).toStrictEqual(false);
              expect(result.value.parts[1].questions.map((q) => q.placementId)).toStrictEqual(
                before.parts[1].placements.map((p) => p.id),
              );
              variants.add(part.questions.map((question) => question.placementId).join(','));
              examples.add(JSON.stringify(result.value));
            }
            if (!(variants.size > 1)) expect.unreachable('Expected variants.size > 1');
            // Host-seeded HTTP examples must be one of the two valid shared-core permutations.
            expect(examples.size).toStrictEqual(2);
            const example = await previews.preview(ctx, assessment.id, version, { seed: 1 });
            if (!(example.ok)) expect.unreachable('Expected example.ok');
            const value = example.value;
            const firstQuestions = value.parts[0].questions;
            const changedQuestion = (changes: Record<string, unknown>) => ({
              ...value,
              parts: [{
                ...value.parts[0],
                questions: [{ ...firstQuestions[0], ...changes }, ...firstQuestions.slice(1)],
              }, value.parts[1]],
            });
            for (
              const malformed of [
                null,
                { ...value, version: '0'.repeat(64) },
                { ...value, extra: true },
                { ...value, parts: value.parts.slice(1) },
                {
                  ...value,
                  parts: [{ ...value.parts[0], shuffleQuestions: false }, value.parts[1]],
                },
                changedQuestion({ revision: 2 }),
                changedQuestion({ itemId: crypto.randomUUID() }),
                changedQuestion({ authoredPosition: 2 }),
                changedQuestion({ fixed: false }),
                changedQuestion({ title: 42 }),
                changedQuestion({ correctAnswer: 'private' }),
                {
                  ...value,
                  parts: [{
                    ...value.parts[0],
                    questions: [firstQuestions[1], firstQuestions[0], firstQuestions[2]],
                  }, value.parts[1]],
                },
                {
                  ...value,
                  parts: [{
                    ...value.parts[0],
                    questions: [firstQuestions[0], firstQuestions[1], firstQuestions[1]],
                  }, value.parts[1]],
                },
              ]
            ) {
              expect(parseQuestionOrderPreview(malformed, version, before.parts)).toStrictEqual(
                null,
              );
            }
            for (let index = 0; index < 8; index++) {
              const response = await request(ctx, assessment.id, `version=${version}`);
              expect(response.status).toStrictEqual(200);
              expect(response.headers.get('cache-control')).toStrictEqual('private, no-store');
              const body: unknown = await response.json();
              if (!(examples.has(JSON.stringify(body)))) {
                expect.unreachable('Expected examples.has(JSON.stringify(body))');
              }
            }
            expect(await getAssessment(ctx, assessment.id)).toStrictEqual(before);
            expect(
              await db.select().from(questionRevisions).where(
                eq(questionRevisions.tenantId, ctx.tenantId),
              ).orderBy(questionRevisions.id),
            ).toStrictEqual(revisions);
            expect(await previews.preview(other, assessment.id, version, { seed: 1 }))
              .toStrictEqual({
                ok: false,
                code: 'assessment_not_found',
              });
            await expectFailure(other, assessment.id, version, 404, 'assessment_not_found');
            await expectFailure(ctx, crypto.randomUUID(), version, 404, 'assessment_not_found');
            await expectFailure(ctx, assessment.id, '0'.repeat(64), 409, 'stale_arrangement');
            expect(await previews.preview(ctx, assessment.id, '0'.repeat(64), { seed: 1 }))
              .toStrictEqual({
                ok: false,
                code: 'stale_arrangement',
              });
            const controller = new AbortController();
            controller.abort();
            expect(
              await previews.preview(ctx, assessment.id, version, {
                seed: 1,
                signal: controller.signal,
              }),
            ).toStrictEqual({ ok: false, code: 'cancelled' });
            await expectFailure(ctx, assessment.id, version, 408, 'cancelled', controller.signal);
            const adaptive = adaptiveExportFixture();
            await db.insert(assessmentAdaptivePlans).values({
              assessmentId: assessment.id,
              document: adaptivePlanDocument(adaptive.plan),
            });
            expect(await previews.preview(ctx, assessment.id, version, { seed: 1 })).toStrictEqual({
              ok: false,
              code: 'adaptive_managed',
            });
            await expectFailure(ctx, assessment.id, version, 422, 'adaptive_managed');
            await db.delete(assessmentAdaptivePlans).where(
              eq(assessmentAdaptivePlans.assessmentId, assessment.id),
            );
            await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
              eq(organizationMemberships.userId, ctx.userId),
            );
            expect(await previews.preview(ctx, assessment.id, version, { seed: 1 })).toStrictEqual({
              ok: false,
              code: 'forbidden',
            });
            await expectFailure(ctx, assessment.id, version, 403, 'forbidden');
          } finally {
            // Fixture cleanup owns this record after membership revocation.
            await db.delete(assessments).where(eq(assessments.id, assessment.id));
          }
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);
