import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  organizationAttempts,
  organizationItems,
  organizationRuns,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { readOrganizationReport } from '../lib/services/question_organization_report.ts';
import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';

testCase(
  'Clef migration updates saved policies and tags, preserves paid provenance, and resumes remaining work',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const receipt = {
          topicId: 'cells',
          confidence: 0.9,
          probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
          model: 'jev-1.13.0',
          inputTokens: 700,
          outputTokens: 20,
        };
        const attemptId = crypto.randomUUID();
        const migration = await _fs.readFile(
          new URL('../db/migrations/0077_clef_organization.sql', import.meta.url),
          'utf8',
        );
        const original = await db.transaction(async (tx) => {
          await tx.execute(
            sql`ALTER TABLE question_organization_setups DROP CONSTRAINT organization_classifier_kind`,
          );
          await tx.execute(
            sql`ALTER TABLE question_organization_items DROP CONSTRAINT organization_decision_kind`,
          );
          await tx.execute(
            sql`ALTER TABLE question_organization_setups DISABLE TRIGGER organization_setup_immutable`,
          );
          await tx.execute(sql`UPDATE question_organization_setups SET policy =
          jsonb_set(jsonb_set(jsonb_set(policy, '{classifier,kind}', '"jev"'::jsonb),
          '{classifier,config,modelVersion}', '"jev-1.13.0"'::jsonb),
          '{classifier,config,inputMicrosPerMillion}', '42000'::jsonb) WHERE id = ${f.setupId}`);
          await tx.execute(
            sql`ALTER TABLE question_organization_setups ENABLE TRIGGER organization_setup_immutable`,
          );
          const [setup] = await tx.select().from(organizationSetups).where(
            eq(organizationSetups.id, f.setupId),
          );
          await tx.insert(organizationSetups).values({
            ...setup,
            id: crypto.randomUUID(),
            version: 2,
            policy: {
              versionId: f.versionId,
              classifier: { kind: 'source_only' },
              filing: [],
              sourceMappings: [],
            },
          });
          await tx.update(organizationItems).set({
            state: 'received',
            decision: { kind: 'jev', receipt },
          })
            .where(eq(organizationItems.questionId, f.ids[0]));
          await tx.insert(organizationAttempts).values({
            id: attemptId,
            tenantId: f.ctx.tenantId,
            runId: f.runId,
            questionId: f.ids[0],
            reservedMicros: 1344,
            chargedMicros: 30,
            state: 'received',
            code: null,
            createdAt: organizationNow(),
          });
          await tx.update(organizationRuns).set({ reservedMicros: 30 }).where(
            eq(organizationRuns.id, f.runId),
          );
          const before = await tx.select().from(organizationSetups).where(
            eq(organizationSetups.tenantId, f.ctx.tenantId),
          );
          await tx.execute(sql.raw(migration));
          return before;
        });
        const setups = await db.select().from(organizationSetups).where(
          eq(organizationSetups.tenantId, f.ctx.tenantId),
        );
        const sourceOnly = original.find((s) => s.id !== f.setupId);
        if (!sourceOnly) expect.unreachable('Expected sourceOnly');
        expect(setups.find((s) => s.id === sourceOnly.id)).toStrictEqual(sourceOnly);
        const setup = setups.find((s) => s.id === f.setupId);
        if (!setup) expect.unreachable('Expected setup');
        expect(setup.id).toStrictEqual(f.setupId);
        const policy = await db.execute(sql`SELECT policy #>> '{classifier,kind}' AS kind,
        policy #>> '{classifier,config,modelVersion}' AS model,
        policy #>> '{classifier,config,inputMicrosPerMillion}' AS price
        FROM question_organization_setups WHERE id = ${f.setupId}`);
        expect(policy[0]).toStrictEqual({ kind: 'clef', model: 'clef', price: '240000' });
        const [attempt] = await db.select().from(organizationAttempts).where(
          eq(organizationAttempts.id, attemptId),
        );
        expect([attempt.reservedMicros, attempt.chargedMicros]).toStrictEqual([1344, 30]);
        const [item] = await db.select().from(organizationItems).where(
          eq(organizationItems.questionId, f.ids[0]),
        );
        expect(item.decision).toStrictEqual({ kind: 'clef', receipt });
        await expect(
          Promise.resolve().then(() =>
            db.update(organizationSetups).set({ policy: {} }).where(
              eq(organizationSetups.id, f.setupId),
            )
          ),
        ).rejects.toBeInstanceOf(Error);
        await expect(
          Promise.resolve().then(() =>
            db.update(organizationItems).set({ decision: { kind: 'unassigned' } }).where(
              eq(organizationItems.questionId, f.ids[0]),
            )
          ),
        ).rejects.toBeInstanceOf(Error);
        let calls = 0;
        const result = await processOrganizationStep(f.params, {
          database: db,
          now: organizationNow,
          newId: () => crypto.randomUUID(),
          provider: () =>
            fixtureClefProvider(() => {
              calls++;
              return Promise.resolve({
                ok: true,
                value: { ...receipt, model: 'clef', inputTokens: 100, outputTokens: 0 },
              });
            }),
        });
        if (!(result.ok)) expect.unreachable('Expected result.ok');
        expect(calls).toStrictEqual(2);
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        expect(run.reservedMicros).toStrictEqual(78);
        const report = await readOrganizationReport(db, f.ctx, f.runId);
        if (!(report.ok)) expect.unreachable('Expected report.ok');
        expect(report.value.topics[0]?.clef).toStrictEqual(3);
        if (!((await completeOrganizationUndoForTest(db, f.ctx, f.runId, organizationNow())).ok)) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, f.runId, organizationNow())).ok',
          );
        }
      }, { clef: true });
    } finally {
      await shutdownDb();
    }
  },
);
