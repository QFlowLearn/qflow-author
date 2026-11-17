import { expect, test as testCase } from 'vitest';

import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { questions } from '../lib/db/schema.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { appendBankSelection } from '../lib/services/assessment_bank_selection.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { parseBankSelectionCommand } from '../lib/assessment_bank_selection.ts';
import { insertAssessmentPlacements } from '../lib/assessment_insertion.ts';

testCase('insertion boundaries reject malformed anchors and preserve local order', () => {
  const first = { id: 'first' }, last = { id: 'last' }, added = { id: 'added' };
  expect(insertAssessmentPlacements([first, last], [added], 'last')).toStrictEqual([
    first,
    added,
    last,
  ]);
  expect(insertAssessmentPlacements([first], [added])).toStrictEqual([first, added]);
  const base = {
    partId: crypto.randomUUID(),
    items: [{
      itemId: crypto.randomUUID(),
      placementId: crypto.randomUUID(),
      revision: 1,
      proposal: null,
    }],
  };
  for (const beforePlacementId of [null, '', 'not-a-uuid', 1]) {
    expect(parseBankSelectionCommand({ ...base, beforePlacementId })).toStrictEqual(null);
  }
  const beforePlacementId = crypto.randomUUID();
  expect(parseBankSelectionCommand({ ...base, beforePlacementId })?.beforePlacementId)
    .toStrictEqual(beforePlacementId);
});

testCase(
  'new and library questions persist at their chosen gap, with atomic failures and retry-safe batches',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const record = await createAssessmentDraft(ctx, { title: 'Insertion positions' });
        try {
          const initial = await getAssessment(ctx, record.id);
          if (!initial) expect.unreachable('Expected initial');
          const partId = initial.parts[0].id;
          const create = async (title: string, beforePlacementId?: string) => {
            return await saveAssessmentQuestion(ctx, record.id, {
              _tag: 'Create',
              partId,
              beforePlacementId,
              draft: {
                type: 'single_select',
                itemLanguage: newAuthoringItemLanguage(),
                title,
                bodyHtml: '<p>Which city is in France?</p>',
                choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
                correctId: 'A',
              },
            });
          };
          const first = await create('First'), last = await create('Last');
          if (!(first.ok && last.ok)) expect.unreachable('Expected first.ok && last.ok');
          const middle = await create('Middle', last.value.placementId);
          if (!(middle.ok)) expect.unreachable('Expected middle.ok');
          const beginning = await create('Beginning', first.value.placementId);
          if (!(beginning.ok)) expect.unreachable('Expected beginning.ok');
          const ids = [
            beginning.value.placementId,
            first.value.placementId,
            middle.value.placementId,
            last.value.placementId,
          ];
          expect((await getAssessment(ctx, record.id))?.parts[0].placements.map((p) => p.id))
            .toStrictEqual(ids);
          const before = await db.select({ id: questions.id }).from(questions).where(
            eq(questions.tenantId, ctx.tenantId),
          );
          const missing = await create('Must not be orphaned', crypto.randomUUID());
          if (missing.ok) expect.unreachable('Expected !missing.ok');
          expect(missing.status).toStrictEqual(404);
          expect(
            await db.select({ id: questions.id }).from(questions).where(
              eq(questions.tenantId, ctx.tenantId),
            ),
          ).toStrictEqual(before);
          const bank = await addEnrichmentQuestions(ctx, 3);
          const command = {
            partId,
            beforePlacementId: last.value.placementId,
            items: bank.slice(0, 2).map((itemId) => ({
              itemId,
              placementId: crypto.randomUUID(),
              revision: 1,
              proposal: null,
            })),
          };
          const results = await Promise.all([
            appendBankSelection(ctx, record.id, command),
            appendBankSelection(ctx, record.id, command),
          ]);
          if (!(results[0].ok && results[1].ok)) {
            expect.unreachable('Expected results[0].ok && results[1].ok');
          }
          expect(results[0].value).toStrictEqual(results[1].value);
          const expected = [
            ...ids.slice(0, 3),
            ...command.items.map((item) => item.placementId),
            ids[3],
          ];
          const saved = await getAssessment(ctx, record.id);
          expect(saved?.parts[0].placements.map((p) => p.id)).toStrictEqual(expected);
          expect(saved?.targetCount).toStrictEqual(6);
          expect(
            await appendBankSelection(ctx, record.id, {
              ...command,
              beforePlacementId: crypto.randomUUID(),
              items: [{ ...command.items[0], itemId: bank[2], placementId: crypto.randomUUID() }],
            }),
          ).toStrictEqual({ ok: false, code: 'conflict' });
          expect((await getAssessment(ctx, record.id))?.parts[0].placements.map((p) => p.id))
            .toStrictEqual(expected);
          const foreign = await createAssessmentDraft(ctx, { title: 'Other assessment' });
          try {
            const other = await getAssessment(ctx, foreign.id);
            if (!other) expect.unreachable('Expected other');
            expect(
              await appendBankSelection(ctx, foreign.id, {
                ...command,
                partId: other.parts[0].id,
                items: [{ ...command.items[0], itemId: bank[2], placementId: crypto.randomUUID() }],
              }),
            ).toStrictEqual({ ok: false, code: 'conflict' });
            expect((await getAssessment(ctx, foreign.id))?.parts[0].placements.length)
              .toStrictEqual(0);
          } finally {
            await deleteAssessment(ctx, foreign.id);
          }
        } finally {
          await deleteAssessment(ctx, record.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
