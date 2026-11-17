import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getDatabaseUrl } from '../lib/config.ts';
import { db, shutdownDb } from '../lib/db.ts';
import { enrichmentRuns } from '../lib/db/bank_enrichment_job_schema.ts';
import { enrichmentPreviews } from '../lib/db/bank_enrichment_task_schema.ts';
import { organizationMemberships } from '../lib/db/principal_schema.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { BankEnrichmentMutations } from '../lib/services/bank_enrichment_mutation_store.ts';
import { bankOrganizationStatusPageRoute as handlerEndpoint } from '../lib/http/routes/bank_pages/organization_status.ts';
import { enrichmentConfigFixture } from './helpers/enrichment_provider_fixture.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { prepareEnrichmentRunFixture } from './helpers/enrichment_workflow_fixture.ts';
import { finishMutation } from './helpers/enrichment_mutation_fixture.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';

const handler = handlerEndpoint.handle;

testCase(
  'polling reads the update token for every enrichment job kind in one statement',
  async () => {
    if (!(/test/.test(new URL(getDatabaseUrl()).pathname))) {
      expect.unreachable('Use an isolated test database.');
    }
    let statements = 0;
    const client = postgres(getDatabaseUrl(), {
      max: 1,
      prepare: false,
      fetch_types: false,
      debug: () => statements++,
    });
    const read = new BankEnrichmentJobRead(drizzle(client), () => new Date());
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepareEnrichmentRunFixture(ctx, 2);
        const previewId = crypto.randomUUID(), correctionId = crypto.randomUUID();
        if (
          !((await run.jobs.queuePreview(ctx, previewId, run.snapshotId, crypto.randomUUID(), {
            baseVersionId: null,
            seed: crypto.randomUUID(),
            audience: 'Grade 6 science',
            definition: null,
          }, enrichmentConfigFixture)).ok)
        ) {
          expect.unreachable(
            'Expected (await run.jobs.queuePreview(ctx, previewId, run.snapshotId, crypto.randomUUID(), { baseVe',
          );
        }
        const mutations = new BankEnrichmentMutations(db, () => new Date());
        if (
          !((await mutations.correct(ctx, correctionId, {
            snapshotId: run.snapshotId,
            versionId: run.versionId,
            values: {
              subject: null,
              topic: null,
              difficulty: { state: 'assigned', valueIds: ['hard'] },
            },
          })).ok)
        ) {
          expect.unreachable(
            'Expected (await mutations.correct(ctx, correctionId, { snapshotId: run.snapshotId, versionId: run.v',
          );
        }
        const correctionExecutionId = crypto.randomUUID();
        if (!((await run.jobs.queueMutation(ctx, correctionId, correctionExecutionId)).ok)) {
          expect.unreachable(
            'Expected (await run.jobs.queueMutation(ctx, correctionId, correctionExecutionId)).ok',
          );
        }
        await finishMutation(correctionId, correctionExecutionId);
        const undoId = crypto.randomUUID();
        if (!((await mutations.undo(ctx, undoId, correctionId)).ok)) {
          expect.unreachable('Expected (await mutations.undo(ctx, undoId, correctionId)).ok');
        }
        if (!((await run.jobs.queueMutation(ctx, undoId, crypto.randomUUID())).ok)) {
          expect.unreachable(
            'Expected (await run.jobs.queueMutation(ctx, undoId, crypto.randomUUID())).ok',
          );
        }
        const detail = new BankEnrichmentJobRead(db, () => new Date());
        for (const id of [previewId, run.runId, correctionId, undoId]) {
          const job = await detail.get(ctx, id);
          if (!(job.ok)) expect.unreachable('Expected job.ok');
          statements = 0;
          const status = await read.status(ctx, id);
          expect(status).toStrictEqual({ ok: true, value: { updatedAt: job.value.updatedAt } });
          expect(statements).toStrictEqual(1);
          const response = await invokeHttpMethod(
            handler,
            'GET',
            makeHttpRequest(
              new Request(`http://localhost/items/organize/${id}/status`),
              { auth: ctx, params: { id } },
            ),
          );
          expect(response.status).toStrictEqual(200);
          expect(response.headers.get('cache-control')).toStrictEqual('no-store');
          expect(await response.json()).toStrictEqual({ updatedAt: job.value.updatedAt });
        }
        const previewUpdate = new Date('2026-10-05T14:01:00Z');
        const runUpdate = new Date('2026-10-05T14:02:00Z');
        await db.update(enrichmentPreviews).set({ updatedAt: previewUpdate }).where(
          eq(enrichmentPreviews.id, previewId),
        );
        await db.update(enrichmentRuns).set({ updatedAt: runUpdate }).where(
          eq(enrichmentRuns.id, run.runId),
        );
        expect(await read.status(ctx, previewId)).toStrictEqual({
          ok: true,
          value: { updatedAt: previewUpdate.toISOString() },
        });
        expect(await read.status(ctx, run.runId)).toStrictEqual({
          ok: true,
          value: { updatedAt: runUpdate.toISOString() },
        });
        statements = 0;
        expect(await read.status(ctx, 'invalid')).toStrictEqual({
          ok: false,
          code: 'invalid_input',
        });
        expect(statements).toStrictEqual(0);
        expect(await read.status(ctx, crypto.randomUUID())).toStrictEqual({
          ok: false,
          code: 'not_found',
        });
        await withEnrichmentWorkspace(async (other) => {
          expect(await read.status(other, run.runId)).toStrictEqual({
            ok: false,
            code: 'not_found',
          });
          expect(await read.status({ ...ctx, userId: other.userId }, run.runId)).toStrictEqual({
            ok: false,
            code: 'forbidden',
          });
        });
        await db.delete(organizationMemberships).where(
          eq(organizationMemberships.userId, ctx.userId),
        );
        const forbidden = await invokeHttpMethod(
          handler,
          'GET',
          makeHttpRequest(
            new Request(`http://localhost/items/organize/${run.runId}/status`),
            { auth: ctx, params: { id: run.runId } },
          ),
        );
        expect(forbidden.status).toStrictEqual(403);
        expect(await forbidden.json()).toStrictEqual({ error: 'unavailable' });
      });
    } finally {
      await client.end();
      await shutdownDb();
    }
  },
);
