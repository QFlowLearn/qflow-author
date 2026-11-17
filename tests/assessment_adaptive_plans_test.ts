import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import { assessmentArrangementCommandFixture } from './helpers/assessment_arrangement.ts';
import { assessmentPlacementRemovalService } from '../lib/services/assessment_placement_removal.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import {
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
  toAssessmentExportSelectionDocument,
} from '../lib/export/assessment.ts';
import { resolveAssessmentExportTarget } from '../lib/export/assessment_export_targets.ts';

import { and, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { questionRevisions, questions } from '../lib/db/schema.ts';
import { parseAdaptivePlanCommand } from '../lib/assessment_adaptive_plan.ts';
import { AssessmentAdaptivePlans } from '../lib/services/assessment_adaptive_plans.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { setPlacementFollowLatest } from '../lib/services/assessment_structure.ts';
import { AdaptiveAssessmentMembershipError } from '../lib/services/assessment_membership.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';

testCase(
  'adaptive construction pins 285 questions with stable retries and guarded membership',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const store = new BankEnrichmentStore(db, () => new Date());
        const created = await store.saveVersion(ctx, {
          id: crypto.randomUUID(),
          schemeId: crypto.randomUUID(),
          expectedVersion: 0,
          definition: enrichmentDefinitionFixture(),
        });
        if (!(created.ok)) expect.unreachable('Expected created.ok');
        const assessment = await createAssessmentDraft(ctx);
        try {
          const ids = await addEnrichmentQuestions(ctx, 285);
          for (
            const [level, start, end] of [['easy', 0, 100], ['moderate', 100, 195], [
              'hard',
              195,
              285,
            ]] as const
          ) {
            await assignOverviewFixture(
              ctx,
              created.value.schemeId,
              created.value.id,
              ids.slice(start, end),
              { difficulty: { state: 'assigned', valueIds: [level] } },
            );
          }
          const input = {
            kind: 'build',
            buildId: crypto.randomUUID(),
            expectedRevision: 0,
            settings: {
              selection: `scheme=${created.value.schemeId}`,
              versionId: created.value.id,
              levelIds: ['easy', 'moderate', 'hard'],
              questionCount: 100,
            },
          };
          const command = parseAdaptivePlanCommand(input);
          if (!command) expect.unreachable('Expected command');
          let draws = 0;
          const service = new AssessmentAdaptivePlans(db, () => {
            draws++;
            return 0;
          });
          const started = performance.now();
          const built = await service.run(ctx, assessment.id, command);
          console.log(
            `Adaptive construction: ${
              Math.round(performance.now() - started)
            }ms for 285 eligible questions`,
          );
          if (!(built.ok && built.value.kind === 'built')) {
            expect.unreachable("Expected built.ok && built.value.kind === 'built'");
          }
          expect(built.value.plan.blocks.length).toStrictEqual(57);
          expect(draws).toStrictEqual(285);
          expect(await service.run(ctx, assessment.id, command)).toStrictEqual(built);
          expect(draws).toStrictEqual(285);
          const saved = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(saved);
          if (!(saved.adaptivePlan)) expect.unreachable('Expected saved.adaptivePlan');
          expect(saved.targetCount).toStrictEqual(100);
          const resolved = await loadAssessmentItemExports(
            db,
            ctx,
            toAssessmentExportSelectionDocument(saved),
          );
          const exported = await buildValidatedQti3Assessment(resolved.document);
          if (!(exported.validation.ok)) expect.unreachable('Expected exported.validation.ok');
          const destination = resolveAssessmentExportTarget('qti3-conformant');
          if (!(destination.ok)) expect.unreachable('Expected destination.ok');
          const packaged = await convertQti3AssessmentPackage({
            document: resolved.document,
            assessmentXml: exported.xml,
            itemsXml: resolved.itemsXml,
            assets: [],
          }, destination.target);
          if (!(packaged.ok)) expect.unreachable('Expected packaged.ok');
          const handoff = process.env['QFLOW_ADAPTIVE_HANDOFF'];
          if (handoff) await _fs.writeFile(handoff, packaged.artifact);
          const placements = saved.parts.flatMap((part) => part.placements);
          expect(placements.length).toStrictEqual(285);
          expect(new Set(placements.map((placement) => placement.itemId)).size).toStrictEqual(285);
          if (!(placements.every((placement) => placement.snapshotRev === 1))) {
            expect.unreachable(
              'Expected placements.every((placement) => placement.snapshotRev === 1)',
            );
          }
          expect(
            await assessmentPlacementRemovalService.remove(ctx, assessment.id, placements[0].id, {
              removalId: crypto.randomUUID(),
              expectedRevision: 1,
            }),
          ).toStrictEqual({ ok: false, code: 'adaptive_managed' });
          await expect(
            Promise.resolve().then(() =>
              setPlacementFollowLatest(ctx, assessment.id, placements[0].id)
            ),
          ).rejects.toBeInstanceOf(AdaptiveAssessmentMembershipError);
          const arrangement = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(arrangement);
          const arrangeCommand = await assessmentArrangementCommandFixture(
            ctx,
            assessment.id,
            arrangement.parts,
          );
          for (
            const command of [arrangeCommand, {
              ...arrangeCommand,
              canvasMove: {
                partId: arrangement.parts[0].id,
                placementId: placements[0].id,
                position: 0,
              },
            }]
          ) {
            const arrangeResult = await saveAssessmentParts(ctx, assessment.id, command);
            if (arrangeResult.ok) expect.unreachable('Expected !arrangeResult.ok');
            expect(arrangeResult.error.code).toStrictEqual('adaptive_managed');
          }
          const changed = parseAdaptivePlanCommand({
            ...input,
            settings: { ...input.settings, questionCount: 15 },
          });
          if (!changed) expect.unreachable('Expected changed');
          expect(await service.run(ctx, assessment.id, changed)).toStrictEqual({
            ok: false,
            code: 'conflict',
          });
          const rebuild = parseAdaptivePlanCommand({
            ...input,
            buildId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          if (!rebuild) expect.unreachable('Expected rebuild');
          const competing = parseAdaptivePlanCommand({
            ...input,
            buildId: crypto.randomUUID(),
            expectedRevision: 1,
          });
          if (!competing) expect.unreachable('Expected competing');
          const concurrent = await Promise.all([
            service.run(ctx, assessment.id, rebuild),
            service.run(ctx, assessment.id, competing),
          ]);
          expect(concurrent.filter((result) => result.ok).length).toStrictEqual(1);
          expect(concurrent.filter((result) => !result.ok && result.code === 'conflict').length)
            .toStrictEqual(1);
          const rebuilt = concurrent.find((result) => result.ok);
          if (!rebuilt) expect.unreachable('Expected rebuilt');
          if (!(rebuilt.ok && rebuilt.value.kind === 'built')) {
            expect.unreachable("Expected rebuilt.ok && rebuilt.value.kind === 'built'");
          }
          expect(rebuilt.value.plan.revision).toStrictEqual(2);
          expect(
            (await getAssessment(ctx, assessment.id))?.parts.flatMap((p) => p.placements).length,
          ).toStrictEqual(285);
          const revisions = await db.select({ revision: questionRevisions.revision }).from(
            questionRevisions,
          ).where(eq(questionRevisions.tenantId, ctx.tenantId));
          expect(revisions.length).toStrictEqual(285);
          if (!(revisions.every((revision) => revision.revision === 1))) {
            expect.unreachable('Expected revisions.every((revision) => revision.revision === 1)');
          }
          const [old] = await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, ids[1]),
          );
          const revisionId = crypto.randomUUID();
          await db.insert(questionRevisions).values({ ...old, id: revisionId, revision: 2 });
          await db.update(questions).set({ latestRevisionId: revisionId }).where(
            eq(questions.id, ids[1]),
          );
          const other = { ...ctx, tenantId: crypto.randomUUID() };
          expect(await service.run(other, assessment.id, command)).toStrictEqual({
            ok: false,
            code: 'forbidden',
          });
          // A published revision whose scoring is no longer eligible cannot silently fill its bucket.
          await db.update(questionRevisions).set({ qtiXml: '<invalid/>' }).where(
            and(
              eq(questionRevisions.tenantId, ctx.tenantId),
              eq(questionRevisions.questionId, ids[284]),
            ),
          );
          const inspect = parseAdaptivePlanCommand({ kind: 'inspect', settings: input.settings });
          if (!inspect) expect.unreachable('Expected inspect');
          const coverage = await service.run(ctx, assessment.id, inspect);
          if (!(coverage.ok && coverage.value.kind === 'coverage')) {
            expect.unreachable("Expected coverage.ok && coverage.value.kind === 'coverage'");
          }
          expect(coverage.value.coverage.levels.map((level) => level.available)).toStrictEqual([
            99,
            95,
            89,
          ]);
          await db.update(questions).set({
            lifecycleState: 'archived',
            archivedAt: new Date(),
            archivedBy: ctx.userId,
          }).where(eq(questions.id, ids[0]));
          const shortfall = parseAdaptivePlanCommand({
            ...input,
            buildId: crypto.randomUUID(),
            expectedRevision: 2,
          });
          if (!shortfall) expect.unreachable('Expected shortfall');
          const refused = await service.run(ctx, assessment.id, shortfall);
          if (!(refused.ok && refused.value.kind === 'shortfall')) {
            expect.unreachable("Expected refused.ok && refused.value.kind === 'shortfall'");
          }
          expect((await getAssessment(ctx, assessment.id))?.adaptivePlan?.revision).toStrictEqual(
            2,
          );
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
