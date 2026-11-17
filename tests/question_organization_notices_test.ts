import { expect, test as testCase } from 'vitest';

import { finishOrganizationNotice as finish } from './helpers/organization_notice_fixture.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { organizationMemberships } from '../lib/db/principal_schema.ts';
import { organizationNotices, organizationRuns } from '../lib/db/question_organization_schema.ts';
import {
  parseOrganizationNoticeAck,
  parseOrganizationNoticeSnapshot,
} from '../lib/organization_notices.ts';
import {
  acknowledgeOrganizationNotice,
  readOrganizationNotices,
} from '../lib/services/question_organization_notices.ts';
import { settleOrganizationAfterWorkflowTerminal } from '../lib/services/question_organization_settlement.ts';
import { resumeOrganizationRun } from '../lib/services/question_organization_resume.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';

const empty = { ok: true, value: { total: 0, notices: [] } } as const;

testCase(
  'notice contracts reject malformed commands, unbounded results and duplicate executions',
  () => {
    const ack = { runId: crypto.randomUUID(), executionId: crypto.randomUUID() };
    const notice = { ...ack, collection: 'Biology', state: 'completed' } as const;
    expect(parseOrganizationNoticeAck(ack)).toStrictEqual(ack);
    for (const invalid of [null, [], { ...ack, extra: true }, { ...ack, runId: '../' }]) {
      expect(parseOrganizationNoticeAck(invalid)).toStrictEqual(null);
    }
    expect(parseOrganizationNoticeSnapshot({ total: 1, notices: [notice] })).toStrictEqual({
      total: 1,
      notices: [notice],
    });
    for (
      const invalid of [
        { total: Infinity, notices: [] },
        { total: 1, notices: [] },
        { total: 0, notices: [notice] },
        { total: 2, notices: [notice, notice] },
        { total: 6, notices: Array(6).fill(notice) },
        { total: 1, notices: [{ ...notice, state: 'queued' }] },
        { total: 1, notices: [{ ...notice, collection: 'x'.repeat(2001) }] },
        { total: 1, notices: [notice], extra: true },
      ]
    ) expect(parseOrganizationNoticeSnapshot(invalid)).toStrictEqual(null);
  },
);

