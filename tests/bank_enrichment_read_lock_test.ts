import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getDatabaseUrl } from '../lib/config.ts';
import { db, shutdownDb } from '../lib/db.ts';
import { organizationMemberships } from '../lib/db/principal_schema.ts';
import { organizationRuns } from '../lib/db/question_organization_schema.ts';
import { authorizeEnrichment } from '../lib/services/bank_enrichment_access.ts';
import { BankEnrichmentBrowse } from '../lib/services/bank_enrichment_browse.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { BankEnrichmentSampler } from '../lib/services/bank_enrichment_sample.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { BankEnrichmentUsage } from '../lib/services/bank_enrichment_usage.ts';
import { parseQuestionBankQuery } from '../lib/services/question_bank_query.ts';
import { lockWorkspace } from '../lib/services/workspace_authorization.ts';
import { readOrganizationNotices } from '../lib/services/question_organization_notices.ts';
import { readOrganizationReport } from '../lib/services/question_organization_report.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { prepareEnrichmentRunFixture } from './helpers/enrichment_workflow_fixture.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';

testCase(
  'enrichment reads proceed during a workspace lock while mutations still wait',
  async () => {
    if (!(/test/.test(new URL(getDatabaseUrl()).pathname))) {
      expect.unreachable('Use an isolated test database.');
    }
    const client = postgres(getDatabaseUrl(), {
      max: 1,
      prepare: false,
      fetch_types: false,
      connection: { lock_timeout: 250, statement_timeout: 5000 },
    });
    const database = drizzle(client), now = () => new Date();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepareEnrichmentRunFixture(ctx, 2);
        const browse = new BankEnrichmentBrowse(database);
        const read = new BankEnrichmentJobRead(database, now);
        const query = parseQuestionBankQuery(new URLSearchParams(`scheme=${run.schemeId}`));
        await db.transaction(async (writer) => {
          if (!(await lockWorkspace(writer, ctx.tenantId))) {
            expect.unreachable('Expected await lockWorkspace(writer, ctx.tenantId)');
          }
          const page = await browse.page(ctx, query, { locale: 'en-US' });
          if (!(page.ok && page.value.kind === 'questions')) {
            expect.unreachable("Expected page.ok && page.value.kind === 'questions'");
          }
          expect(page.value.bank.total).toStrictEqual(2);
          const view = await browse.read(ctx, query, page.value.bank.items.map((item) => item.id));
          if (!(view.ok && view.value.selection)) {
            expect.unreachable('Expected view.ok && view.value.selection');
          }
          expect(view.value.selection.facets.subject.pending).toStrictEqual(2);
          const job = await read.get(ctx, run.runId);
          if (!(job.ok && job.value.kind === 'classify')) {
            expect.unreachable("Expected job.ok && job.value.kind === 'classify'");
          }
          expect(job.value.progress.total).toStrictEqual(2);
          expect(await read.status(ctx, run.runId)).toStrictEqual({
            ok: true,
            value: { updatedAt: job.value.updatedAt },
          });
          if (!((await new BankEnrichmentScopes(database, now).get(ctx, run.snapshotId)).ok)) {
            expect.unreachable(
              'Expected (await new BankEnrichmentScopes(database, now).get(ctx, run.snapshotId)).ok',
            );
          }
          expect(
            await new BankEnrichmentScopes(database, now).inspect(ctx, {
              _tag: 'Filtered',
              queryString: '',
            }),
          ).toStrictEqual({ ok: true, value: 2 });
          if (
            !((await new BankEnrichmentSampler(database).sample(
              ctx,
              run.snapshotId,
              crypto.randomUUID(),
            )).ok)
          ) {
            expect.unreachable(
              'Expected (await new BankEnrichmentSampler(database).sample( ctx, run.snapshotId, crypto.randomUUID(',
            );
          }
          if (!((await new BankEnrichmentStore(database, now).getVersion(ctx, run.versionId)).ok)) {
            expect.unreachable(
              'Expected (await new BankEnrichmentStore(database, now).getVersion(ctx, run.versionId)).ok',
            );
          }
          if (!((await new BankEnrichmentUsage(database, now).summary(ctx, run.runId)).ok)) {
            expect.unreachable(
              'Expected (await new BankEnrichmentUsage(database, now).summary(ctx, run.runId)).ok',
            );
          }
          expect(await readOrganizationNotices(database, ctx)).toStrictEqual({
            ok: true,
            value: { total: 0, notices: [] },
          });

          const error = await (async () => {
            const caught: unknown = await Promise.resolve().then(() =>
              database.transaction((tx) => authorizeEnrichment(tx, ctx, 'manage_content'))
            ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
            if (!(caught instanceof Error)) expect.unreachable('Expected Error');
            return caught;
          })();
          if (!(error instanceof Error && error.cause instanceof postgres.PostgresError)) {
            expect.unreachable(
              'Expected error instanceof Error && error.cause instanceof postgres.PostgresError',
            );
          }
          expect(error.cause.code).toStrictEqual('55P03');
        });
      });
    } finally {
      await client.end();
      await shutdownDb();
    }
  },
);

