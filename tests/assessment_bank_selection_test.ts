import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentParts, assessmentPlacements, questions } from '../lib/db/schema.ts';
import {
  BANK_SELECTION_LIMIT,
  parseBankSelectionCommand,
  parseBankSelectionResult,
} from '../lib/assessment_bank_selection.ts';
import { appendBankSelection } from '../lib/services/assessment_bank_selection.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';
import { placementsApiRoute as appendHandlerEndpoint } from '../lib/http/routes/assessment_api/placements.ts';
import { itemPreviewApiRoute as previewHandlerEndpoint } from '../lib/http/routes/assessment_api/item_preview.ts';
import { parseBankQuestionPreview } from '../lib/bank_question_preview.ts';

const appendHandler = appendHandlerEndpoint.handle;
const previewHandler = previewHandlerEndpoint.handle;

const choose = (itemId: string) => ({
  itemId,
  revision: 1,
  placementId: crypto.randomUUID(),
  proposal: null,
});

testCase('manual bank selection boundary rejects ambiguity and excessive batches', () => {
  const item = choose(crypto.randomUUID()), partId = crypto.randomUUID();
  const command = { partId, items: [item] };
  expect(parseBankSelectionCommand(command)).toStrictEqual(command);
  for (
    const raw of [
      null,
      {},
      { ...command, extra: true },
      { ...command, partId: 'bad' },
      { ...command, items: [] },
      { ...command, items: [item, item] },
      { ...command, items: [item, { ...item, placementId: crypto.randomUUID() }] },
      { ...command, items: [{ ...item, revision: 1.5 }] },
      { ...command, items: [{ ...item, followLatest: true }] },
      {
        ...command,
        items: Array.from({ length: BANK_SELECTION_LIMIT + 1 }, () => choose(crypto.randomUUID())),
      },
    ]
  ) expect(parseBankSelectionCommand(raw)).toStrictEqual(null);
  expect(parseBankSelectionResult({ ...command, items: [] }, command)).toStrictEqual(null);
});