testCase(
  'completion notices persist until acknowledged, isolate actor and tenant, and recheck authority',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(empty);
        await finish(f.params);
        await finish(f.params);
        const ack = { runId: f.runId, executionId: f.params.workflowExecutionId };
        const expected = {
          ok: true,
          value: {
            total: 1,
            notices: [{ ...ack, collection: 'Collection 0', state: 'completed' }],
          },
        } as const;
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(expected);
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(expected);
        expect(
          (await db.select().from(organizationNotices).where(
            eq(organizationNotices.runId, f.runId),
          ))
            .length,
        ).toStrictEqual(1);
        const before = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        await withEnrichmentWorkspace(async (other) => {
          expect(await readOrganizationNotices(db, other)).toStrictEqual(empty);
          expect(await acknowledgeOrganizationNotice(db, other, ack)).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
          await db.insert(organizationMemberships).values({
            id: crypto.randomUUID(),
            tenantId: f.ctx.tenantId,
            userId: other.userId,
            role: 'instructor',
          });
          const colleague = { ...other, tenantId: f.ctx.tenantId };
          expect(await readOrganizationNotices(db, colleague)).toStrictEqual(empty);
          expect(await acknowledgeOrganizationNotice(db, colleague, ack)).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
        });
        expect(await acknowledgeOrganizationNotice(db, f.ctx, ack)).toStrictEqual({
          ok: true,
          value: true,
        });
        expect(await acknowledgeOrganizationNotice(db, f.ctx, ack)).toStrictEqual({
          ok: true,
          value: true,
        });
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(empty);
        expect(await db.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId)))
          .toStrictEqual(before);
        await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
          eq(organizationMemberships.userId, f.ctx.userId),
        );
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual({
          ok: false,
          code: 'forbidden',
        });
        expect(await acknowledgeOrganizationNotice(db, f.ctx, ack)).toStrictEqual({
          ok: false,
          code: 'forbidden',
        });
      }, { difficulty: 'none' });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'workflow failure commits its notice atomically; resume fences old acknowledgements and undo hides completion',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        const terminal = {
          jobId: f.runId,
          tenantId: f.ctx.tenantId,
          executionId: f.params.workflowExecutionId,
        };
        await expect(
          Promise.resolve().then(() =>
            db.transaction(async (tx) => {
              await settleOrganizationAfterWorkflowTerminal(tx, terminal);
              throw new Error('Roll back both outcome and notice');
            })
          ),
        ).rejects.toBeInstanceOf(Error);
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(empty);
        expect(
          (await db.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId)))[0]
            .state,
        ).toStrictEqual('queued');
        await db.transaction((tx) => settleOrganizationAfterWorkflowTerminal(tx, terminal));
        await db.transaction((tx) => settleOrganizationAfterWorkflowTerminal(tx, terminal));
        const failed = await readOrganizationNotices(db, f.ctx);
        if (!(failed.ok)) expect.unreachable('Expected failed.ok');
        expect([failed.value.total, failed.value.notices[0].state]).toStrictEqual([1, 'failed']);
        if (
          !((await resumeOrganizationRun(
            db,
            f.ctx,
            f.runId,
            terminal.executionId,
            organizationNow(),
          ))
            .ok)
        ) {
          expect.unreachable(
            'Expected (await resumeOrganizationRun(db, f.ctx, f.runId, terminal.executionId, organizationNow()))',
          );
        }
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(empty);
        expect(
          await acknowledgeOrganizationNotice(db, f.ctx, {
            runId: f.runId,
            executionId: terminal.executionId,
          }),
        ).toStrictEqual({ ok: false, code: 'conflict' });
        const [run] = await db.select().from(organizationRuns).where(
          eq(organizationRuns.id, f.runId),
        );
        await finish({ jobId: run.id, workflowExecutionId: run.executionId });
        const completed = await readOrganizationNotices(db, f.ctx);
        if (!(completed.ok)) expect.unreachable('Expected completed.ok');
        expect(completed.value.total).toStrictEqual(1);
        expect(completed.value.notices[0].executionId).toStrictEqual(run.executionId);
        if (!((await completeOrganizationUndoForTest(db, f.ctx, f.runId, organizationNow())).ok)) {
          expect.unreachable(
            'Expected (await completeOrganizationUndoForTest(db, f.ctx, f.runId, organizationNow())).ok',
          );
        }
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(empty);
      }, { difficulty: 'none' });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'preview and cancellation stay quiet; large unread history is bounded and dismissal reveals the next result',
  async () => {
    try {
      await withOrganizationWorkspace(async (f) => {
        if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
          expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
        }
        const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
        async function queue(mode: 'preview' | 'apply') {
          const queued = await workspace.queue(f.ctx, {
            id: crypto.randomUUID(),
            setupId: f.setupId,
            mode,
          });
          if (!(queued.ok)) expect.unreachable('Expected queued.ok');
          const run = await workspace.run(f.ctx, queued.value);
          if (!(run.ok)) expect.unreachable('Expected run.ok');
          await finish({ jobId: queued.value, workflowExecutionId: run.value.executionId });
        }
        await queue('preview');
        expect(await readOrganizationNotices(db, f.ctx)).toStrictEqual(empty);
        for (let i = 0; i < 6; i++) await queue('apply');
        const list = await readOrganizationNotices(db, f.ctx);
        if (!(list.ok)) expect.unreachable('Expected list.ok');
        expect([list.value.total, list.value.notices.length]).toStrictEqual([6, 5]);
        const notice = list.value.notices[0];
        if (!((await acknowledgeOrganizationNotice(db, f.ctx, notice)).ok)) {
          expect.unreachable(
            'Expected (await acknowledgeOrganizationNotice(db, f.ctx, notice)).ok',
          );
        }
        const after = await readOrganizationNotices(db, f.ctx);
        if (!(after.ok)) expect.unreachable('Expected after.ok');
        expect([after.value.total, after.value.notices.length]).toStrictEqual([5, 5]);
        if (after.value.notices.some((n) => n.executionId === notice.executionId)) {
          expect.unreachable(
            'Expected !after.value.notices.some((n) => n.executionId === notice.executionId)',
          );
        }
      }, { count: 1, difficulty: 'none' });
    } finally {
      await shutdownDb();
    }
  },
);
