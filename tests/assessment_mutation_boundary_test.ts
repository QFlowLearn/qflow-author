import { expect, test as testCase } from 'vitest';

import { and, eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { assessments, organizationMemberships } from '../lib/db/schema.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import {
  createAssessmentDraft,
  deleteAssessment,
  getAssessment,
  saveAssessment,
} from '../lib/services/assessment_records.ts';
import { lockWorkspace } from '../lib/services/workspace_authorization.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../lib/tenants.ts';
import { listApiRoute as collectionHandlerEndpoint } from '../lib/http/routes/assessment_api/list.ts';
import { recordApiRoute as recordHandlerEndpoint } from '../lib/http/routes/assessment_api/record.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const collectionHandler = collectionHandlerEndpoint.handle;
const recordHandler = recordHandlerEndpoint.handle;

const attributes = { title: 'Authorized assessment', blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT };

testCase('assessment commands enforce current membership and tenant ownership', async () => {
  requireQaDatabaseUrl(process.env['DATABASE_URL']);
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      try {
        const created = await createAssessmentDraft(ctx);
        if (!(created._tag === 'Saved')) expect.unreachable("Expected created._tag === 'Saved'");
        expect((await getAssessment(ctx, created.id))?.title).toStrictEqual('Untitled Assessment');
        expect(await saveAssessment(ctx, { ...attributes, id: created.id })).toStrictEqual({
          _tag: 'Saved',
          id: created.id,
        });
        for (const mutation of ['removed', 'downgraded'] as const) {
          if (mutation === 'removed') {
            await db.delete(organizationMemberships).where(
              eq(organizationMemberships.userId, ctx.userId),
            );
          } else {
            await db.insert(organizationMemberships).values({
              id: crypto.randomUUID(),
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              role: 'teaching_assistant',
            });
          }
          const before = await getAssessment(ctx, created.id);
          expect(await createAssessmentDraft(ctx)).toStrictEqual({
            _tag: 'Rejected',
            code: 'forbidden',
          });
          expect(await saveAssessment(ctx, { ...attributes, id: created.id, title: 'Denied' }))
            .toStrictEqual({
              _tag: 'Rejected',
              code: 'forbidden',
            });
          expect(await deleteAssessment(ctx, created.id)).toStrictEqual({
            _tag: 'Rejected',
            code: 'forbidden',
          });
          expect(await getAssessment(ctx, created.id)).toStrictEqual(before);
          expect(
            (await db.select().from(assessments).where(eq(assessments.tenantId, ctx.tenantId)))
              .length,
          ).toStrictEqual(1);
          const deniedDelete = await invokeHttpRoute(
            recordHandler,
            makeHttpRequest(
              new Request(`http://local/api/assessments/${created.id}`, { method: 'DELETE' }),
              { auth: ctx, params: { id: created.id } },
            ),
          );
          expect(deniedDelete.status).toStrictEqual(403);
        }
        await db.update(organizationMemberships).set({ role: 'owner' }).where(
          eq(organizationMemberships.userId, ctx.userId),
        );
        expect(await createAssessmentDraft({ ...ctx, userId: SYSTEM_USER_ID })).toStrictEqual({
          _tag: 'Rejected',
          code: 'forbidden',
        });
        await withEnrichmentWorkspace(async (other) => {
          expect(await saveAssessment(other, { ...attributes, id: created.id })).toStrictEqual({
            _tag: 'Rejected',
            code: 'assessment_not_found',
          });
          expect(await deleteAssessment(other, created.id)).toStrictEqual({
            _tag: 'Rejected',
            code: 'assessment_not_found',
          });
          expect(await getAssessment(other, created.id)).toStrictEqual(null);
          expect((await getAssessment(ctx, created.id))?.title).toStrictEqual(attributes.title);
        });
        expect(await deleteAssessment(ctx, created.id)).toStrictEqual({ _tag: 'Deleted' });
        expect(await getAssessment(ctx, created.id)).toStrictEqual(null);
        expect(await deleteAssessment(ctx, created.id)).toStrictEqual({
          _tag: 'Rejected',
          code: 'assessment_not_found',
        });
      } finally {
        await db.delete(assessments).where(eq(assessments.tenantId, ctx.tenantId));
      }
    });
  } finally {
    await shutdownDb();
  }
});

