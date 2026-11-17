import { expect, test as testCase } from 'vitest';

import { parseQtiFixedTestOrdering, parseQtiTestRubrics } from '@longsightgroup/qti3-core';
import { unzipSync } from 'fflate';
import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentPlacements } from '../lib/db/schema.ts';
import { assessmentArrangementVersion } from '../lib/assessment_arrangement_version.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { importedQuestionPlacements } from '../lib/import/types.ts';
import { AssessmentQuestionOrderPreviews } from '../lib/services/assessment_question_order_preview.ts';
import { parseQuestionOrderPreview } from '../lib/assessment_question_order_preview_response.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import {
  duplicateAssessment,
  getAssessment,
  listAssessments,
} from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { assessmentPlacementRemovalService } from '../lib/services/assessment_placement_removal.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assessmentArrangementCommandFixture } from './helpers/assessment_arrangement.ts';

testCase(
  'unscored text retains canonical mixed order, exact retries, stale edits, question recovery and independent copies',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Text between questions' });
        let copyId: string | undefined;
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          for (const title of ['First', 'Second']) {
            const created = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type: 'single_select',
                title,
                itemLanguage: newAuthoringItemLanguage(),
                bodyHtml: '<p>Choose.</p>',
                choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
                correctId: 'A',
              },
            });
            if (!(created.ok)) expect.unreachable('Expected created.ok');
          }
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const [first, second] = assessmentQuestionPlacements(saved.parts[0].placements);
          const text = {
            id: crypto.randomUUID(),
            content: {
              kind: 'text' as const,
              text: '  Read <script> literally.\nConsider α & β before answering.  ',
            },
            fixed: true as const,
          };
          const command = await assessmentArrangementCommandFixture(ctx, assessment.id, [{
            ...saved.parts[0],
            placements: [first, text, second],
          }]);
          const inserted = await saveAssessmentParts(ctx, assessment.id, command);
          if (!(inserted.ok)) expect.unreachable('Expected inserted.ok');
          const mixed = await getAssessment(ctx, assessment.id);
          if (!mixed) expect.unreachable('Expected mixed');
          expect(mixed.parts[0].placements).toStrictEqual([first, text, second]);
          expect(mixed.targetCount).toStrictEqual(2);
          const preview = await new AssessmentQuestionOrderPreviews(db).preview(
            ctx,
            assessment.id,
            inserted.version,
            { seed: 1 },
          );
          if (!(preview.ok)) expect.unreachable('Expected preview.ok');
          expect(preview.value.parts[0].questions.map((question) => question.placementId))
            .toStrictEqual([
              first.id,
              second.id,
            ]);
          expect(preview.value.parts[0].instructions).toStrictEqual([{
            placementId: text.id,
            beforeQuestionNumber: 2,
            content: text.content,
          }]);
          expect(parseQuestionOrderPreview(preview.value, inserted.version, mixed.parts))
            .toStrictEqual(preview.value);
          for (
            const changes of [{ content: { kind: 'text', text: 'Changed' } }, {
              beforeQuestionNumber: 1,
            }, {
              placementId: first.id,
            }, { html: '<script/>' }]
          ) {
            expect(parseQuestionOrderPreview(
              {
                ...preview.value,
                parts: [{
                  ...preview.value.parts[0],
                  instructions: [{ ...preview.value.parts[0].instructions[0], ...changes }],
                }],
              },
              inserted.version,
              mixed.parts,
            )).toStrictEqual(null);
          }

          const exported = await buildAssessmentPackage({
            assessment: mixed,
            auth: ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: () => {
              throw new Error('Plain text cannot require an upload.');
            },
          });
          if (!(exported.ok)) expect.unreachable(exported.ok ? '' : exported.body.error);
          const entries = unzipSync(exported.artifact.bytes);
          const reimported = await parseQtiPackage(exported.artifact.bytes);
          expect(reimported.items.length).toStrictEqual(2);
          expect(reimported.parts[0].placements.length).toStrictEqual(3);
          expect(reimported.parts[0].placements[1]).toStrictEqual({
            content: text.content,
            refIdentifier: `content-${text.id}`,
          });
          expect(
            importedQuestionPlacements(reimported.parts[0].placements).map((placement) =>
              placement.href
            ),
          ).toStrictEqual([
            `items/item-${first.itemId}-r1.xml`,
            `items/item-${second.itemId}-r1.xml`,
          ]);
          const xml = new TextDecoder().decode(entries['assessment.xml']);
          const order = parseQtiFixedTestOrdering(xml);
          if (!(order.ok)) expect.unreachable('Expected order.ok');
          expect(order.value.sections.map((section) => section.items.map((item) => item.href)))
            .toStrictEqual([
              [`items/item-${first.itemId}-r1.xml`],
              [],
              [`items/item-${second.itemId}-r1.xml`],
            ]);
          const rubrics = parseQtiTestRubrics(xml);
          if (!(rubrics.ok)) expect.unreachable('Expected rubrics.ok');
          expect(rubrics.value.length).toStrictEqual(1);
          expect(rubrics.value[0].scopeType).toStrictEqual('assessment-section');
          expect(rubrics.value[0].scopeIdentifier).toStrictEqual(
            order.value.sections[1].sectionIdentifier,
          );
          expect(xml).toContain(
            '<p>  Read &lt;script&gt; literally.<br/>Consider α &amp; β before answering.  </p>',
          );
          expect(Object.keys(entries).filter((path) => path.startsWith('items/')).length)
            .toStrictEqual(2);
          expect(Object.keys(entries).filter((path) => path.startsWith('assets/')).length)
            .toStrictEqual(0);
          expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(mixed.parts);
          expect((await listAssessments(ctx)).find((row) => row.id === assessment.id)?.itemsCount)
            .toStrictEqual(2);
          const rowsBefore = await db.select().from(assessmentPlacements).where(
            eq(assessmentPlacements.assessmentPartId, saved.parts[0].id),
          );
          const retried = await saveAssessmentParts(ctx, assessment.id, command);
          if (!(retried.ok)) expect.unreachable('Expected retried.ok');
          expect(retried.version).toStrictEqual(inserted.version);
          expect(
            await db.select().from(assessmentPlacements).where(
              eq(assessmentPlacements.assessmentPartId, saved.parts[0].id),
            ),
          ).toStrictEqual(rowsBefore);

          const changedText = {
            ...text,
            content: { ...text.content, text: 'A newer explanation.' },
          };
          const edit = await assessmentArrangementCommandFixture(ctx, assessment.id, [{
            ...mixed.parts[0],
            placements: [first, changedText, second],
          }]);
          const edited = await saveAssessmentParts(ctx, assessment.id, edit);
          if (!(edited.ok)) expect.unreachable('Expected edited.ok');
          expect(edited.version).not.toStrictEqual(inserted.version);
          const stale = await saveAssessmentParts(ctx, assessment.id, command);
          if (stale.ok) expect.unreachable('Expected !stale.ok');
          expect(stale.error.code).toStrictEqual('stale_structure');
          expect((await getAssessment(ctx, assessment.id))?.parts[0].placements).toStrictEqual([
            first,
            changedText,
            second,
          ]);

          const removed = await assessmentPlacementRemovalService.remove(
            ctx,
            assessment.id,
            first.id,
            { removalId: crypto.randomUUID(), expectedRevision: 1 },
          );
          if (!(removed.ok)) expect.unreachable('Expected removed.ok');
          expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(1);
          const restored = await assessmentPlacementRemovalService.restore(
            ctx,
            assessment.id,
            removed.value.id,
          );
          if (!(restored.ok)) expect.unreachable('Expected restored.ok');
          expect((await getAssessment(ctx, assessment.id))?.parts[0].placements).toStrictEqual([
            first,
            changedText,
            second,
          ]);
          expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(2);

          const copied = await duplicateAssessment(ctx, assessment.id);
          expect(copied._tag).toStrictEqual('Duplicated');
          if (!(copied._tag === 'Duplicated')) {
            expect.unreachable("Expected copied._tag === 'Duplicated'");
          }
          copyId = copied.id;
          const copy = await getAssessment(ctx, copyId);
          if (!copy) expect.unreachable('Expected copy');
          expect(copy.targetCount).toStrictEqual(2);
          const copiedText = copy.parts[0].placements[1];
          if (!('content' in copiedText)) expect.unreachable("Expected 'content' in copiedText");
          expect(copiedText.content).toStrictEqual(changedText.content);
          expect(copiedText.id).not.toStrictEqual(text.id);
          expect(
            assessmentQuestionPlacements(copy.parts[0].placements).map((placement) =>
              placement.itemId
            ),
          ).toStrictEqual([first.itemId, second.itemId]);
          expect(await assessmentArrangementVersion(assessment.id, mixed.parts)).toStrictEqual(
            inserted.version,
          );
        } finally {
          if (copyId) await deleteAssessment(ctx, copyId);
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'the database rejects nullable check loopholes and competing ownership on unscored text',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Content constraints' });
        try {
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const text = {
            id: crypto.randomUUID(),
            content: { kind: 'text' as const, text: 'Instructions.' },
            fixed: true as const,
          };
          const command = await assessmentArrangementCommandFixture(ctx, assessment.id, [{
            ...saved.parts[0],
            placements: [text],
          }]);
          if (!((await saveAssessmentParts(ctx, assessment.id, command)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, command)).ok',
            );
          }
          for (
            const content of [
              null,
              {},
              { kind: 'text' },
              { text: 'Missing kind' },
              { kind: null, text: 'Null kind' },
              { kind: 'text', text: null },
              { kind: 'text', text: '\t\n ' },
              { kind: 'text', text: '\u00a0' },
              { kind: 'text', text: '\ufeff' },
              { kind: 'text', text: 'invalid\u0001' },
              { kind: 'text', text: 'Valid', extra: true },
            ]
          ) {
            const error = await (async () => {
              const caught: unknown = await Promise.resolve().then(() =>
                db.update(assessmentPlacements).set({ content }).where(
                  eq(assessmentPlacements.id, text.id),
                )
              ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
              if (!(caught instanceof Error)) expect.unreachable('Expected Error');
              return caught;
            })();
            if (!(error instanceof Error)) expect.unreachable('Expected error instanceof Error');
            const cause = error.cause;
            if (
              !(cause && typeof cause === 'object' && 'code' in cause && 'constraint_name' in cause)
            ) {
              expect.unreachable(
                "Expected cause && typeof cause === 'object' && 'code' in cause && 'constraint_name' in cause",
              );
            }
            expect(cause.code).toStrictEqual('23514');
            expect(cause.constraint_name).toStrictEqual(
              'assessment_placements_content_owner_check',
            );
          }
          const error = await (async () => {
            const caught: unknown = await Promise.resolve().then(() =>
              db.update(assessmentPlacements).set({ fixed: false }).where(
                eq(assessmentPlacements.id, text.id),
              )
            ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
            if (!(caught instanceof Error)) expect.unreachable('Expected Error');
            return caught;
          })();
          if (!(error instanceof Error)) expect.unreachable('Expected error instanceof Error');
          if (!(error.cause && typeof error.cause === 'object' && 'code' in error.cause)) {
            expect.unreachable(
              "Expected error.cause && typeof error.cause === 'object' && 'code' in error.cause",
            );
          }
          expect(error.cause.code).toStrictEqual('23514');
          expect((await getAssessment(ctx, assessment.id))?.parts[0].placements).toStrictEqual([
            text,
          ]);
          expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(0);
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
