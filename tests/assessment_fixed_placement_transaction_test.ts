import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq, sql } from 'drizzle-orm';
import { parseQtiFixedTestOrdering, prepareQtiFixedTestOrder } from '@longsightgroup/qti3-core';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentPlacements, questionRevisions } from '../lib/db/schema.ts';
import { assessmentArrangementVersion } from '../lib/assessment_arrangement_version.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import { duplicateAssessment, getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { createAssessmentPlacementRemovalService } from '../lib/services/assessment_placement_removal.ts';
import { parseRestoredAssessmentPlacement } from '../lib/client/assessment_placement_recovery.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import {
  buildValidatedQti3Assessment,
  toAssessmentExportSelectionDocument,
} from '../lib/export/assessment.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assessmentArrangementCommandFixture } from './helpers/assessment_arrangement.ts';

testCase(
  'fixed positions survive arrangement, revision, adjacent duplication, assessment duplication and persisted Undo',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Protected order' });
        let copyId: string | undefined;
        try {
          const initial = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(initial);
          const partId = initial.parts[0].id;
          const draft = (title: string) => ({
            type: 'single_select' as const,
            title,
            itemLanguage: newAuthoringItemLanguage(),
            bodyHtml: '<p>Choose Paris.</p>',
            choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
            correctId: 'A',
            maximumScore: 3.125,
          });
          for (const title of ['First', 'Protected', 'Third', 'Last']) {
            const created = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId,
              draft: draft(title),
            });
            if (!(created.ok)) expect.unreachable('Expected created.ok');
            expect(created.value.fixed).toStrictEqual(false);
          }
          const before = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(before);
          const revisions = await db.select().from(questionRevisions).where(
            eq(questionRevisions.tenantId, ctx.tenantId),
          ).orderBy(questionRevisions.id);
          const command = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            before.parts.map((part) => ({
              ...part,
              options: { shuffleQuestions: true },
              placements: part.placements.map((placement, index) => ({
                ...placement,
                fixed: index === 1,
              })),
            })),
          );
          if (!((await saveAssessmentParts(ctx, assessment.id, command)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, command)).ok',
            );
          }
          const saved = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(saved);
          expect(saved.parts[0].placements.map((p) => p.fixed)).toStrictEqual([
            false,
            true,
            false,
            false,
          ]);
          expect(saved.parts[0].placements.map(({ fixed: _fixed, ...p }) => p)).toStrictEqual(
            before.parts[0].placements.map(({ fixed: _fixed, ...p }) => p),
          );
          expect(
            await db.select().from(questionRevisions).where(
              eq(questionRevisions.tenantId, ctx.tenantId),
            ).orderBy(questionRevisions.id),
          ).toStrictEqual(revisions);
          if (!((await saveAssessmentParts(ctx, assessment.id, command)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, command)).ok',
            );
          }
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(saved);
          const unfixed = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            saved.parts.map((part) => ({
              ...part,
              placements: part.placements.map((p) => ({ ...p, fixed: false })),
            })),
          );
          expect(command.expectedVersion).toStrictEqual(
            await assessmentArrangementVersion(assessment.id, before.parts),
          );
          if (!((await saveAssessmentParts(ctx, assessment.id, unfixed)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, unfixed)).ok',
            );
          }
          const stale = await saveAssessmentParts(ctx, assessment.id, command);
          if (stale.ok) expect.unreachable('Expected !stale.ok');
          expect(stale.error.code).toStrictEqual('stale_structure');
          const refix = await assessmentArrangementCommandFixture(ctx, assessment.id, saved.parts);
          if (!((await saveAssessmentParts(ctx, assessment.id, refix)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, refix)).ok',
            );
          }

          const exported = await loadAssessmentItemExports(
            db,
            ctx,
            toAssessmentExportSelectionDocument(saved),
          );
          const built = await buildValidatedQti3Assessment(exported.document);
          if (!(built.validation.ok)) expect.unreachable('Expected built.validation.ok');
          const parsed = parseQtiFixedTestOrdering(built.xml);
          if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
          expect(parsed.value.sections[0].items.map((item) => item.fixed)).toStrictEqual([
            false,
            true,
            false,
            false,
          ]);
          for (let seed = 0; seed < 12; seed++) {
            const order = prepareQtiFixedTestOrder(parsed.value, { kind: 'new', seed });
            if (!(order.ok)) expect.unreachable('Expected order.ok');
            expect(order.value.sections[0].itemRefs[1]).toStrictEqual(
              parsed.value.sections[0].items[1].identifier,
            );
            const restored = prepareQtiFixedTestOrder(parsed.value, {
              kind: 'restore',
              state: order.value,
            });
            if (!(restored.ok)) expect.unreachable('Expected restored.ok');
            expect(restored.value).toStrictEqual(order.value);
          }
          expect(Object.values(exported.itemsXml).sort()).toStrictEqual(
            revisions.map((row) => row.qtiXml).sort(),
          );
          const copy = await duplicateAssessment(ctx, assessment.id);
          if (!(copy._tag === 'Duplicated')) {
            expect.unreachable("Expected copy._tag === 'Duplicated'");
          }
          copyId = copy.id;
          const copied = await getAssessment(ctx, copy.id);
          assertQuestionOnlyAssessmentFixture(copied);
          expect(copied.parts[0].placements.map(({ id: _id, ...p }) => p)).toStrictEqual(
            saved.parts[0].placements.map(({ id: _id, ...p }) => p),
          );
          expect(copied.parts[0].options).toStrictEqual(saved.parts[0].options);

          const source = saved.parts[0].placements[1];
          const revised = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Revise',
            expectedParentRevision: 1,
            placementId: source.id,
            itemId: source.itemId,
            draft: draft('Protected revised'),
          });
          if (!(revised.ok)) expect.unreachable('Expected revised.ok');
          expect(revised.value.fixed).toStrictEqual(true);
          expect(revised.value.revision).toStrictEqual(2);
          const variant = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Variant',
            requestId: crypto.randomUUID(),
            partId,
            sourcePlacementId: source.id,
            sourceItemId: source.itemId,
            sourceRevision: 2,
            targetType: 'single_select',
          });
          if (!(variant.ok)) expect.unreachable('Expected variant.ok');
          expect(variant.value.fixed).toStrictEqual(true);
          const duplicated = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(duplicated);
          expect(duplicated.parts[0].placements.map((p) => p.fixed)).toStrictEqual([
            false,
            true,
            true,
            false,
            false,
          ]);
          expect(duplicated.parts[0].placements[2].id).toStrictEqual(variant.value.placementId);

          const originalRows = await db.select().from(assessmentPlacements).where(
            eq(assessmentPlacements.assessmentPartId, partId),
          ).orderBy(assessmentPlacements.position);
          const service = createAssessmentPlacementRemovalService({
            database: db,
            now: () => new Date('2026-10-08T01:00:00Z'),
          });
          const removalCommand = { removalId: crypto.randomUUID(), expectedRevision: 2 };
          const removed = await service.remove(ctx, assessment.id, source.id, removalCommand);
          if (!(removed.ok)) expect.unreachable('Expected removed.ok');
          expect(removed.value.fixed).toStrictEqual(true);
          expect(await service.remove(ctx, assessment.id, source.id, removalCommand)).toStrictEqual(
            removed,
          );
          const reloaded = createAssessmentPlacementRemovalService({
            database: db,
            now: () => new Date('2026-10-08T01:01:00Z'),
          });
          expect(await reloaded.list(ctx, assessment.id)).toStrictEqual({
            ok: true,
            value: [removed.value],
          });
          const restored = await reloaded.restore(ctx, assessment.id, removalCommand.removalId);
          if (!(restored.ok)) expect.unreachable('Expected restored.ok');
          expect(restored.value.placement.fixed).toStrictEqual(true);
          if (!(parseRestoredAssessmentPlacement(JSON.parse(JSON.stringify(restored.value))))) {
            expect.unreachable(
              'Expected parseRestoredAssessmentPlacement(JSON.parse(JSON.stringify(restored.value)))',
            );
          }
          expect(await reloaded.restore(ctx, assessment.id, removalCommand.removalId))
            .toStrictEqual(restored);
          expect(
            await db.select().from(assessmentPlacements).where(
              eq(assessmentPlacements.assessmentPartId, partId),
            ).orderBy(assessmentPlacements.position),
          ).toStrictEqual(originalRows);
          await expect(
            Promise.resolve().then(() =>
              db.update(assessmentPlacements).set({ fixed: sql`NULL` }).where(
                eq(assessmentPlacements.id, source.id),
              )
            ),
          ).rejects.toBeInstanceOf(Error);
          expect((await getAssessment(ctx, assessment.id))?.parts[0].placements.map((p) => p.fixed))
            .toStrictEqual([false, true, true, false, false]);
          await db.update(assessmentPlacements).set({ fixed: false }).where(
            eq(assessmentPlacements.id, source.id),
          );
          expect(await reloaded.restore(ctx, assessment.id, removalCommand.removalId))
            .toStrictEqual({
              ok: false,
              code: 'conflict',
            });
          expect((await getAssessment(ctx, assessment.id))?.parts[0].placements.map((p) => p.fixed))
            .toStrictEqual([false, false, true, false, false]);
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
