import { expect, test as testCase } from 'vitest';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { db, shutdownDb } from '../lib/db.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { appendPlacement } from '../lib/services/assessment_structure.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import {
  buildQti3AssessmentPackageEntries,
  buildValidatedQti3Assessment,
} from '../lib/export/assessment.ts';
import { writeZip } from '../lib/zip.ts';
import { withImportedOrganizationQuestions } from './helpers/imported_organization_questions.ts';
import { withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

testCase(
  'approved weighted imports retain points after bank commit, real editing and assessment package re-import',
  async () => {
    try {
      for (const pair of [['single', 'multiple'], ['single', 'practice']] as const) {
        const encoder = new TextEncoder();
        const sourceXml = await Promise.all(
          pair.map((name) => readQtiFixture(`choice-points/${name}.xml`)),
        );
        const manifest =
          `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"><resources>${
            pair.map((name) =>
              `<resource identifier="${name}" type="imsqti_item_xmlv3p0" href="${name}.xml"><file href="${name}.xml"/></resource>`
            ).join('')
          }</resources></manifest>`;
        const bytes = await writeZip([
          { name: 'imsmanifest.xml', data: encoder.encode(manifest) },
          ...pair.map((name, index) => ({
            name: `${name}.xml`,
            data: encoder.encode(sourceXml[index]),
          })),
        ]);
        await withOrganizationWorkspace(async (fixture) => {
          await withImportedOrganizationQuestions(
            fixture.ctx,
            fixture.originId,
            async (initial) => {
              const run = await getMigrationRun(fixture.ctx, initial.id);
              if (!run) expect.unreachable('Expected run');
              const assessment = await createAssessmentDraft(fixture.ctx, {
                title: 'Weighted imports',
              });
              try {
                const expectedByTitle = new Map<string, number>();
                for (const imported of run.items) {
                  const questionId = imported.createdQuestionId;
                  if (!questionId) expect.unreachable('Expected questionId');
                  const name = imported.sourceHref.replace('.xml', '');
                  const maximum = name === 'multiple' ? 2.5 : name === 'practice' ? 0 : 3;
                  const original = await getQuestionRevision(fixture.ctx, questionId, 1);
                  if (!original) expect.unreachable('Expected original');
                  const draft = parsePersistedDraft(
                    original.body,
                    name === 'multiple' ? 'multi_select' : 'single_select',
                  );
                  expect(draft.maximumScore).toStrictEqual(maximum);
                  const placement = await appendPlacement(fixture.ctx, assessment.id, {
                    itemId: questionId,
                    pinnedRevision: 1,
                  });
                  const beforeRejectedEdit = await getAssessment(fixture.ctx, assessment.id);
                  const pointEdit = { ...draft, maximumScore: 9, preserveSourceXml: true };
                  const rejected = await saveAssessmentQuestion(fixture.ctx, assessment.id, {
                    _tag: 'Revise',
                    expectedParentRevision: 1,
                    itemId: questionId,
                    placementId: placement.id,
                    draft: pointEdit,
                  });
                  if (rejected.ok) expect.unreachable('Expected !rejected.ok');
                  expect(await getAssessment(fixture.ctx, assessment.id)).toStrictEqual(
                    beforeRejectedEdit,
                  );
                  expect(await getQuestionRevision(fixture.ctx, questionId, 1)).toStrictEqual(
                    original,
                  );
                  expect(await getQuestionRevision(fixture.ctx, questionId, 2)).toStrictEqual(null);
                  expect(pointEdit.maximumScore).toStrictEqual(9);
                  const editedTitle = `${draft.title} edited`;
                  const edited = await saveAssessmentQuestion(fixture.ctx, assessment.id, {
                    _tag: 'Revise',
                    expectedParentRevision: 1,
                    itemId: questionId,
                    placementId: placement.id,
                    draft: {
                      ...draft,
                      title: editedTitle,
                      bodyHtml: `${draft.bodyHtml}<p>Additional context.</p>`,
                    },
                  });
                  if (!(edited.ok)) expect.unreachable(JSON.stringify(edited));
                  expect(edited.value.revision).toStrictEqual(2);
                  expectedByTitle.set(editedTitle, maximum);
                  for (const revision of [1, 2]) {
                    const saved = await getQuestionRevision(fixture.ctx, questionId, revision);
                    if (!(saved && saved.qtiXml)) {
                      expect.unreachable('Expected saved && saved.qtiXml');
                    }
                    const reopened = parsePersistedDraft(saved.body, draft.type);
                    expect(reopened.maximumScore).toStrictEqual(maximum);
                    const preview = buildQtiPreviewXml(reopened);
                    if (!(preview.ok)) expect.unreachable('Expected preview.ok');
                    for (const xml of [saved.qtiXml, preview.xml]) {
                      const correct = scoreQtiItemServerSide({
                        itemXml: xml,
                        trustedResponses: { RESPONSE: name === 'multiple' ? ['A', 'B'] : 'A' },
                      });
                      if (!(correct.ok)) expect.unreachable('Expected correct.ok');
                      expect(correct.score).toStrictEqual(maximum);
                      if (name === 'multiple') {
                        const mixed = scoreQtiItemServerSide({
                          itemXml: xml,
                          trustedResponses: { RESPONSE: ['A', 'C'] },
                        });
                        if (!(mixed.ok)) expect.unreachable('Expected mixed.ok');
                        expect(mixed.score).toStrictEqual(1.25);
                      }
                    }
                  }
                  expect(await getQuestionRevision(fixture.ctx, questionId, 1)).toStrictEqual(
                    original,
                  );
                }
                const view = await getAssessment(fixture.ctx, assessment.id);
                if (!view) expect.unreachable('Expected view');
                const loaded = await loadAssessmentItemExports(db, fixture.ctx, {
                  assessment: view,
                  parts: view.parts,
                });
                const built = await buildValidatedQti3Assessment(loaded.document);
                if (!(built.validation.ok)) expect.unreachable('Expected built.validation.ok');
                const exported = await writeZip(
                  buildQti3AssessmentPackageEntries({
                    ...loaded,
                    assessmentXml: built.xml,
                    assets: [],
                  }),
                );
                const reimported = await parseQtiPackage(exported);
                expect(reimported.items.length).toStrictEqual(2);
                for (const item of reimported.items) {
                  const expected = expectedByTitle.get(item.title);
                  if (!(expected !== undefined)) {
                    expect.unreachable('Expected expected !== undefined');
                  }
                  expect(item.draft.maximumScore).toStrictEqual(expected);
                  const preview = buildQtiPreviewXml(item.draft);
                  if (!(preview.ok)) expect.unreachable('Expected preview.ok');
                  const scored = scoreQtiItemServerSide({
                    itemXml: preview.xml,
                    trustedResponses: {
                      RESPONSE: item.draft.type === 'multi_select' ? ['A', 'B'] : 'A',
                    },
                  });
                  if (!(scored.ok)) expect.unreachable('Expected scored.ok');
                  expect(scored.score).toStrictEqual(expected);
                }
              } finally {
                await deleteAssessment(fixture.ctx, assessment.id);
              }
            },
            { filename: 'weighted.zip', mime: 'application/zip', bytes, adapterId: 'qti3' },
          );
        }, { count: 1, activation: 'disabled', difficulty: 'none' });
      }
    } finally {
      await shutdownDb();
    }
  },
);
