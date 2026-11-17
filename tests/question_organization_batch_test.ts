import { expect, test as testCase } from 'vitest';

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import {
  createClefOrganizationProvider,
  planClefOrganizationBatches,
} from '../lib/ai/clef_organization_provider.ts';
import { isEnrichmentRecord } from '../lib/ai/bank_enrichment_config.ts';
import { prepareEnrichmentQuestion } from '../lib/services/bank_enrichment_input.ts';
import {
  organizationAttempts,
  organizationItems,
  organizationRuns,
} from '../lib/db/question_organization_schema.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import {
  organizationConfig,
  organizationNow,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';

function response(input: Record<string, unknown>, tokens = 701) {
  if (!(isEnrichmentRecord(input.questions))) {
    expect.unreachable('Expected isEnrichmentRecord(input.questions)');
  }
  return {
    model: 'clef',
    answers: Object.fromEntries(
      Object.keys(input.questions).map((id) => [id, {
        type: 'choice',
        choice: 'cells',
        confidence: 0.99,
        probabilities: { cells: 0.99, energy: 0.01, __no_match__: 0 },
      }]),
    ),
    usage: { input_tokens: tokens, output_tokens: 31 },
  };
}
function question(size = 10) {
  const result = prepareEnrichmentQuestion(crypto.randomUUID(), crypto.randomUUID(), {
    type: 'single_select',
    title: 'Cells',
    promptHtml: `<p>${'é'.repeat(size)}</p>`,
    choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
    correctId: 'a',
  });
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  return result.value;
}
testCase(
  'Clef batches isolate item instructions, enforce count and byte bounds, and allocate exact request totals',
  async () => {
    const definition = enrichmentDefinitionFixture();
    const items = Array.from({ length: 23 }, () => question());
    expect(planClefOrganizationBatches(items, definition, []).map((b) => b.length)).toStrictEqual([
      10,
      10,
      3,
    ]);
    const large = Array.from({ length: 3 }, () => question(7900));
    expect(planClefOrganizationBatches(large, definition, []).map((b) => b.length)).toStrictEqual([
      1,
      1,
      1,
    ]);
    let calls = 0;
    const provider = createClefOrganizationProvider({
      run(_model, input) {
        calls++;
        if (!(isEnrichmentRecord(input.questions))) {
          expect.unreachable('Expected isEnrichmentRecord(input.questions)');
        }
        for (const [id, value] of Object.entries(input.questions)) {
          if (!(isEnrichmentRecord(value) && isEnrichmentRecord(value.instructions))) {
            expect.unreachable(
              'Expected isEnrichmentRecord(value) && isEnrichmentRecord(value.instructions)',
            );
          }
          if (!(isEnrichmentRecord(value.instructions.question))) {
            expect.unreachable('Expected isEnrichmentRecord(value.instructions.question)');
          }
          expect(value.instructions.question.questionId).toStrictEqual(id);
          expect(value.instructions.question.correctId).toStrictEqual(
            items.find((q) => q.questionId === id)?.correctId,
          );
        }
        return Promise.resolve(response(input));
      },
    }, organizationConfig);
    const result = await provider(items.slice(0, 10), definition, [], {
      signal: AbortSignal.timeout(1000),
    });
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(result.value.map((d) => d.questionId)).toStrictEqual(
      items.slice(0, 10).map((q) => q.questionId),
    );
    expect(result.value.reduce((sum, d) => sum + d.receipt.inputTokens, 0)).toStrictEqual(701);
    expect(result.value.reduce((sum, d) => sum + d.receipt.outputTokens, 0)).toStrictEqual(31);
    expect(result.value.reduce((sum, d) => sum + d.chargedMicros, 0)).toStrictEqual(169);
    expect(await provider(large.slice(0, 2), definition, [], { signal: AbortSignal.timeout(1000) }))
      .toStrictEqual({ ok: false, code: 'input_too_large' });
    expect(calls).toStrictEqual(1);
    for (const invalid of ['missing', 'extra', 'model', 'probabilities'] as const) {
      const bad = createClefOrganizationProvider({
        run(_model, input) {
          const raw = response(input);
          if (invalid === 'missing') delete raw.answers[items[0].questionId];
          if (invalid === 'extra') {
            raw.answers.unexpected = raw.answers[items[0].questionId];
          }
          if (invalid === 'model') raw.model = 'clef-other';
          if (invalid === 'probabilities') {
            raw.answers[items[0].questionId].probabilities.cells = 2;
          }
          return Promise.resolve(raw);
        },
      }, organizationConfig);
      expect(await bad(items.slice(0, 2), definition, [], { signal: AbortSignal.timeout(1000) }))
        .toStrictEqual({ ok: false, code: 'invalid_response' });
    }
  },
);