testCase(
  'assessment commands wait for concurrent workspace revocation and reread membership',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        try {
          const created = await createAssessmentDraft(ctx);
          if (!(created._tag === 'Saved')) expect.unreachable("Expected created._tag === 'Saved'");
          const commands = [
            () => createAssessmentDraft(ctx),
            () => saveAssessment(ctx, { ...attributes, id: created.id, title: 'Denied change' }),
            () => deleteAssessment(ctx, created.id),
          ];
          for (const command of commands) {
            await db.update(organizationMemberships).set({ role: 'owner' }).where(
              eq(organizationMemberships.userId, ctx.userId),
            );
            const before = await getAssessment(ctx, created.id);
            const locked = Promise.withResolvers<number>();
            const release = Promise.withResolvers<void>();
            const revocation = db.transaction(async (tx) => {
              if (!(await lockWorkspace(tx, ctx.tenantId))) {
                expect.unreachable('Expected await lockWorkspace(tx, ctx.tenantId)');
              }
              await tx.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
                and(
                  eq(organizationMemberships.tenantId, ctx.tenantId),
                  eq(organizationMemberships.userId, ctx.userId),
                ),
              );
              const rows = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
              locked.resolve(rows[0].pid);
              await release.promise;
            });
            // A transaction failure must also release the test's handshake wait.
            const observedRevocation = revocation.catch((cause: unknown) => {
              locked.reject(cause);
              throw cause;
            });
            let mutation: ReturnType<typeof command> | undefined;
            let result: Awaited<ReturnType<typeof command>> | undefined;
            try {
              const lockerPid = await locked.promise;
              mutation = command();
              await waitForBlockedCommand(lockerPid);
            } finally {
              release.resolve();
              await observedRevocation;
              if (mutation) result = await mutation;
            }
            if (!result) expect.unreachable('Expected result');
            expect(result).toStrictEqual({ _tag: 'Rejected', code: 'forbidden' });
            expect(await getAssessment(ctx, created.id)).toStrictEqual(before);
            expect(
              (await db.select().from(assessments).where(eq(assessments.tenantId, ctx.tenantId)))
                .length,
            ).toStrictEqual(1);
          }
        } finally {
          await db.delete(assessments).where(eq(assessments.tenantId, ctx.tenantId));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

async function waitForBlockedCommand(lockerPid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ blocked: boolean }>(sql`
      select exists(select 1 from pg_stat_activity where ${lockerPid} = any(pg_blocking_pids(pid))) as blocked
    `);
    if (rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Assessment command did not wait for the workspace authorization lock.');
}

testCase('assessment API rejects invalid bodies and limits without writing rows', async () => {
  requireQaDatabaseUrl(process.env['DATABASE_URL']);
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      try {
        for (
          const body of [
            '{',
            'null',
            '[]',
            '1',
            '{"title":null}',
            '{"title":4}',
            '{"title":{}}',
            '{"title":"  "}',
            '{"unknown":true}',
          ]
        ) {
          const response = await requestCollection(ctx, 'POST', '', body);
          expect(response.status, body).toStrictEqual(400);
          expect(await db.select().from(assessments).where(eq(assessments.tenantId, ctx.tenantId)))
            .toStrictEqual([]);
        }
        for (const limit of ['NaN', 'abc', '1.5', 'Infinity', '-1', '0', '21', '']) {
          const response = await requestCollection(ctx, 'GET', `?limit=${limit}`);
          expect(response.status, limit).toStrictEqual(400);
          expect(await db.select().from(assessments).where(eq(assessments.tenantId, ctx.tenantId)))
            .toStrictEqual([]);
        }
        for (
          const [body, title] of [
            ['{}', 'Untitled Assessment'],
            ['{"title":"  A title  "}', 'A title'],
          ]
        ) {
          const response = await requestCollection(ctx, 'POST', '', body);
          expect(response.status).toStrictEqual(201);
          const [row] = await db.select().from(assessments).where(
            and(eq(assessments.tenantId, ctx.tenantId), eq(assessments.title, title)),
          );
          if (!row) expect.unreachable('Expected row');
        }
        for (const query of ['', '?limit=1', '?limit=20']) {
          expect((await requestCollection(ctx, 'GET', query)).status).toStrictEqual(200);
        }
      } finally {
        await db.delete(assessments).where(eq(assessments.tenantId, ctx.tenantId));
      }
    });
  } finally {
    await shutdownDb();
  }
});

function requestCollection(auth: RequestContext, method: string, query: string, body?: string) {
  return invokeHttpRoute(
    collectionHandler,
    makeHttpRequest(
      new Request(`http://local/api/assessments${query}`, {
        ...{ duplex: 'half' },
        method,
        body,
        headers: { 'content-type': 'application/json' },
      }),
      { auth },
    ),
  );
}