testCase(
  'enrichment mutation rechecks committed revocation and subsequent reads are forbidden',
  async () => {
    if (!(/test/.test(new URL(getDatabaseUrl()).pathname))) {
      expect.unreachable('Use an isolated test database.');
    }
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const run = await prepareEnrichmentRunFixture(ctx, 1);
        const pending = Promise.withResolvers<boolean>();
        await db.transaction(async (writer) => {
          if (!(await lockWorkspace(writer, ctx.tenantId))) {
            expect.unreachable('Expected await lockWorkspace(writer, ctx.tenantId)');
          }
          await writer.delete(organizationMemberships).where(
            eq(organizationMemberships.userId, ctx.userId),
          );
          pending.resolve(db.transaction((tx) => authorizeEnrichment(tx, ctx, 'manage_content')));
        });
        expect(await pending.promise).toStrictEqual(false);
        const now = () => new Date(), forbidden = { ok: false, code: 'forbidden' } as const;
        const read = new BankEnrichmentJobRead(db, now);
        const query = parseQuestionBankQuery(new URLSearchParams(`scheme=${run.schemeId}`));
        expect(await read.get(ctx, run.runId)).toStrictEqual(forbidden);
        expect(await read.status(ctx, run.runId)).toStrictEqual(forbidden);
        expect(await new BankEnrichmentBrowse(db).page(ctx, query, { locale: 'en-US' }))
          .toStrictEqual(forbidden);
        expect(await new BankEnrichmentScopes(db, now).get(ctx, run.snapshotId)).toStrictEqual(
          forbidden,
        );
        expect(await new BankEnrichmentStore(db, now).getVersion(ctx, run.versionId)).toStrictEqual(
          forbidden,
        );
        expect(await new BankEnrichmentUsage(db, now).summary(ctx, run.runId)).toStrictEqual(
          forbidden,
        );
        expect(
          await new BankEnrichmentScopes(db, now).inspect(ctx, {
            _tag: 'Filtered',
            queryString: '',
          }),
        ).toStrictEqual(forbidden);
        expect(await new BankEnrichmentSampler(db).sample(ctx, run.snapshotId, crypto.randomUUID()))
          .toStrictEqual(forbidden);
        expect(await readOrganizationNotices(db, ctx)).toStrictEqual(forbidden);
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'author-only organization reads use snapshots instead of tenant or run locks',
  async () => {
    if (!(/test/.test(new URL(getDatabaseUrl()).pathname))) {
      expect.unreachable('Use an isolated test database.');
    }
    const client = postgres(getDatabaseUrl(), {
      max: 1,
      prepare: false,
      fetch_types: false,
      connection: { lock_timeout: 250, statement_timeout: 5000 },
    });
    const database = drizzle(client);
    try {
      await withOrganizationWorkspace(async (f) => {
        if (!((await cancelOrganizationRun(db, f.ctx, f.runId)).ok)) {
          expect.unreachable('Expected (await cancelOrganizationRun(db, f.ctx, f.runId)).ok');
        }
        const workspace = new QuestionOrganizationWorkspace(database, organizationNow);
        await db.transaction(async (writer) => {
          if (!(await lockWorkspace(writer, f.ctx.tenantId))) {
            expect.unreachable('Expected await lockWorkspace(writer, f.ctx.tenantId)');
          }
          await writer.select().from(organizationRuns).where(eq(organizationRuns.id, f.runId)).for(
            'update',
          );
          if (!((await workspace.home(f.ctx)).ok)) {
            expect.unreachable('Expected (await workspace.home(f.ctx)).ok');
          }
          const progress = await workspace.run(f.ctx, f.runId);
          if (!(progress.ok)) expect.unreachable('Expected progress.ok');
          expect(progress.value.state).toStrictEqual('cancelled');
          const report = await readOrganizationReport(database, f.ctx, f.runId);
          if (!(report.ok)) expect.unreachable('Expected report.ok');
          expect(report.value.state).toStrictEqual('cancelled');
          if (!((await readOrganizationNotices(database, f.ctx)).ok)) {
            expect.unreachable('Expected (await readOrganizationNotices(database, f.ctx)).ok');
          }
        });
        await db.update(organizationMemberships).set({ role: 'teaching_assistant' }).where(
          eq(organizationMemberships.userId, f.ctx.userId),
        );
        const forbidden = { ok: false, code: 'forbidden' } as const;
        expect(await workspace.home(f.ctx)).toStrictEqual(forbidden);
        expect(await workspace.run(f.ctx, f.runId)).toStrictEqual(forbidden);
        expect(await readOrganizationReport(database, f.ctx, f.runId)).toStrictEqual(forbidden);
        expect(await readOrganizationNotices(database, f.ctx)).toStrictEqual(forbidden);
        expect(
          await new BankEnrichmentScopes(database, organizationNow).inspect(f.ctx, {
            _tag: 'Filtered',
            queryString: '',
          }),
        ).toStrictEqual(forbidden);
        expect(
          await new BankEnrichmentSampler(database).sample(
            f.ctx,
            crypto.randomUUID(),
            crypto.randomUUID(),
          ),
        ).toStrictEqual(forbidden);
      }, { count: 2, difficulty: 'none' });
    } finally {
      await client.end();
      await shutdownDb();
    }
  },
);