testCase(
  'a batched response commits every receipt and exact charge before an apply failure, then replays without inference',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const services = {
        database: db,
        now: organizationNow,
        newId: () => crypto.randomUUID(),
        provider: (config: typeof organizationConfig) =>
          createClefOrganizationProvider({
            run(_model, input) {
              return Promise.resolve(response(input));
            },
          }, config),
      };
      await db.execute(
        sql`CREATE FUNCTION fail_batched_apply() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'applied' THEN RAISE EXCEPTION 'injected apply crash'; END IF; RETURN NEW; END $$`,
      );
      await db.execute(
        sql`CREATE TRIGGER fail_batched_apply BEFORE UPDATE ON question_organization_items FOR EACH ROW EXECUTE FUNCTION fail_batched_apply()`,
      );
      try {
        expect(await processOrganizationStep(f.params, services)).toStrictEqual({
          ok: false,
          code: 'storage_failed',
        });
      } finally {
        await db.execute(sql`DROP TRIGGER fail_batched_apply ON question_organization_items`);
        await db.execute(sql`DROP FUNCTION fail_batched_apply()`);
      }
      let rows = await db.select().from(organizationItems).where(
        eq(organizationItems.runId, f.runId),
      );
      expect(rows.length).toStrictEqual(20);
      if (!(rows.every((r) => r.state === 'received' && r.decision !== null))) {
        expect.unreachable(
          "Expected rows.every((r) => r.state === 'received' && r.decision !== null)",
        );
      }
      const attempts = await db.select().from(organizationAttempts).where(
        eq(organizationAttempts.runId, f.runId),
      );
      expect(attempts.length).toStrictEqual(20);
      expect(attempts.reduce((sum, a) => sum + (a.chargedMicros ?? 0), 0)).toStrictEqual(338);
      expect(
        (await db.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId)))[0]
          .reservedMicros,
      ).toStrictEqual(338);
      await db.update(organizationItems).set({ leaseExpiresAt: new Date(0) }).where(
        eq(organizationItems.runId, f.runId),
      );
      expect(
        await processOrganizationStep(f.params, {
          ...services,
          provider: () => {
            throw new Error(
              'A persisted receipt must replay without an available inference provider.',
            );
          },
        }),
      ).toStrictEqual({
        ok: true,
        value: { state: 'completed', completed: 20 },
      });
      rows = await db.select().from(organizationItems).where(eq(organizationItems.runId, f.runId));
      if (!(rows.every((r) => r.state === 'applied'))) {
        expect.unreachable("Expected rows.every((r) => r.state === 'applied')");
      }
      expect(
        await db.select().from(organizationAttempts).where(
          eq(organizationAttempts.runId, f.runId),
        ).orderBy(organizationAttempts.id),
      ).toStrictEqual([...attempts].sort((a, b) => a.id.localeCompare(b.id)));
      expect(
        (await db.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId)))[0]
          .reservedMicros,
      ).toStrictEqual(338);
    }, { clef: true, count: 20 });
  },
);

testCase(
  'a fast Clef batch checkpoints before a slow sibling and cancellation fences all late answers',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const delayed = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      let calls = 0;
      const processing = processOrganizationStep(f.params, {
        database: db,
        now: organizationNow,
        newId: () => crypto.randomUUID(),
        provider: (config) =>
          createClefOrganizationProvider({
            async run(_model, input) {
              calls++;
              if (calls === 2) {
                started.resolve();
                await delayed.promise;
              }
              return response(input);
            },
          }, config),
      });
      try {
        await started.promise;
        let saved = false;
        for (let check = 0; check < 100; check++) {
          const rows = await db.select().from(organizationItems).where(
            and(eq(organizationItems.runId, f.runId), eq(organizationItems.state, 'applied')),
          );
          if (rows.length === 10) {
            saved = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!saved) {
          expect.unreachable('A completed batch must persist before the other request returns');
        }
        if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
          expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
        }
      } finally {
        delayed.resolve();
        await processing;
      }
      const rows = await db.select().from(organizationItems).where(
        eq(organizationItems.runId, f.runId),
      );
      expect(rows.filter((r) => r.decision !== null).length).toStrictEqual(10);
      expect(rows.filter((r) => r.state === 'cancelled').length).toStrictEqual(10);
    }, { clef: true, count: 20 });
  },
);
