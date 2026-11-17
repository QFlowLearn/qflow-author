import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { shutdownDb } from '../lib/db.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { changeQuestionPresentation } from '../lib/question_presentation.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { Draft } from '../lib/types/draft.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';

testCase(
  'actual authoring revisions retain point grades and immutable prior scoring after reopen and switching',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Saved point maximum' });
        try {
          const view = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(view);
          const partId = view.parts[0].id;
          const initial: Draft = {
            type: 'single_select',
            itemLanguage: newAuthoringItemLanguage(),
            title: 'Points',
            bodyHtml: '<p>Choose Alpha.</p>',
            choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
            correctId: 'A',
            responseMode: 'all_or_nothing',
            maximumScore: 0,
          };
          const created = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId,
            draft: initial,
          });
          if (!(created.ok)) expect.unreachable(JSON.stringify(created));
          const converted = changeQuestionPresentation({ ...initial, maximumScore: 3.125 });
          if (!(converted.ok)) expect.unreachable('Expected converted.ok');
          const revised = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Revise',
            expectedParentRevision: created.value.revision,
            itemId: created.value.itemId,
            placementId: created.value.placementId,
            draft: converted.draft,
          });
          if (!(revised.ok)) expect.unreachable(JSON.stringify(revised));
          expect(revised.value.revision).toStrictEqual(2);
          for (
            const [revision, type, expected] of [[1, 'single_select', 0], [
              2,
              'inline_choice',
              3.125,
            ]] as const
          ) {
            const saved = await getQuestionRevision(ctx, created.value.itemId, revision);
            if (!saved) expect.unreachable('Expected saved');
            const draft = parsePersistedDraft(saved.body, type);
            expect(draft.maximumScore).toStrictEqual(expected);
            const preview = buildQtiPreviewXml(draft);
            if (!(preview.ok)) expect.unreachable('Expected preview.ok');
            for (const xml of [saved.qtiXml, preview.xml]) {
              if (!xml) expect.unreachable('Expected xml');
              const graded = scoreQtiItemServerSide({
                itemXml: xml,
                trustedResponses: { RESPONSE: 'A' },
              });
              if (!(graded.ok)) expect.unreachable(JSON.stringify(graded.diagnostics));
              expect(graded.score).toStrictEqual(expected);
            }
          }
          const beforeInvalid = await getAssessment(ctx, assessment.id);
          const rejected = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId,
            draft: { ...initial, maximumScore: -1 },
          });
          expect(rejected.ok).toStrictEqual(false);
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(beforeInvalid);
          const reopened = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(reopened);
          expect(reopened.parts[0].placements.length).toStrictEqual(1);
          expect(reopened.parts[0].placements[0].itemId).toStrictEqual(created.value.itemId);
          expect(reopened.parts[0].placements[0].snapshotRev).toStrictEqual(2);
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
