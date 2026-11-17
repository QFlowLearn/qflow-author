import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { migrationItems } from '../lib/db/schema.ts';
import { getMigrationReviewPage } from '../lib/services/migration_review_page.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';
import { buildMigrationQaReport } from '../lib/import/migration_qa_report.ts';
import { withBankReviewSource } from './helpers/bank_review_import.ts';
import { migrationRepeatPackage } from './helpers/migration_repeat_package.ts';

testCase(
  'exact repeats span native import checkpoints, retain source identities and exclude uncertain, edited and rejected questions',
  async () => {
    await withBankReviewSource(
      { filename: 'repeats.zip', mime: 'application/zip', bytes: await migrationRepeatPackage() },
      'qti3',
      async (ctx, id) => {
        const page = await getMigrationReviewPage(ctx, id, 1, false);
        if (!(page?.exactRepeats)) expect.unreachable('Expected page?.exactRepeats');
        const summary = page.exactRepeats;
        expect(summary.total).toStrictEqual(131);
        expect(summary.compared).toStrictEqual(129);
        expect(summary.repeats).toStrictEqual(27);
        expect(summary.limited).toStrictEqual(true);
        expect(summary.groups.length).toStrictEqual(20);
        expect(summary.groups[0].count).toStrictEqual(8);
        expect(summary.groups[0].members.map((m) => m.position)).toStrictEqual([
          1,
          101,
          122,
          123,
          124,
          125,
        ]);
        const full = await getMigrationReviewPage(ctx, id, 1, true);
        if (!(full?.exactRepeats)) expect.unreachable('Expected full?.exactRepeats');
        expect(full.run.items.length).toStrictEqual(131);
        expect(full.run.reviewProgress.pending).toStrictEqual(131);
        expect(full.run.items[130].importedDraft.correctId).toStrictEqual(undefined);
        expect(full.run.items[130].importedDraft.preserveSourceXml).toStrictEqual(true);
        expect(full.run.items[130].sourceXml.includes('<qti-correct-response>')).toStrictEqual(
          false,
        );
        if (!(full.run.items[130].warnings.some((warning) => warning.code === 'MISSING_CORRECT'))) {
          expect.unreachable(
            "Expected full.run.items[130].warnings.some((warning) => warning.code === 'MISSING_CORRECT')",
          );
        }
        expect(full.run.items[130].readiness).toStrictEqual('blocked');
        expect(full.exactRepeats.groups.length).toStrictEqual(21);
        expect(full.exactRepeats.groups[0].members.length).toStrictEqual(8);
        expect(full.exactRepeats.limited).toStrictEqual(false);
        expect(
          full.run.items.filter((item) => item.position < 130).every((item) =>
            item.readiness === 'ready'
          ),
        ).toStrictEqual(true);
        const rows = await db.select().from(migrationItems).where(eq(migrationItems.runId, id));
        expect(new Set(rows.map((row) => row.id)).size).toStrictEqual(131);
        expect(
          rows.filter((row) => row.exactContentIdentity === null).map((r) => r.position).sort((
            a,
            b,
          ) => a - b),
        ).toStrictEqual([130, 131]);
        expect(
          buildMigrationQaReport(full.run, new Date('2026-09-28T12:00:00Z'), full.exactRepeats),
        ).toContain('2 copies: questions 21, 121.');
        expect(
          await getMigrationReviewPage({ ...ctx, tenantId: crypto.randomUUID() }, id, 1, false),
        ).toStrictEqual(null);
        const item = full.run.items.find((item) => item.position === 121);
        if (!item) expect.unreachable('Expected item');
        const version = {
          contentHash: item.contentHash,
          contextHash: item.contextHash,
          decision: item.decision,
        };
        await updateMigrationItems(ctx, id, [item.id], {
          kind: 'edit',
          title: item.title,
          bodyHtml: '<p>A changed passage.</p>',
        }, { [item.id]: version });
        const edited = await getMigrationReviewPage(ctx, id, 1, true);
        if (!(edited?.exactRepeats)) expect.unreachable('Expected edited?.exactRepeats');
        expect(edited.exactRepeats.compared).toStrictEqual(128);
        expect(edited.exactRepeats.repeats).toStrictEqual(26);
        const reject = edited.run.items.find((item) => item.position === 101);
        if (!reject) expect.unreachable('Expected reject');
        await updateMigrationItems(ctx, id, [reject.id], { kind: 'reject' }, {
          [reject.id]: {
            contentHash: reject.contentHash,
            contextHash: reject.contextHash,
            decision: reject.decision,
          },
        });
        const rejected = await getMigrationReviewPage(ctx, id, 1, false);
        if (!(rejected?.exactRepeats)) expect.unreachable('Expected rejected?.exactRepeats');
        expect(rejected.exactRepeats.total).toStrictEqual(130);
        expect(rejected.exactRepeats.compared).toStrictEqual(127);
        expect(rejected.exactRepeats.repeats).toStrictEqual(25);
      },
    );
  },
);

testCase(
  'Respondus exact repeats are informational and a changed key remains a separate question',
  async () => {
    const bytes = new TextEncoder().encode(
      '1. Same prompt?\n*a. Yes\nb. No\n\n2. Same prompt?\n*a. Yes\nb. No\n\n3. Same prompt?\na. Yes\n*b. No\n',
    );
    await withBankReviewSource(
      { filename: 'repeats.txt', mime: 'text/plain', bytes },
      'respondus-standard',
      async (ctx, id) => {
        const page = await getMigrationReviewPage(ctx, id, 1, false);
        if (!(page?.exactRepeats)) expect.unreachable('Expected page?.exactRepeats');
        expect(page.exactRepeats.compared).toStrictEqual(3);
        expect(page.exactRepeats.repeats).toStrictEqual(1);
        expect(page.exactRepeats.groups[0].members.map((m) => m.position)).toStrictEqual([1, 2]);
        expect(page.run.summary.counts.ready).toStrictEqual(3);
        expect(page.run.summary.counts.warnings).toStrictEqual(0);
      },
    );
  },
);
