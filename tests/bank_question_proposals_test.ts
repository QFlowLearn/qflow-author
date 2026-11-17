import { expect, test as testCase } from 'vitest';

import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { questionRevisions, questions } from '../lib/db/schema.ts';
import {
  type BankProposalCommand,
  parseBankProposalCommand,
} from '../lib/bank_question_proposal.ts';
import { parseBankProposalResponse } from '../lib/bank_question_proposal_response.ts';
import { randomQuestionIndex, sampleQuestions } from '../lib/bank_question_sampling.ts';
import { BankQuestionProposals } from '../lib/services/bank_question_proposals.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { appendBankSelection } from '../lib/services/assessment_bank_selection.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assignOverviewFixture } from './helpers/enrichment_overview_fixture.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { proposalsApiRoute as handlerEndpoint } from '../lib/http/routes/assessment_api/proposals.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';

const handler = handlerEndpoint.handle;

testCase('proposal commands share bank filters and reject ambiguous or excessive requests', () => {
  const versionId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const input: BankProposalCommand = {
    kind: 'draw',
    mode: 'difficulty',
    selection: `scheme=${crypto.randomUUID()}&q=DNA&page=20`,
    excludedQuestions: [],
    versionId,
    counts: [{ categoryId: 'moderate', count: 20 }],
  };
  const parsed = parseBankProposalCommand(input);
  if (!parsed) expect.unreachable('Expected parsed');
  expect(parsed.query.search).toStrictEqual('DNA');
  expect(parsed.query.page).toStrictEqual(20);
  for (
    const value of [
      null,
      {},
      { ...input, extra: 1 },
      { ...input, selection: 'scheme=x' },
      { ...input, selection: 'q=a&q=b' },
      { ...input, versionId: 'bad' },
      { ...input, counts: [] },
      { ...input, counts: [{ categoryId: 'moderate', count: 1.5 }] },
      { ...input, counts: [{ categoryId: 'moderate', count: -1 }] },
      { ...input, counts: [...input.counts, ...input.counts] },
      { ...input, counts: [{ categoryId: 'moderate', count: 101 }] },
      { ...input, excludedQuestions: [itemId, itemId] },
      {
        kind: 'replace',
        selection: '',
        excludedQuestions: [],
        versionId,
        categoryId: 'moderate',
        itemId,
      },
    ]
  ) expect(parseBankProposalCommand(value)).toStrictEqual(null);
  if ('selection' in parsed) {
    expect.unreachable('Serialized filters do not cross into the service model');
  }
  if (
    !(parseBankProposalCommand({
      ...input,
      counts: [{ categoryId: 'moderate', count: 1 }],
      excludedQuestions: Array.from(
        { length: 99 },
        () => ({ itemId: crypto.randomUUID(), revision: 1 }),
      ).concat({ itemId, revision: 1 }),
    }))
  ) {
    expect.unreachable(
      'A replacement at capacity is a draw of one excluding all 100 selected questions',
    );
  }
  expect(parseBankProposalCommand({
    ...input,
    excludedQuestions: Array.from({ length: 101 }, () => crypto.randomUUID()),
  })).toStrictEqual(null);
});

testCase('sampling covers the full pool without repeats and leaves the pool unchanged', () => {
  const pool = Array.from({ length: 7787 }, (_, index) => index);
  expect(sampleQuestions(pool, 3, (limit) => limit - 1)).toStrictEqual([7786, 7785, 7784]);
  expect(pool[7786]).toStrictEqual(7786);
  const chosen = sampleQuestions(pool, 100, randomQuestionIndex);
  expect(new Set(chosen).size).toStrictEqual(100);
  if (!(chosen.every((value) => value >= 0 && value < 7787))) {
    expect.unreachable('Expected chosen.every((value) => value >= 0 && value < 7787)');
  }
  expect(() => sampleQuestions(pool, 7788, randomQuestionIndex)).toThrowError(Error);
  expect(() => sampleQuestions(pool, 1, (limit) => limit)).toThrowError(Error);
});

