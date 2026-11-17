import { expect, test as testCase } from 'vitest';

import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';

import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { organizationItems, organizationRuns } from '../lib/db/question_organization_schema.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import {
  parsePreviewTeachingCommand,
  teachOrganizationPreview,
} from '../lib/services/question_organization_preview_teaching.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';

testCase(
  'a 120-question collection freezes a source-balanced 100-question pool and exposes twenty ranked correctable results',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const rare = f.ids.at(-1);
      if (!rare) expect.unreachable('Expected rare');
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const command = { id: crypto.randomUUID(), setupId: f.setupId, mode: 'preview' as const };
      const queued = await workspace.queue(f.ctx, command);
      if (!(queued.ok)) expect.unreachable('Expected queued.ok');
      expect(await workspace.queue(f.ctx, command)).toStrictEqual(queued);
      const pool = await db.select().from(organizationItems).where(
        eq(organizationItems.runId, queued.value),
      ).orderBy(organizationItems.questionId);
      expect(pool.length).toStrictEqual(100);
      if (!(pool.some((r) => r.questionId === rare))) {
        expect.unreachable('A rare source must survive pool selection');
      }
      const uncertain = new Set(
        pool.filter((r) => r.questionId !== rare).slice(0, 12).map((r) => r.questionId),
      );
      const [run] = await db.select().from(organizationRuns).where(
        eq(organizationRuns.id, queued.value),
      );
      let calls = 0;
      for (let step = 0; step < 30; step++) {
        const result = await processOrganizationStep({
          jobId: run.id,
          workflowExecutionId: run.executionId,
        }, {
          database: db,
          now: organizationNow,
          newId: () => crypto.randomUUID(),
          provider: () =>
            fixtureClefProvider((question) => {
              calls++;
              const ambiguous = uncertain.has(question.questionId),
                energy = question.questionId === rare;
              return Promise.resolve({
                ok: true,
                value: {
                  topicId: energy ? 'energy' : 'cells',
                  confidence: 0.99,
                  probabilities: ambiguous ? { cells: 0.5, energy: 0.5, __no_match__: 0 } : {
                    cells: energy ? 0.01 : 0.99,
                    energy: energy ? 0.99 : 0.01,
                    __no_match__: 0,
                  },
                  model: 'clef',
                  inputTokens: 700,
                  outputTokens: 20,
                },
              });
            }),
        });
        if (!(result.ok)) expect.unreachable('Expected result.ok');
        if (result.value.state === 'completed') break;
        expect(result.value.state).toStrictEqual('more');
        if (!(step < 29)) expect.unreachable('Expected step < 29');
      }
      expect(calls).toStrictEqual(100);
      const view = await workspace.run(f.ctx, run.id);
      if (!(view.ok)) expect.unreachable('Expected view.ok');
      expect(view.value.sample.length).toStrictEqual(20);
      expect(view.value.counts.reduce((sum, c) => sum + c.count, 0)).toStrictEqual(100);
      expect(view.value.sample.filter((s) => s.sampleReason === 'uncertain').length).toStrictEqual(
        10,
      );
      if (
        !(view.value.sample.filter((s) => s.sampleReason === 'uncertain').every((s) =>
          uncertain.has(s.questionId)
        ))
      ) {
        expect.unreachable(
          "Expected view.value.sample.filter((s) => s.sampleReason === 'uncertain').every((s) => uncertain.has",
        );
      }
      if (
        !(view.value.sample.some((s) =>
          s.questionId === rare && s.sampleReason === 'coverage' && s.topic === 'Energy'
        ))
      ) {
        expect.unreachable(
          "Expected view.value.sample.some((s) => s.questionId === rare && s.sampleReason === 'coverage' && s.",
        );
      }
      expect(
        (await db.select().from(enrichmentChanges).where(
          eq(enrichmentChanges.tenantId, f.ctx.tenantId),
        )).length,
      ).toStrictEqual(0);
      const reread = await workspace.run(f.ctx, run.id);
      if (!(reread.ok)) expect.unreachable('Expected reread.ok');
      expect(reread.value.sample).toStrictEqual(view.value.sample);
      const hidden = pool.find((r) =>
        !view.value.sample.some((s) => s.questionId === r.questionId)
      );
      if (!hidden) expect.unreachable('Expected hidden');
      const invalidLesson = parsePreviewTeachingCommand({
        operationId: crypto.randomUUID(),
        corrections: [{
          questionId: hidden.questionId,
          revisionId: hidden.revisionId,
          topicId: 'energy',
        }],
      });
      if (!invalidLesson) expect.unreachable('Expected invalidLesson');
      expect(await teachOrganizationPreview(db, f.ctx, run.id, invalidLesson, organizationNow()))
        .toStrictEqual({ ok: false, code: 'invalid_input' });
      const shown = view.value.sample[0];
      const lesson = parsePreviewTeachingCommand({
        operationId: crypto.randomUUID(),
        corrections: [{
          questionId: shown.questionId,
          revisionId: shown.revisionId,
          topicId: 'energy',
        }],
      });
      if (!lesson) expect.unreachable('Expected lesson');
      const taught = await teachOrganizationPreview(db, f.ctx, run.id, lesson, organizationNow());
      if (!(taught.ok)) expect.unreachable('Expected taught.ok');
      const next = await db.select({ id: organizationItems.questionId }).from(organizationItems)
        .where(
          and(
            eq(organizationItems.runId, taught.value),
            eq(organizationItems.tenantId, f.ctx.tenantId),
          ),
        );
      expect(next.map((r) => r.id).sort()).toStrictEqual(pool.map((r) => r.questionId).sort());
      expect(await teachOrganizationPreview(db, f.ctx, run.id, lesson, organizationNow()))
        .toStrictEqual(taught);
    }, {
      clef: true,
      activation: 'disabled',
      difficulty: 'none',
      count: 120,
      sourceSections: Array.from({ length: 120 }, (_, index) => index === 119 ? 'rare' : 'main'),
    });
  },
);
