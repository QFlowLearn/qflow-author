import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { shutdownDb } from '../lib/db.ts';
import { moveAssessmentCanvasPlacement } from '../lib/assessment_canvas_move.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  assessmentArrangementCommandFixture,
  saveAssessmentArrangementFixture,
} from './helpers/assessment_arrangement.ts';

testCase(
  'canonical canvas saves permit only the declared within-part order change and retain native settings',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Canvas authority' });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(initial);
          const partId = initial.parts[0].id;
          for (const title of ['First', 'Middle', 'Last']) {
            const result = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId,
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
          const loaded = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(loaded);
          const options = {
            navigationMode: 'nonlinear',
            submissionMode: 'simultaneous',
            timeLimits: { maxTime: 300 },
            instructionsHtml: '<p>Keep these instructions.</p>',
          };
          await saveAssessmentArrangementFixture(ctx, assessment.id, [
            { ...loaded.parts[0], options },
            {
              id: crypto.randomUUID(),
              title: 'Other part',
              placements: [],
              options: { navigationMode: 'linear' },
            },
          ]);
          const saved = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(saved);
          const canvasMove = { partId, placementId: saved.parts[0].placements[1].id, position: 0 };
          const ordered = moveAssessmentCanvasPlacement(saved.parts, canvasMove);
          if (!(ordered.ok)) expect.unreachable('Expected ordered.ok');
          const base = await assessmentArrangementCommandFixture(ctx, assessment.id, ordered.parts);
          for (
            const parts of [
              base.parts.map((part, index) =>
                index === 0 ? { ...part, title: 'Discard title' } : part
              ),
              base.parts.map((part, index) => index === 0 ? { ...part, options: {} } : part),
              base.parts.map((part, index) =>
                index === 0 ? { ...part, placements: part.placements.slice(0, 2) } : part
              ),
              base.parts.map((part, index) =>
                index === 0 ? { ...part, placements: [...part.placements].reverse() } : part
              ),
              base.parts.map((part, index) =>
                index === 0
                  ? {
                    ...part,
                    placements: part.placements.map((placement) =>
                      'content' in placement ? placement : ({ ...placement, fixed: true })
                    ),
                  }
                  : part
              ),
            ]
          ) {
            const rejected = await saveAssessmentParts(ctx, assessment.id, {
              ...base,
              canvasMove,
              parts,
            });
            if (rejected.ok) expect.unreachable('Expected !rejected.ok');
            expect(rejected.error.code).toStrictEqual('invalid_canvas_move');
            expect(await getAssessment(ctx, assessment.id)).toStrictEqual(saved);
          }
          const command = { ...base, canvasMove };
          if (!((await saveAssessmentParts(ctx, assessment.id, command)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, command)).ok',
            );
          }
          if (!((await saveAssessmentParts(ctx, assessment.id, command)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, command)).ok',
            );
          }
          const after = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(after);
          expect(after.parts).toStrictEqual(ordered.parts);
          expect(after.parts[0].options).toStrictEqual(options);
          expect(after.targetCount).toStrictEqual(3);
          await saveAssessmentArrangementFixture(
            ctx,
            assessment.id,
            after.parts.map((part) => ({
              ...part,
              placements: part.placements.map((placement, index) => ({
                ...placement,
                fixed: index === 1,
              })),
            })),
          );
          const protectedOrder = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(protectedOrder);
          const protectedMove = {
            partId,
            placementId: protectedOrder.parts[0].placements[0].id,
            position: 2,
          };
          const protectedCommand = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            protectedOrder.parts.map((part, index) =>
              index === 0 ? { ...part, placements: [...part.placements].reverse() } : part
            ),
          );
          const rejectedProtected = await saveAssessmentParts(ctx, assessment.id, {
            ...protectedCommand,
            canvasMove: protectedMove,
          });
          if (rejectedProtected.ok) expect.unreachable('Expected !rejectedProtected.ok');
          expect(rejectedProtected.error.code).toStrictEqual('invalid_canvas_move');
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(protectedOrder);
          await saveAssessmentArrangementFixture(
            ctx,
            assessment.id,
            after.parts.map((part) => ({
              ...part,
              options: { ...part.options, navigationMode: 'linear' },
            })),
          );
          const linear = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(linear);
          const blocked = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            linear.parts.map((part, index) =>
              index === 0 ? { ...part, placements: [...part.placements].reverse() } : part
            ),
          );
          const denied = await saveAssessmentParts(ctx, assessment.id, { ...blocked, canvasMove });
          if (denied.ok) expect.unreachable('Expected !denied.ok');
          expect(denied.error.code).toStrictEqual('invalid_canvas_move');
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(linear);
          const stale = await saveAssessmentParts(ctx, assessment.id, command);
          if (stale.ok) expect.unreachable('Expected !stale.ok');
          expect(stale.error.code).toStrictEqual('stale_structure');
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