testCase(
  'proposals honor exact versioned counts, complete scopes, exclusions, freshness and pinned adds',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Question mix' });
        try {
          const ids = await addEnrichmentQuestions(ctx, 40, db, { distinctContent: true });
          const schemeId = crypto.randomUUID(),
            versionId = crypto.randomUUID(),
            newerId = crypto.randomUUID();
          const store = new BankEnrichmentStore(db, () => new Date());
          const definition = enrichmentDefinitionFixture();
          const withTopics = {
            ...definition,
            topics: [...definition.topics, {
              id: 'organelles',
              label: 'Organelles',
              definition: 'Cell components.',
              subjectId: 'life',
            }],
          };
          if (
            !((await store.saveVersion(ctx, {
              id: versionId,
              schemeId,
              expectedVersion: 0,
              definition: withTopics,
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await store.saveVersion(ctx, { id: versionId, schemeId, expectedVersion: 0, definition: w',
            );
          }
          await assignOverviewFixture(ctx, schemeId, versionId, ids, {
            subject: { state: 'assigned', valueIds: ['life'] },
            topic: { state: 'assigned', valueIds: ['cells', 'organelles'] },
            difficulty: { state: 'assigned', valueIds: ['moderate'] },
          });
          await assignOverviewFixture(ctx, schemeId, versionId, ids.slice(20, 30), {
            difficulty: { state: 'assigned', valueIds: ['easy'] },
          });
          await assignOverviewFixture(ctx, schemeId, versionId, ids.slice(30, 35), {
            difficulty: { state: 'assigned', valueIds: ['hard'] },
          });
          await assignOverviewFixture(ctx, schemeId, versionId, ids.slice(35, 37), {
            difficulty: { state: 'unassigned', reason: 'insufficient_context' },
          });
          await db.update(questions).set({
            lifecycleState: 'archived',
            archivedAt: new Date(),
            archivedBy: ctx.userId,
          }).where(eq(questions.id, ids[37]));
          const [old] = await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, ids[38]),
          );
          const revisionId = crypto.randomUUID();
          await db.insert(questionRevisions).values({ ...old, id: revisionId, revision: 2 });
          await db.update(questions).set({ latestRevisionId: revisionId }).where(
            eq(questions.id, ids[38]),
          );
          if (
            !((await store.saveVersion(ctx, {
              id: newerId,
              schemeId,
              expectedVersion: 1,
              definition: {
                ...withTopics,
                audience: 'Advanced students',
                difficulty: definition.difficulty.map((level) =>
                  level.id === 'moderate' ? { ...level, label: 'Applied' } : level
                ),
              },
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await store.saveVersion(ctx, { id: newerId, schemeId, expectedVersion: 1, definition: { .',
            );
          }
          await assignOverviewFixture(ctx, schemeId, newerId, [ids[39]], {
            difficulty: { state: 'assigned', valueIds: ['moderate'] },
          });
          const saved = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(saved);
          if (
            !((await appendBankSelection(ctx, assessment.id, {
              partId: saved.parts[0].id,
              items: [{
                placementId: crypto.randomUUID(),
                itemId: ids[0],
                revision: 1,
                proposal: null,
              }],
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await appendBankSelection(ctx, assessment.id, { partId: saved.parts[0].id, items: [{ plac',
            );
          }
          const service = new BankQuestionProposals(db, (limit) => limit - 1);
          const selection = `scheme=${schemeId}&q=DNA&tags=source-science&page=50&pageSize=1`;
          const inspect = parseBankProposalCommand({
            kind: 'inspect',
            mode: 'difficulty',
            selection,
            excludedQuestions: [{ itemId: ids[1], revision: 1 }],
          });
          if (!inspect) expect.unreachable('Expected inspect');
          const available = await service.run(ctx, assessment.id, inspect);
          if (!(available.ok && available.value.kind === 'availability')) {
            expect.unreachable("Expected available.ok && available.value.kind === 'availability'");
          }
          expect(available.value.versions.map((
            v,
          ) => [v.id, v.levels.map((l) => [l.label, l.available])])).toStrictEqual([
            [newerId, [['Easy', 0], ['Applied', 1], ['Hard', 0]]],
            [versionId, [['Easy', 10], ['Moderate', 18], ['Hard', 5]]],
          ]);
          if (!(parseBankProposalResponse(available.value, inspect))) {
            expect.unreachable('Expected parseBankProposalResponse(available.value, inspect)');
          }
          const command = parseBankProposalCommand({ ...inspect, query: undefined });
          expect(command, 'HTTP commands never accept a pre-decoded query').toStrictEqual(null);
          const choose = parseBankProposalCommand({
            kind: 'draw',
            mode: 'difficulty',
            selection,
            excludedQuestions: inspect.excludedQuestions,
            versionId,
            counts: [{ categoryId: 'easy', count: 5 }, { categoryId: 'moderate', count: 10 }, {
              categoryId: 'hard',
              count: 5,
            }],
          });
          if (!choose) expect.unreachable('Expected choose');
          const result = await service.run(ctx, assessment.id, choose);
          if (!(result.ok && result.value.kind === 'proposal')) {
            expect.unreachable("Expected result.ok && result.value.kind === 'proposal'");
          }
          if (!(parseBankProposalResponse(result.value, choose))) {
            expect.unreachable('Expected parseBankProposalResponse(result.value, choose)');
          }
          const proposal = result.value;
          expect(
            parseBankProposalResponse({
              kind: 'shortfall',
              mode: 'difficulty',
              version: proposal.version,
            }, choose),
            'A shortage must be supported by the returned availability',
          ).toStrictEqual(null);
          expect(
            parseBankProposalResponse({
              kind: 'shortfall',
              mode: 'difficulty',
              levels: [{ categoryId: 'hard', count: 5, available: 0 }],
            }, choose),
            'The response has one availability representation',
          ).toStrictEqual(null);
          for (
            const malformed of [
              { ...proposal, version: { ...proposal.version, id: newerId } },
              { ...proposal, items: proposal.items.slice(1) },
              { ...proposal, items: [proposal.items[0], ...proposal.items.slice(0, -1)] },
              {
                ...proposal,
                items: proposal.items.map((item) => ({ ...item, categoryId: 'easy' })),
              },
              {
                ...proposal,
                items: [{
                  ...proposal.items[0],
                  question: { ...proposal.items[0].question, id: ids[1] },
                }, ...proposal.items.slice(1)],
              },
            ]
          ) expect(parseBankProposalResponse(malformed, choose)).toStrictEqual(null);

          expect(new Set(result.value.items.map((item) => item.question.id)).size).toStrictEqual(
            20,
          );
          if (
            !(result.value.items.every((item) =>
              ![ids[0], ids[1], ...ids.slice(35)].includes(item.question.id)
            ))
          ) {
            expect.unreachable(
              'Expected result.value.items.every((item) => ![ids[0], ids[1], ...ids.slice(35)].includes(item.quest',
            );
          }
          expect(
            (await getAssessment(ctx, assessment.id))?.targetCount,
            'Proposing does not save placements',
          ).toStrictEqual(1);
          const scarce = parseBankProposalCommand({
            kind: 'draw',
            mode: 'difficulty',
            selection,
            excludedQuestions: [],
            versionId,
            counts: [{ categoryId: 'hard', count: 6 }],
          });
          if (!scarce) expect.unreachable('Expected scarce');
          assertShortfall(await service.run(ctx, assessment.id, scarce), scarce, 'hard', 5);
          const scoped = parseBankProposalCommand({
            kind: 'inspect',
            mode: 'difficulty',
            selection:
              `scheme=${schemeId}&subject=${versionId}:life&topic=${versionId}:cells&difficulty=${versionId}:moderate`,
            excludedQuestions: [],
          });
          if (!scoped) expect.unreachable('Expected scoped');
          const narrowed = await service.run(ctx, assessment.id, scoped);
          if (!(narrowed.ok && narrowed.value.kind === 'availability')) {
            expect.unreachable("Expected narrowed.ok && narrowed.value.kind === 'availability'");
          }
          expect(narrowed.value.versions.map((v) => [v.id, v.levels.map((l) => l.available)]))
            .toStrictEqual([
              [versionId, [19]],
            ]);
          const mixed = parseBankProposalCommand({
            kind: 'inspect',
            mode: 'difficulty',
            selection:
              `scheme=${schemeId}&subject=${versionId}:life&difficulty=${newerId}:moderate`,
            excludedQuestions: [],
          });
          if (!mixed) expect.unreachable('Expected mixed');
          expect(await service.run(ctx, assessment.id, mixed)).toStrictEqual({
            ok: false,
            code: 'invalid_input',
          });
          const replacement = parseBankProposalCommand({
            kind: 'draw',
            mode: 'difficulty',
            selection,
            versionId,
            counts: [{ categoryId: 'hard', count: 1 }],
            excludedQuestions: result.value.items.map((item) => ({
              itemId: item.question.id,
              revision: item.question.latestRev,
            })),
          });
          if (!replacement) expect.unreachable('Expected replacement');
          assertShortfall(
            await service.run(ctx, assessment.id, replacement),
            replacement,
            'hard',
            0,
          );
          const exhaustedVersion = parseBankProposalCommand({
            kind: 'draw',
            mode: 'difficulty',
            selection,
            versionId,
            counts: [{ categoryId: 'hard', count: 1 }],
            excludedQuestions: ids.slice(0, 39).map((itemId) => ({ itemId, revision: 1 })),
          });
          if (!exhaustedVersion) expect.unreachable('Expected exhaustedVersion');
          assertShortfall(
            await service.run(ctx, assessment.id, exhaustedVersion),
            exhaustedVersion,
            'hard',
            0,
          );
          const replaceEasy = parseBankProposalCommand({
            kind: 'draw',
            mode: 'difficulty',
            selection,
            versionId,
            counts: [{ categoryId: 'easy', count: 1 }],
            excludedQuestions: result.value.items.map((item) => ({
              itemId: item.question.id,
              revision: item.question.latestRev,
            })),
          });
          if (!replaceEasy) expect.unreachable('Expected replaceEasy');
          const replaced = await service.run(ctx, assessment.id, replaceEasy);
          if (!(replaced.ok && replaced.value.kind === 'proposal')) {
            expect.unreachable("Expected replaced.ok && replaced.value.kind === 'proposal'");
          }
          if (!(parseBankProposalResponse(replaced.value, replaceEasy))) {
            expect.unreachable('Expected parseBankProposalResponse(replaced.value, replaceEasy)');
          }
          expect(replaced.value.items[0].categoryId).toStrictEqual('easy');
          // Availability is rechecked on a later draw; a now-archived question is never used to fill a bucket.
          await db.update(questions).set({
            lifecycleState: 'archived',
            archivedAt: new Date(),
            archivedBy: ctx.userId,
          }).where(eq(questions.id, ids[34]));
          assertShortfall(await service.run(ctx, assessment.id, scarce), scarce, 'hard', 4);
          // An already-reviewed proposal also cannot partially append when its source becomes unavailable.
          const append = {
            partId: saved.parts[0].id,
            items: result.value.items.map((entry) => ({
              itemId: entry.question.id,
              revision: entry.question.latestRev,
              proposal: null,
              placementId: crypto.randomUUID(),
            })),
          };
          expect(await appendBankSelection(ctx, assessment.id, append)).toStrictEqual({
            ok: false,
            code: 'unavailable',
          });
          expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(1);
          await db.update(questions).set({
            lifecycleState: 'active',
            archivedAt: null,
            archivedBy: null,
          }).where(eq(questions.id, ids[34]));
          const [source] = await db.select().from(questionRevisions).where(
            eq(questionRevisions.questionId, append.items[0].itemId),
          );
          const newerRevisionId = crypto.randomUUID();
          await db.insert(questionRevisions).values({
            ...source,
            id: newerRevisionId,
            revision: 2,
          });
          await db.update(questions).set({ latestRevisionId: newerRevisionId }).where(
            eq(questions.id, append.items[0].itemId),
          );
          if (!((await appendBankSelection(ctx, assessment.id, append)).ok)) {
            expect.unreachable(
              'Expected (await appendBankSelection(ctx, assessment.id, append)).ok',
            );
          }
          if (!((await appendBankSelection(ctx, assessment.id, append)).ok)) {
            expect.unreachable(
              'Expected (await appendBankSelection(ctx, assessment.id, append)).ok',
            );
          }
          const after = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(after);
          expect(after.targetCount).toStrictEqual(21);
          if (!(after.parts[0].placements.every((p) => p.snapshotRev === 1))) {
            expect.unreachable(
              'Expected after.parts[0].placements.every((p) => p.snapshotRev === 1)',
            );
          }
          await withEnrichmentWorkspace(async (other) => {
            expect(await service.run(other, assessment.id, inspect)).toStrictEqual({
              ok: false,
              code: 'not_found',
            });
          });
          expect(await service.run({ ...ctx, userId: crypto.randomUUID() }, assessment.id, inspect))
            .toStrictEqual({ ok: false, code: 'forbidden' });
          const response = await invokeHttpMethod(
            handler,
            'POST',
            makeHttpRequest(
              new Request(`http://local/api/assessments/${assessment.id}/question-proposals`, {
                ...{ duplex: 'half' },
                method: 'POST',
                body: JSON.stringify({
                  kind: 'inspect',
                  mode: 'difficulty',
                  selection,
                  excludedQuestions: [],
                }),
              }),
              { auth: ctx, params: { id: assessment.id } },
            ),
          );
          expect(response.status).toStrictEqual(200);
          if (!(parseBankProposalResponse(await response.json(), inspect))) {
            expect.unreachable(
              'Expected parseBankProposalResponse(await response.json(), inspect)',
            );
          }
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

function assertShortfall(
  result: Awaited<ReturnType<BankQuestionProposals['run']>>,
  command: NonNullable<ReturnType<typeof parseBankProposalCommand>>,
  categoryId: string,
  available: number,
) {
  if (!(result.ok && result.value.kind === 'shortfall')) {
    expect.unreachable("Expected result.ok && result.value.kind === 'shortfall'");
  }
  if (!(parseBankProposalResponse(result.value, command))) {
    expect.unreachable('Expected parseBankProposalResponse(result.value, command)');
  }
  expect(result.value.version.levels.find((level) => level.id === categoryId)?.available)
    .toStrictEqual(available);
}
