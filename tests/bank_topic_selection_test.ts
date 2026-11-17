import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentPlacements, questionRevisions, questions } from '../lib/db/schema.ts';
import {
  type BankProposalResponse,
  parseBankProposalCommand,
} from '../lib/bank_question_proposal.ts';
import { parseBankProposalResponse } from '../lib/bank_question_proposal_response.ts';
import { parseBankSelectionCommand } from '../lib/assessment_bank_selection.ts';
import { BankQuestionProposals } from '../lib/services/bank_question_proposals.ts';
import { appendBankSelection } from '../lib/services/assessment_bank_selection.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import type { RequestContext } from '../lib/tenants.ts';

async function fixture(
  test: (
    f: {
      ctx: RequestContext;
      assessmentId: string;
      partId: string;
      ids: readonly string[];
      schemeId: string;
      versionId: string;
      selection: string;
    },
  ) => Promise<void>,
) {
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      const assessment = await createAssessmentDraft(ctx, { title: 'Topic-only quiz' });
      try {
        const saved = await getAssessment(ctx, assessment.id);
        if (!saved) expect.unreachable('Expected saved');
        const ids = await addEnrichmentQuestions(ctx, 7, db, { distinctContent: true });
        const schemeId = crypto.randomUUID(), versionId = crypto.randomUUID();
        const base = enrichmentDefinitionFixture();
        if (
          !((await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
            id: versionId,
            schemeId,
            expectedVersion: 0,
            definition: {
              ...base,
              topics: [base.topics[0], {
                id: 'organelles',
                label: 'Organelles',
                subjectId: 'life',
                definition: 'Cell structures.',
              }],
            },
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, { id: versionId, sch',
          );
        }
        for (let index = 0; index < ids.length; index++) {
          await assignOverviewFixture(ctx, schemeId, versionId, [ids[index]], {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: {
              state: 'assigned',
              valueIds: index === 2
                ? ['cells', 'organelles']
                : [index === 0 || index === 3 ? 'cells' : 'organelles'],
            },
            difficulty: { state: 'unassigned', reason: 'insufficient_context' },
          });
        }
        await test({
          ctx,
          assessmentId: assessment.id,
          partId: saved.parts[0].id,
          ids,
          schemeId,
          versionId,
          selection: `scheme=${schemeId}`,
        });
      } finally {
        await deleteAssessment(ctx, assessment.id);
      }
    });
  } finally {
    await shutdownDb();
  }
}
async function copyRevision(
  from: string,
  to: string,
  xmlTransform: (xml: string) => string = (xml) => xml,
) {
  const [source] = await db.select().from(questionRevisions).where(
    eq(questionRevisions.questionId, from),
  );
  const [target] = await db.select().from(questions).where(eq(questions.id, to));
  const [previous] = await db.select().from(questionRevisions).where(
    eq(questionRevisions.id, target.latestRevisionId ?? ''),
  );
  const id = crypto.randomUUID();
  await db.insert(questionRevisions).values({
    ...source,
    id,
    questionId: to,
    revision: previous.revision + 1,
    qtiXml: xmlTransform(source.qtiXml),
  });
  await db.update(questions).set({ latestRevisionId: id }).where(eq(questions.id, to));
  return previous.revision + 1;
}
const manual = (itemId: string, revision = 1) => ({
  itemId,
  revision,
  placementId: crypto.randomUUID(),
  proposal: null,
});
function automatic(
  partId: string,
  selection: string,
  response: Extract<BankProposalResponse, { kind: 'proposal' }>,
) {
  const command = parseBankSelectionCommand({
    partId,
    items: response.items.map((item) => ({
      itemId: item.question.id,
      revision: item.question.latestRev,
      placementId: crypto.randomUUID(),
      proposal: {
        mode: response.mode,
        selection,
        versionId: response.version.id,
        categoryId: item.categoryId,
      },
    })),
  });
  if (!command) expect.unreachable('Expected command');
  return command;
}
testCase(
  'topic counts ignore empty difficulty, exclude pinned copies, and report overlapping distinct shortfalls',
  async () => {
    await fixture(async (f) => {
      await copyRevision(f.ids[0], f.ids[1]);
      await assignOverviewFixture(f.ctx, f.schemeId, f.versionId, [f.ids[1]], {
        topic: { state: 'assigned', valueIds: ['organelles'] },
      });
      await copyRevision(
        f.ids[4],
        f.ids[4],
        (xml) => xml.replace('<qti-item-body>', '<qti-item-body><img src="passage.png"/>'),
      );
      await assignOverviewFixture(f.ctx, f.schemeId, f.versionId, [f.ids[4]], {
        topic: { state: 'assigned', valueIds: ['organelles'] },
      });
      if (
        !((await appendBankSelection(f.ctx, f.assessmentId, {
          partId: f.partId,
          items: [manual(f.ids[0])],
        })).ok)
      ) {
        expect.unreachable(
          'Expected (await appendBankSelection(f.ctx, f.assessmentId, { partId: f.partId, items: [manual(f.ids',
        );
      }
      await copyRevision(f.ids[5], f.ids[0]); // The placement still contains the original alpha content.
      await db.update(questions).set({
        lifecycleState: 'archived',
        archivedAt: new Date(),
        archivedBy: f.ctx.userId,
      }).where(eq(questions.id, f.ids[6]));
      const service = new BankQuestionProposals(db, () => 0);
      const inspect = parseBankProposalCommand({
        kind: 'inspect',
        mode: 'topic',
        selection: f.selection,
        excludedQuestions: [],
      });
      if (!inspect) expect.unreachable('Expected inspect');
      const result = await service.run(f.ctx, f.assessmentId, inspect);
      if (!(result.ok && result.value.kind === 'availability')) {
        expect.unreachable("Expected result.ok && result.value.kind === 'availability'");
      }
      if (!(parseBankProposalResponse(result.value, inspect))) {
        expect.unreachable('Expected parseBankProposalResponse(result.value, inspect)');
      }
      expect(result.value.versions[0].levels.map((l) => [l.id, l.available])).toStrictEqual([[
        'cells',
        2,
      ], [
        'organelles',
        2,
      ]]);
      expect(result.value.versions[0].unsupported).toStrictEqual(1);
      const draw = parseBankProposalCommand({
        kind: 'draw',
        mode: 'topic',
        selection: f.selection,
        versionId: f.versionId,
        counts: [{ categoryId: 'cells', count: 2 }, { categoryId: 'organelles', count: 2 }],
        excludedQuestions: [],
      });
      if (!draw) expect.unreachable('Expected draw');
      const short = await service.run(f.ctx, f.assessmentId, draw);
      if (!(short.ok && short.value.kind === 'shortfall')) {
        expect.unreachable("Expected short.ok && short.value.kind === 'shortfall'");
      }
      expect(short.value.available).toStrictEqual(3);
      if (!(parseBankProposalResponse(short.value, draw))) {
        expect.unreachable('Expected parseBankProposalResponse(short.value, draw)');
      }
      const feasible = parseBankProposalCommand({
        kind: 'draw',
        mode: 'topic',
        selection: f.selection,
        versionId: f.versionId,
        counts: [{ categoryId: 'cells', count: 1 }, { categoryId: 'organelles', count: 2 }],
        excludedQuestions: [],
      });
      if (!feasible) expect.unreachable('Expected feasible');
      const proposal = await service.run(f.ctx, f.assessmentId, feasible);
      if (!(proposal.ok && proposal.value.kind === 'proposal')) {
        expect.unreachable("Expected proposal.ok && proposal.value.kind === 'proposal'");
      }
      if (!(parseBankProposalResponse(proposal.value, feasible))) {
        expect.unreachable('Expected parseBankProposalResponse(proposal.value, feasible)');
      }
      expect(proposal.value.items.map((q) => q.question.id).sort()).toStrictEqual(
        [f.ids[2], f.ids[3], f.ids[5]].sort(),
      );
      const pinned = await service.run(f.ctx, f.assessmentId, {
        ...inspect,
        excludedQuestions: [{ itemId: f.ids[5], revision: 1 }],
      });
      if (!(pinned.ok && pinned.value.kind === 'availability')) {
        expect.unreachable("Expected pinned.ok && pinned.value.kind === 'availability'");
      }
      expect(pinned.value.versions[0].levels.find((l) => l.id === 'organelles')?.available)
        .toStrictEqual(1);
      const difficulty = await service.run(f.ctx, f.assessmentId, {
        ...inspect,
        mode: 'difficulty',
      });
      if (!(difficulty.ok && difficulty.value.kind === 'availability')) {
        expect.unreachable("Expected difficulty.ok && difficulty.value.kind === 'availability'");
      }
      if (!(difficulty.value.versions[0].levels.every((l) => l.available === 0))) {
        expect.unreachable(
          'Expected difficulty.value.versions[0].levels.every((l) => l.available === 0)',
        );
      }
      const command = automatic(f.partId, f.selection, proposal.value);
      if (!((await appendBankSelection(f.ctx, f.assessmentId, command)).ok)) {
        expect.unreachable(
          'Expected (await appendBankSelection(f.ctx, f.assessmentId, command)).ok',
        );
      }
      if (!((await appendBankSelection(f.ctx, f.assessmentId, command)).ok)) {
        expect.unreachable(
          'Expected (await appendBankSelection(f.ctx, f.assessmentId, command)).ok',
        );
      }
      expect((await getAssessment(f.ctx, f.assessmentId))?.targetCount).toStrictEqual(4);
    });
  },
);
testCase(
  'atomic add rejects duplicates introduced after preview and preserves manual choices and retry identity',
  async () => {
    await fixture(async (f) => {
      const service = new BankQuestionProposals(db, () => 0);
      const draw = parseBankProposalCommand({
        kind: 'draw',
        mode: 'topic',
        selection: f.selection,
        versionId: f.versionId,
        counts: [{ categoryId: 'cells', count: 1 }],
        excludedQuestions: [],
      });
      if (!draw) expect.unreachable('Expected draw');
      const proposal = await service.run(f.ctx, f.assessmentId, draw);
      if (!(proposal.ok && proposal.value.kind === 'proposal')) {
        expect.unreachable("Expected proposal.ok && proposal.value.kind === 'proposal'");
      }
      const command = automatic(f.partId, f.selection, proposal.value);
      const revision = await copyRevision(command.items[0].itemId, f.ids[6]);
      const kept = manual(f.ids[6], revision);
      if (
        !((await appendBankSelection(f.ctx, f.assessmentId, { partId: f.partId, items: [kept] }))
          .ok)
      ) {
        expect.unreachable(
          'Expected (await appendBankSelection(f.ctx, f.assessmentId, { partId: f.partId, items: [kept] })).ok',
        );
      }
      expect(await appendBankSelection(f.ctx, f.assessmentId, command)).toStrictEqual({
        ok: false,
        code: 'conflict',
      });
      expect((await getAssessment(f.ctx, f.assessmentId))?.targetCount).toStrictEqual(1);
      await db.delete(assessmentPlacements).where(eq(assessmentPlacements.id, kept.placementId));
      const revision2 = await copyRevision(command.items[0].itemId, command.items[0].itemId);
      expect(revision2).toStrictEqual(2);
      expect(await appendBankSelection(f.ctx, f.assessmentId, command)).toStrictEqual({
        ok: false,
        code: 'conflict',
      });
      // A manual pinned choice remains valid even when a newer revision exists.
      if (
        !((await appendBankSelection(f.ctx, f.assessmentId, {
          partId: f.partId,
          items: command.items.map((item) => ({ ...item, proposal: null })),
        })).ok)
      ) {
        expect.unreachable(
          'Expected (await appendBankSelection(f.ctx, f.assessmentId, { partId: f.partId, items: command.items',
        );
      }
    });
  },
);
testCase(
  'incomplete selected content blocks automatic comparisons without blocking manual additions',
  async () => {
    await fixture(async (f) => {
      const revision = await copyRevision(
        f.ids[0],
        f.ids[0],
        (xml) => xml.replace('<qti-item-body>', '<qti-item-body><img src="image.png"/>'),
      );
      const selected = manual(f.ids[0], revision);
      if (
        !((await appendBankSelection(f.ctx, f.assessmentId, {
          partId: f.partId,
          items: [selected],
        }))
          .ok)
      ) {
        expect.unreachable(
          'Expected (await appendBankSelection(f.ctx, f.assessmentId, { partId: f.partId, items: [selected] })',
        );
      }
      const inspect = parseBankProposalCommand({
        kind: 'inspect',
        mode: 'topic',
        selection: f.selection,
        excludedQuestions: [],
      });
      if (!inspect) expect.unreachable('Expected inspect');
      expect(await new BankQuestionProposals(db, () => 0).run(f.ctx, f.assessmentId, inspect))
        .toStrictEqual({
          ok: false,
          code: 'unsupported_selection',
        });
    });
  },
);

