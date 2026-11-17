import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { shutdownDb } from '../lib/db.ts';
import { applyAuthoringPreferences } from '../lib/authoring_preferences.ts';
import { resolveAuthoringPreferences } from '../lib/instructor_defaults.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { createRailDraft } from '../islands/drivers/right_rail/rail_draft.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  readInstructorDefaults,
  saveEditorPreferences,
} from '../lib/services/instructor_defaults.ts';
import { getUserSettings, saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { authoringPreferencesService } from '../lib/services/authoring_preferences.ts';
import { duplicateAssessment, getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';

testCase(
  'workspace point policies persist independently, reject invalid SQL values atomically and preserve published revisions and duplicates',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
        await withEnrichmentWorkspace(async (other) => {
          const assessmentIds: string[] = [];
          try {
            for (const maximumScore of [0, 3.125]) {
              await saveEditorPreferences(ctx, {
                choiceRichText: true,
                instructorDefaults: { answerChoiceOrder: null, maximumScore },
              });
              expect(await readInstructorDefaults(ctx)).toStrictEqual({
                answerChoiceOrder: null,
                maximumScore,
              });
              expect(await readInstructorDefaults(other)).toStrictEqual(null);
              expect(await readInstructorDefaults({ ...ctx, userId: other.userId })).toStrictEqual(
                null,
              );
              expect(await readInstructorDefaults({ ...ctx, tenantId: other.tenantId }))
                .toStrictEqual(null);
            }
            for (const maximumScore of [-1, Infinity, NaN]) {
              await expect(
                Promise.resolve().then(() =>
                  saveEditorPreferences(ctx, {
                    choiceRichText: false,
                    instructorDefaults: { answerChoiceOrder: 'shuffled', maximumScore },
                  })
                ),
              ).rejects.toBeInstanceOf(Error);
              expect(await readInstructorDefaults(ctx)).toStrictEqual({
                answerChoiceOrder: null,
                maximumScore: 3.125,
              });
              expect((await getUserSettings(ctx.userId)).choiceRichText).toStrictEqual(true);
            }
            const assessment = await createAssessmentDraft(ctx);
            assessmentIds.push(assessment.id);
            const view = await getAssessment(ctx, assessment.id);
            assertQuestionOnlyAssessmentFixture(view);
            const preferences = resolveAuthoringPreferences(
              await readInstructorDefaults(ctx),
              [],
              null,
            );
            const blank = applyAuthoringPreferences(
              createRailDraft('single_select'),
              'single_select',
              preferences,
            );
            expect(blank.maximumScore).toStrictEqual(3.125);
            expect(blank.shuffle).toStrictEqual(false);
            const created = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: view.parts[0].id,
              draft: {
                ...blank,
                type: 'single_select',
                itemLanguage: newAuthoringItemLanguage(),
                title: 'Default point publication',
                bodyHtml: '<p>Choose Alpha.</p>',
                choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
                correctId: 'A',
              },
            });
            if (!(created.ok)) expect.unreachable('Expected created.ok');
            expect(await authoringPreferencesService.read(ctx, assessment.id)).toStrictEqual([]);
            await saveEditorPreferences(ctx, {
              choiceRichText: true,
              instructorDefaults: { answerChoiceOrder: null, maximumScore: 0 },
            });
            const duplicated = await duplicateAssessment(ctx, assessment.id);
            if (!(duplicated._tag === 'Duplicated')) {
              expect.unreachable("Expected duplicated._tag === 'Duplicated'");
            }
            const duplicateId = duplicated.id;
            assessmentIds.push(duplicateId);
            for (const assessmentId of [assessment.id, duplicateId]) {
              const reopened = await getAssessment(ctx, assessmentId);
              assertQuestionOnlyAssessmentFixture(reopened);
              const placement = reopened.parts[0].placements[0];
              if (!(placement.snapshotRev !== null)) {
                expect.unreachable('Expected placement.snapshotRev !== null');
              }
              const revision = await getQuestionRevision(
                ctx,
                placement.itemId,
                placement.snapshotRev,
              );
              if (!(revision?.qtiXml)) expect.unreachable('Expected revision?.qtiXml');
              expect(parsePersistedDraft(revision.body, 'single_select').maximumScore)
                .toStrictEqual(3.125);
              for (const [response, expected] of [['A', 3.125], ['B', 0]] as const) {
                const result = scoreQtiItemServerSide({
                  itemXml: revision.qtiXml,
                  trustedResponses: { RESPONSE: response },
                });
                if (!(result.ok)) expect.unreachable('Expected result.ok');
                expect(result.score).toStrictEqual(expected);
                expect(result.outcomes.MAXSCORE).toStrictEqual(3.125);
              }
            }
            expect(
              applyAuthoringPreferences(
                createRailDraft('single_select'),
                'single_select',
                resolveAuthoringPreferences(await readInstructorDefaults(ctx), [], null),
              ).maximumScore,
            ).toStrictEqual(0);
            await saveEditorPreferences(ctx, {
              choiceRichText: false,
              instructorDefaults: { answerChoiceOrder: 'shuffled', maximumScore: null },
            });
            expect(await readInstructorDefaults(ctx)).toStrictEqual({
              answerChoiceOrder: 'shuffled',
              maximumScore: null,
            });
            const reset = applyAuthoringPreferences(
              createRailDraft('single_select'),
              'single_select',
              resolveAuthoringPreferences(await readInstructorDefaults(ctx), [], null),
            );
            expect(reset.maximumScore).toStrictEqual(undefined);
            expect(reset.shuffle).toStrictEqual(true);
            await saveEditorPreferences(ctx, { choiceRichText: false, instructorDefaults: null });
            expect(await readInstructorDefaults(ctx)).toStrictEqual(null);
          } finally {
            for (const id of assessmentIds) await deleteAssessment(ctx, id);
          }
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);
