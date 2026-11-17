import { expect, test as testCase } from 'vitest';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { db, shutdownDb } from '../lib/db.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { appendPlacement } from '../lib/services/assessment_structure.ts';
import {
  getQuestionRevision,
  saveVariantQuestionRevisionInTransaction,
  VariantQuestionContentMismatchError,
} from '../lib/services/questions.ts';
import { prepareQuestionPublicationFromSource } from '../lib/services/publish.ts';
import { createQuestionVariantDraft } from '../lib/question_variants.ts';
import {
  openPreparedQuestionRevision,
  prepareQuestionRevision,
} from '../lib/question_revision_preparation.ts';
import { projectCanonicalQtiSemantics } from '../lib/question_qti_semantics.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { writeZip } from '../lib/zip.ts';
import { withImportedOrganizationQuestions } from './helpers/imported_organization_questions.ts';
import { withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';
import { verifyNativeCopyInBrowser } from './helpers/native_copy_browser.ts';

testCase('same-type copies retain imported XML and executable text-entry scoring', async () => {
  requireQaDatabaseUrl(process.env['DATABASE_URL']);
  const weighted = await readQtiFixture('choice-points/single.xml');
  const native = weighted.replace('base-type="identifier"', 'base-type="string"').replace(
    /<qti-choice-interaction[\s\S]*?<\/qti-choice-interaction>/,
    '<qti-text-entry-interaction response-identifier="RESPONSE" expected-length="10"/>',
  );
  const encoder = new TextEncoder();
  const bytes = await writeZip([
    {
      name: 'imsmanifest.xml',
      data: encoder.encode(
        '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"><resources>' +
          '<resource identifier="native" type="imsqti_item_xmlv3p0" href="native.xml"><file href="native.xml"/></resource>' +
          '<resource identifier="weighted" type="imsqti_item_xmlv3p0" href="weighted.xml"><file href="weighted.xml"/></resource>' +
          '</resources></manifest>',
      ),
    },
    { name: 'native.xml', data: encoder.encode(native) },
    { name: 'weighted.xml', data: encoder.encode(weighted) },
  ]);
  try {
    await withOrganizationWorkspace(async (fixture) => {
      await withImportedOrganizationQuestions(fixture.ctx, fixture.originId, async (initial) => {
        const run = await getMigrationRun(fixture.ctx, initial.id);
        if (!run) expect.unreachable('Expected run');
        const assessment = await createAssessmentDraft(fixture.ctx, {
          title: 'Native copy scoring',
        });
        try {
          const imported = run.items.find((item) => item.sourceHref === 'native.xml');
          if (!(imported?.createdQuestionId)) {
            expect.unreachable('Expected imported?.createdQuestionId');
          }
          const sourceId = imported.createdQuestionId;
          const source = await getQuestionRevision(fixture.ctx, sourceId, 1);
          if (!source) expect.unreachable('Expected source');
          const sourceDraft = parsePersistedDraft(source.body, 'text_entry');
          expect(sourceDraft.maximumScore).toStrictEqual(undefined);
          expect(sourceDraft.textEntries?.[0].answers[0].score).toStrictEqual(3);
          const placement = await appendPlacement(fixture.ctx, assessment.id, {
            itemId: sourceId,
            pinnedRevision: 1,
          });
          const view = await getAssessment(fixture.ctx, assessment.id);
          if (!view) expect.unreachable('Expected view');
          const command = {
            _tag: 'Variant',
            requestId: crypto.randomUUID(),
            partId: view.parts[0].id,
            sourcePlacementId: placement.id,
            sourceItemId: sourceId,
            sourceRevision: 1,
            targetType: 'text_entry',
          } as const;
          const copied = await saveAssessmentQuestion(fixture.ctx, assessment.id, command);
          if (!(copied.ok)) expect.unreachable(copied.ok ? '' : copied.error.message);
          if (!(copied.value.itemId !== sourceId)) {
            expect.unreachable('Expected copied.value.itemId !== sourceId');
          }
          const copy = await getQuestionRevision(fixture.ctx, copied.value.itemId, 1);
          if (!copy) expect.unreachable('Expected copy');
          expect(copy.provenance.event.contentBasis).toStrictEqual('source');
          expect(copy.provenance.origin).toStrictEqual({
            _tag: 'Variant',
            source: { questionId: sourceId, revision: 1 },
            transformation: {
              kind: 'construct_preserving_variant',
              fromType: 'text_entry',
              toType: 'text_entry',
            },
          });
          expect(projectCanonicalQtiSemantics(copy.qtiXml)).toStrictEqual(
            projectCanonicalQtiSemantics(source.qtiXml),
          );
          const afterCopy = await getAssessment(fixture.ctx, assessment.id);
          if (!afterCopy) expect.unreachable('Expected afterCopy');
          expect(assessmentQuestionPlacements(afterCopy.parts[0].placements).map((p) => p.id))
            .toStrictEqual([placement.id, copied.value.placementId]);
          expect(await saveAssessmentQuestion(fixture.ctx, assessment.id, command)).toStrictEqual(
            copied,
          );
          expect(await getAssessment(fixture.ctx, assessment.id)).toStrictEqual(afterCopy);
          const prepared = await prepareQuestionPublicationFromSource(
            createQuestionVariantDraft(sourceDraft, 'text_entry'),
            { _tag: 'Copy', itemId: crypto.randomUUID(), qtiXml: source.qtiXml },
          );
          if (!(prepared.ok)) expect.unreachable('Expected prepared.ok');
          const { bankProjection: _projection, ...input } = openPreparedQuestionRevision(
            prepared.prepared.saveInput,
          );
          const altered = await prepareQuestionRevision({
            ...input,
            qtiXml: input.qtiXml.replace('>3<', '>99<'),
          });
          await expect(
            Promise.resolve().then(() =>
              db.transaction((tx) =>
                saveVariantQuestionRevisionInTransaction(
                  tx,
                  fixture.ctx,
                  altered,
                  { questionId: sourceId, revision: 1 },
                  'text_entry',
                )
              )
            ),
          ).rejects.toBeInstanceOf(VariantQuestionContentMismatchError);
          expect(await getQuestionRevision(fixture.ctx, prepared.prepared.itemId, 1)).toStrictEqual(
            null,
          );
          expect(await getAssessment(fixture.ctx, assessment.id)).toStrictEqual(afterCopy);
          const exported = await buildAssessmentPackage({
            assessment: afterCopy,
            auth: fixture.ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: () =>
              Promise.reject(new Error('This fixture has no uploaded assets.')),
          });
          if (!(exported.ok)) expect.unreachable(exported.ok ? '' : exported.body.error);
          const reimported = await parseQtiPackage(exported.artifact.bytes);
          expect(reimported.items.length).toStrictEqual(2);
          for (const response of ['A', 'B', null]) {
            const originalScore = scoreQtiItemServerSide({
              itemXml: source.qtiXml,
              trustedResponses: { RESPONSE: response },
            });
            if (!(originalScore.ok)) expect.unreachable('Expected originalScore.ok');
            if (response === 'A') expect(originalScore.score).toStrictEqual(3);
            for (const xml of [copy.qtiXml, ...reimported.items.map((item) => item.xml)]) {
              const copiedScore = scoreQtiItemServerSide({
                itemXml: xml,
                trustedResponses: { RESPONSE: response },
              });
              if (!(copiedScore.ok)) expect.unreachable('Expected copiedScore.ok');
              expect(copiedScore.score).toStrictEqual(originalScore.score);
            }
          }
          expect(await getQuestionRevision(fixture.ctx, sourceId, 1)).toStrictEqual(source);
          if (process.env['QFLOW_BROWSER_TESTS'] === '1') {
            await verifyNativeCopyInBrowser(fixture.ctx, assessment.id, sourceDraft.title ?? '');
          }
        } finally {
          await deleteAssessment(fixture.ctx, assessment.id);
        }
      }, { filename: 'native-scoring.zip', mime: 'application/zip', bytes, adapterId: 'qti3' });
    }, { count: 1, activation: 'disabled', difficulty: 'none' });
  } finally {
    await shutdownDb();
  }
});