testCase(
  'automatic add rechecks current category, bank scope and pending manual duplicates',
  async () => {
    await fixture(async (f) => {
      const draw = parseBankProposalCommand({
        kind: 'draw',
        mode: 'topic',
        selection: f.selection,
        versionId: f.versionId,
        counts: [{ categoryId: 'cells', count: 1 }],
        excludedQuestions: [],
      });
      if (!draw) expect.unreachable('Expected draw');
      const result = await new BankQuestionProposals(db, () => 0).run(f.ctx, f.assessmentId, draw);
      if (!(result.ok && result.value.kind === 'proposal')) {
        expect.unreachable("Expected result.ok && result.value.kind === 'proposal'");
      }
      const command = automatic(f.partId, f.selection, result.value), chosen = command.items[0];
      const revision = await copyRevision(chosen.itemId, f.ids[6]);
      expect(
        await appendBankSelection(f.ctx, f.assessmentId, {
          ...command,
          items: [...command.items, manual(f.ids[6], revision)],
        }),
      ).toStrictEqual({ ok: false, code: 'conflict' });
      expect(
        await appendBankSelection(
          f.ctx,
          f.assessmentId,
          automatic(f.partId, `${f.selection}&q=never-matches-this-bank`, result.value),
        ),
      ).toStrictEqual({ ok: false, code: 'conflict' });
      await assignOverviewFixture(f.ctx, f.schemeId, f.versionId, [chosen.itemId], {
        topic: { state: 'assigned', valueIds: ['organelles'] },
      });
      expect(await appendBankSelection(f.ctx, f.assessmentId, command)).toStrictEqual({
        ok: false,
        code: 'conflict',
      });
      expect((await getAssessment(f.ctx, f.assessmentId))?.targetCount).toStrictEqual(0);
    });
  },
);

