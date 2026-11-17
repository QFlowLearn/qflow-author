import { uploadsTable } from '../lib/db/workspace_schema.ts';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { db, shutdownDb } from '../lib/db.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { readPrintSource } from '../lib/services/assessment_print_source.ts';
import { preflightPrint } from '../lib/print/print_preflight.ts';
import { parsePrintConfiguration } from '../lib/print/print_contract.ts';

test('ordered real source preserves repeated pinned/latest occurrences and all standalone anchors', async () => {
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const imageId = crypto.randomUUID();
      await db.insert(uploadsTable).values({
        id: imageId,
        tenantId: ctx.tenantId,
        name: 'Diagram',
        mimeType: 'image/png',
        size: 100,
        path: `uploads/${ctx.tenantId}/${imageId}`,
        url: `/uploads/${imageId}`,
      });
      const assessment = await createAssessmentDraft(ctx, { title: 'Pinned source' });
      try {
        const initial = await getAssessment(ctx, assessment.id);
        if (!initial) expect.unreachable();
        const draft = {
          type: 'single_select' as const,
          title: 'Original',
          itemLanguage: newAuthoringItemLanguage(),
          bodyHtml: '<p>Version one.</p>',
          maximumScore: 1,
          choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }],
          correctId: 'B',
        };
        const first = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Create',
          partId: initial.parts[0].id,
          draft,
        });
        if (!first.ok) expect.unreachable();
        const revised = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Revise',
          placementId: first.value.placementId,
          itemId: first.value.itemId,
          expectedParentRevision: 1,
          draft: {
            ...draft,
            title: 'Latest',
            bodyHtml: '<p>Version two.</p>',
            maximumScore: 3.125,
            correctId: 'A',
          },
        });
        if (!revised.ok) expect.unreachable();
        const pinnedId = crypto.randomUUID(),
          latestId = first.value.placementId,
          beforeId = crypto.randomUUID(),
          afterId = crypto.randomUUID();
        await saveAssessmentArrangementFixture(ctx, assessment.id, [{
          id: initial.parts[0].id,
          title: 'Main',
          options: {},
          placements: [
            { id: beforeId, fixed: true, content: { kind: 'text', text: 'Stimulus before.' } },
            { id: pinnedId, fixed: false, itemId: first.value.itemId, snapshotRev: 1 },
            { id: latestId, fixed: false, itemId: first.value.itemId, snapshotRev: null },
            {
              id: afterId,
              fixed: true,
              content: {
                kind: 'image',
                src: `/uploads/${imageId}`,
                alt: 'Diagram after',
                longDescription: '',
              },
            },
          ],
        }]);
        const source = await readPrintSource(ctx, assessment.id, db);
        if (!source.ok) expect.unreachable();
        expect(source.value.parts[0].placements.map((placement) => placement.id)).toEqual([
          beforeId,
          pinnedId,
          latestId,
          afterId,
        ]);
        const pinned = source.value.parts[0].placements[1],
          latest = source.value.parts[0].placements[2];
        if (pinned.kind !== 'question' || latest.kind !== 'question') expect.unreachable();
        expect([pinned.revision, latest.revision]).toEqual([1, 2]);
        expect(pinned.revisionId).not.toBe(latest.revisionId);
        expect(pinned.xml).toContain('Version one.');
        expect(latest.xml).toContain('Version two.');
        const configuration = parsePrintConfiguration({
          title: 'Paper',
          paper: 'a4',
          locale: 'en-US',
          instructions: '',
          responseLines: 6,
          responseOverrides: {},
          order: 'authored',
          approvePresentation: true,
        });
        if (!configuration) expect.unreachable();
        const parts = preflightPrint(source.value, configuration).parts;
        expect(parts[0].placements.map((placement) => placement.kind)).toEqual([
          'content',
          'question',
          'question',
          'content',
        ]);
        const parsed1 = parts[0].placements[1], parsed2 = parts[0].placements[2];
        if (parsed1.kind !== 'question' || parsed2.kind !== 'question') expect.unreachable();
        expect(parsed1.question.scoring).toMatchObject({
          kind: 'match',
          maximum: 1,
          correct: ['B'],
        });
        expect(parsed2.question.scoring).toMatchObject({
          kind: 'match',
          maximum: 3.125,
          correct: ['A'],
        });
      } finally {
        await deleteAssessment(ctx, assessment.id);
        await db.delete(uploadsTable).where(eq(uploadsTable.id, imageId));
      }
    });
  } finally {
    await shutdownDb();
  }
});