testCase(
  'bank batch append is atomic, tenant-scoped, pinned, correctly placed, and retry-safe',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const record = await createAssessmentDraft(ctx, { title: 'Batch selection' });
        const secondPart = crypto.randomUUID();
        await db.insert(assessmentParts).values({
          id: secondPart,
          assessmentId: record.id,
          title: 'Second part',
          position: 2,
        });
        try {
          const ids = await addEnrichmentQuestions(ctx, 5);
          const command = { partId: secondPart, items: ids.slice(0, 2).map(choose) };
          const parsed = parseBankSelectionCommand(command);
          if (!parsed) expect.unreachable('Expected parsed');
          // A missing revision anywhere must leave the entire batch unapplied.
          const invalid = await appendBankSelection(ctx, record.id, {
            ...parsed,
            items: [parsed.items[0], { ...parsed.items[1], revision: 99 }],
          });
          expect(invalid).toStrictEqual({ ok: false, code: 'unavailable' });
          expect(
            (await getAssessment(ctx, record.id))?.parts.flatMap((part) => part.placements).length,
          ).toStrictEqual(0);
          // Concurrent identical deliveries serialize and return the same placements.
          const results = await Promise.all([
            appendBankSelection(ctx, record.id, parsed),
            appendBankSelection(ctx, record.id, parsed),
          ]);
          if (!(results[0].ok && results[1].ok)) {
            expect.unreachable('Expected results[0].ok && results[1].ok');
          }
          expect(results[0].value).toStrictEqual(results[1].value);
          if (!(parseBankSelectionResult(results[0].value, parsed))) {
            expect.unreachable('Expected parseBankSelectionResult(results[0].value, parsed)');
          }
          const saved = await getAssessment(ctx, record.id);
          assertQuestionOnlyAssessmentFixture(saved);
          expect(saved.parts[0].placements.length).toStrictEqual(0);
          expect(saved?.parts[1].placements.map((p) => [p.id, p.itemId, p.snapshotRev]))
            .toStrictEqual(parsed.items.map((i) => [i.placementId, i.itemId, 1]));
          expect(saved?.targetCount).toStrictEqual(2);
          const positions = await db.select({ position: assessmentPlacements.position }).from(
            assessmentPlacements,
          ).where(eq(assessmentPlacements.assessmentPartId, secondPart));
          expect(positions.map((p) => p.position).sort()).toStrictEqual([1, 2]);
          // A fresh request may not duplicate a question already present, or partially add its peers.
          expect(
            await appendBankSelection(ctx, record.id, {
              partId: secondPart,
              items: [choose(ids[0]), choose(ids[2])],
            }),
          ).toStrictEqual({ ok: false, code: 'conflict' });
          expect(
            await appendBankSelection(ctx, record.id, { ...parsed, partId: saved.parts[0].id }),
          ).toStrictEqual({ ok: false, code: 'conflict' });
          expect(
            await appendBankSelection({ ...ctx, role: 'teaching_assistant' }, record.id, parsed),
          ).toStrictEqual({ ok: false, code: 'forbidden' });
          await withEnrichmentWorkspace(async (other) => {
            expect(await appendBankSelection(other, record.id, parsed)).toStrictEqual({
              ok: false,
              code: 'not_found',
            });
            const preview = await invokeHttpMethod(
              previewHandler,
              'GET',
              makeHttpRequest(
                new Request(`http://local/api/items/${ids[0]}/preview?revision=1`),
                { auth: other, params: { id: ids[0] } },
              ),
            );
            expect(preview.status).toStrictEqual(404);
            const foreign = await addEnrichmentQuestions(other, 1);
            expect(
              await appendBankSelection(ctx, record.id, {
                partId: secondPart,
                items: [choose(ids[2]), choose(foreign[0])],
              }),
            ).toStrictEqual({ ok: false, code: 'unavailable' });
          });
          const response = await invokeHttpMethod(
            appendHandler,
            'POST',
            makeHttpRequest(
              new Request(`http://local/api/assessments/${record.id}/placements`, {
                ...{ duplex: 'half' },
                method: 'POST',
                body: JSON.stringify(parsed),
              }),
              { auth: ctx, params: { id: record.id } },
            ),
          );
          expect(response.status).toStrictEqual(201);
          if (!(parseBankSelectionResult(await response.json(), parsed))) {
            expect.unreachable('Expected parseBankSelectionResult(await response.json(), parsed)');
          }
          const preview = await invokeHttpMethod(
            previewHandler,
            'GET',
            makeHttpRequest(
              new Request(`http://local/api/items/${ids[0]}/preview?revision=1`),
              { auth: ctx, params: { id: ids[0] } },
            ),
          );
          expect(preview.status).toStrictEqual(200);
          const content = parseBankQuestionPreview(await preview.json(), ids[0], 1);
          if (!content) expect.unreachable('Expected content');
          expect(content.answers).toStrictEqual(['Nucleus']);
          if (!(content.xml.includes('DNA'))) {
            expect.unreachable("Expected content.xml.includes('DNA')");
          }
          expect(parseBankQuestionPreview(content, ids[0], 2)).toStrictEqual(null);
          await db.update(questions).set({
            lifecycleState: 'archived',
            archivedAt: new Date(),
            archivedBy: ctx.userId,
          }).where(eq(questions.id, ids[3]));
          expect(
            await appendBankSelection(ctx, record.id, {
              partId: secondPart,
              items: [choose(ids[2]), choose(ids[3])],
            }),
          ).toStrictEqual({ ok: false, code: 'unavailable' });
          expect((await getAssessment(ctx, record.id))?.targetCount).toStrictEqual(2);
          // The supported maximum is one transaction and one acknowledgement.
          const fullBatch = parseBankSelectionCommand({
            partId: secondPart,
            items: (await addEnrichmentQuestions(ctx, BANK_SELECTION_LIMIT)).map(choose),
          });
          if (!fullBatch) expect.unreachable('Expected fullBatch');
          const fullResult = await appendBankSelection(ctx, record.id, fullBatch);
          if (!(fullResult.ok)) expect.unreachable('Expected fullResult.ok');
          if (!(parseBankSelectionResult(fullResult.value, fullBatch))) {
            expect.unreachable('Expected parseBankSelectionResult(fullResult.value, fullBatch)');
          }
          expect(fullResult.value.items.length).toStrictEqual(BANK_SELECTION_LIMIT);
          expect((await getAssessment(ctx, record.id))?.targetCount).toStrictEqual(
            BANK_SELECTION_LIMIT + 2,
          );
        } finally {
          await deleteAssessment(ctx, record.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
