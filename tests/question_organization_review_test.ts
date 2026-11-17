import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { organizationMemberships } from '../lib/db/principal_schema.ts';
import {
  organizationAttempts,
  organizationItems,
  organizationRuns,
} from '../lib/db/question_organization_schema.ts';
import { enrichmentChanges } from '../lib/db/bank_enrichment_schema.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { resumeOrganizationRun } from '../lib/services/question_organization_resume.ts';
import { readOrganizationNotices } from '../lib/services/question_organization_notices.ts';
import {
  type OrganizationWorkerServices,
  processOrganizationStep,
} from '../lib/services/question_organization_processor.ts';
import { fixtureClefProvider } from './helpers/fixture_clef_provider.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  organizationNow as now,
  withOrganizationWorkspace,
} from './helpers/organization_workspace.ts';

const base: OrganizationWorkerServices = {
  database: db,
  now,
  newId: () => crypto.randomUUID(),
  provider: () =>
    fixtureClefProvider(() =>
      Promise.resolve({
        ok: true,
        value: {
          topicId: 'cells',
          confidence: 0.9,
          probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
          model: 'clef',
          inputTokens: 100,
          outputTokens: 20,
        },
      })
    ),
};

testCase(
  'a colleague resumes under their own current authority while original authorship stays intact',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      await withEnrichmentWorkspace(async (other) => {
        const colleague = { ...other, tenantId: f.ctx.tenantId };
        await db.insert(organizationMemberships).values({
          id: crypto.randomUUID(),
          tenantId: f.ctx.tenantId,
          userId: other.userId,
          role: 'owner',
        });
        try {
          if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
            expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
          }
          await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
            eq(organizationMemberships.userId, f.ctx.userId),
          );
          if (
            !((await resumeOrganizationRun(
              db,
              colleague,
              f.runId,
              f.params.workflowExecutionId,
              now(),
            ))
              .ok)
          ) {
            expect.unreachable(
              'Expected (await resumeOrganizationRun( db, colleague, f.runId, f.params.workflowExecutionId, now(),',
            );
          }
          const [run] = await db.select().from(organizationRuns).where(
            eq(organizationRuns.id, f.runId),
          );
          expect(run.createdBy).toStrictEqual(f.ctx.userId);
          expect(run.executionBy).toStrictEqual(colleague.userId);
          await expect(
            Promise.resolve().then(() =>
              db.update(organizationRuns).set({ executionBy: f.ctx.userId }).where(
                eq(organizationRuns.id, f.runId),
              )
            ),
          ).rejects.toBeInstanceOf(Error);
          const params = { jobId: f.runId, workflowExecutionId: run.executionId };
          expect(await processOrganizationStep(params, base)).toStrictEqual({
            ok: true,
            value: { state: 'more', completed: 20 },
          });
          const changes = await db.select().from(enrichmentChanges).where(
            eq(enrichmentChanges.operationId, f.runId),
          );
          if (!(changes.length > 0 && changes.every((c) => c.createdBy === colleague.userId))) {
            expect.unreachable(
              'Expected changes.length > 0 && changes.every((c) => c.createdBy === colleague.userId)',
            );
          }
          await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
            eq(organizationMemberships.userId, colleague.userId),
          );
          expect(await processOrganizationStep(params, base)).toStrictEqual({
            ok: false,
            code: 'forbidden',
          });
          await db.update(organizationMemberships).set({ role: 'owner' }).where(
            eq(organizationMemberships.userId, colleague.userId),
          );
          expect(await processOrganizationStep(params, base)).toStrictEqual({
            ok: true,
            value: { state: 'completed', completed: 21 },
          });
          const notices = await readOrganizationNotices(db, colleague);
          if (!(notices.ok)) expect.unreachable('Expected notices.ok');
          expect(notices.value.notices.map((n) => n.runId)).toStrictEqual([f.runId]);
          await db.update(organizationMemberships).set({ role: 'owner' }).where(
            eq(organizationMemberships.userId, f.ctx.userId),
          );
          const originalNotices = await readOrganizationNotices(db, f.ctx);
          if (!(originalNotices.ok)) expect.unreachable('Expected originalNotices.ok');
          expect(originalNotices.value.notices).toStrictEqual([]);
        } finally {
          await db.delete(organizationMemberships).where(
            eq(organizationMemberships.userId, other.userId),
          );
        }
      });
    }, { clef: true, count: 21 });
  },
);

testCase(
  'temporary reservations defer affordable questions instead of permanently failing them',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      for (let step = 0; step < 3; step++) await processOrganizationStep(f.params, base);
      const rows = await db.select().from(organizationItems).where(
        eq(organizationItems.runId, f.runId),
      );
      expect(rows.map((r) => r.state)).toStrictEqual(['applied', 'applied', 'applied']);
      const [run] = await db.select().from(organizationRuns).where(
        eq(organizationRuns.id, f.runId),
      );
      expect(run.reservedMicros).toStrictEqual(72);
    }, { clef: true, count: 3, budgetMicros: 8000 });
  },
);

testCase('a local input rejection releases its unused reservation', async () => {
  await withOrganizationWorkspace(async (f) => {
    expect(
      await processOrganizationStep(f.params, {
        ...base,
        provider: () => () => Promise.resolve({ ok: false, code: 'input_too_large' }),
      }),
    ).toStrictEqual({ ok: true, value: { state: 'failed', completed: 1 } });
    const [run] = await db.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId));
    const [attempt] = await db.select().from(organizationAttempts).where(
      eq(organizationAttempts.runId, f.runId),
    );
    expect(run.reservedMicros).toStrictEqual(0);
    expect([attempt.state, attempt.chargedMicros, attempt.code]).toStrictEqual([
      'skipped',
      0,
      'input_too_large',
    ]);
  }, { clef: true, count: 1 });
});