testCase(
  'concurrent automatic adds of equivalent questions commit at most one content group',
  async () => {
    await fixture(async (f) => {
      const revision = await copyRevision(f.ids[0], f.ids[1]);
      await assignOverviewFixture(f.ctx, f.schemeId, f.versionId, [f.ids[1]], {
        topic: { state: 'assigned', valueIds: ['cells'] },
      });
      const commands = [manual(f.ids[0]), manual(f.ids[1], revision)].map((item) => {
        const command = parseBankSelectionCommand({
          partId: f.partId,
          items: [{
            ...item,
            proposal: {
              mode: 'topic',
              selection: f.selection,
              versionId: f.versionId,
              categoryId: 'cells',
            },
          }],
        });
        if (!command) expect.unreachable('Expected command');
        return command;
      });
      const results = await Promise.all(
        commands.map((command) => appendBankSelection(f.ctx, f.assessmentId, command)),
      );
      expect(results.filter((result) => result.ok).length).toStrictEqual(1);
      expect(results.filter((result) => !result.ok)).toStrictEqual([{
        ok: false,
        code: 'conflict',
      }]);
      expect((await getAssessment(f.ctx, f.assessmentId))?.targetCount).toStrictEqual(1);
    });
  },
);

testCase(
  'oversized revision content is reported as unsupported without entering automatic counts',
  async () => {
    await fixture(async (f) => {
      await copyRevision(
        f.ids[6],
        f.ids[6],
        (xml) => xml.replace('<qti-item-body>', `<qti-item-body><p>${'x'.repeat(256_001)}</p>`),
      );
      await assignOverviewFixture(f.ctx, f.schemeId, f.versionId, [f.ids[6]], {
        topic: { state: 'assigned', valueIds: ['organelles'] },
      });
      const inspect = parseBankProposalCommand({
        kind: 'inspect',
        mode: 'topic',
        selection: f.selection,
        excludedQuestions: [],
      });
      if (!inspect) expect.unreachable('Expected inspect');
      const available = await new BankQuestionProposals(db, () => 0).run(
        f.ctx,
        f.assessmentId,
        inspect,
      );
      if (!(available.ok && available.value.kind === 'availability')) {
        expect.unreachable("Expected available.ok && available.value.kind === 'availability'");
      }
      expect(available.value.versions[0].unsupported).toStrictEqual(1);
      expect(available.value.versions[0].levels.find((l) => l.id === 'organelles')?.available)
        .toStrictEqual(4);
    });
  },
);
