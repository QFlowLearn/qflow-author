import { expect, test as testCase } from 'vitest';

import { getMigrationReviewPage } from '../lib/services/migration_review_page.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';
import {
  migrationReviewHref,
  parseMigrationReviewFilter,
} from '../lib/import/migration_review_filter.ts';
import { withBankReviewImport } from './helpers/bank_review_import.ts';

testCase('bank review URL filters are closed and retain page and editor context', () => {
  expect(parseMigrationReviewFilter(null)).toStrictEqual('all');
  expect(parseMigrationReviewFilter('all')).toStrictEqual('all');
  expect(parseMigrationReviewFilter('blocked')).toStrictEqual('blocked');
  expect(parseMigrationReviewFilter('anything')).toStrictEqual(null);
  expect(migrationReviewHref('run', 2, 'blocked', 'question')).toStrictEqual(
    '/imports/run?page=2&review=blocked&edit=question#item-question',
  );
});

testCase(
  'bank needs-fixes review is bounded, tenant scoped and excludes rejected questions without changing global progress',
  async () => {
    await withBankReviewImport(async (ctx, id) => {
      const all = await getMigrationReviewPage(ctx, id, 1, false);
      if (!(all?.pagination)) expect.unreachable('Expected all?.pagination');
      expect(all.run.items.length).toStrictEqual(50);
      expect(all.pagination).toStrictEqual({
        page: 1,
        pageSize: 50,
        total: 121,
        totalItems: 121,
        blocked: 61,
        filter: 'all',
      });
      const first = await getMigrationReviewPage(ctx, id, 1, false, 'blocked');
      if (!(first?.pagination)) expect.unreachable('Expected first?.pagination');
      expect(first.run.items.length).toStrictEqual(50);
      expect(first.run.items[0].position).toStrictEqual(61);
      if (!(first.run.items.every((item) => item.readiness === 'blocked'))) {
        expect.unreachable(
          "Expected first.run.items.every((item) => item.readiness === 'blocked')",
        );
      }
      expect(first.run.reviewProgress).toStrictEqual(all.run.reviewProgress);
      expect(first.run.summary).toStrictEqual(all.run.summary);
      const last = await getMigrationReviewPage(ctx, id, 200, false, 'blocked');
      if (!(last?.pagination)) expect.unreachable('Expected last?.pagination');
      expect(last.pagination.page).toStrictEqual(2);
      expect(last.run.items.length).toStrictEqual(11);
      expect(last.run.items[0].position).toStrictEqual(111);
      expect(
        await getMigrationReviewPage(
          { ...ctx, tenantId: crypto.randomUUID() },
          id,
          1,
          false,
          'blocked',
        ),
      ).toStrictEqual(null);
      expect(
        await getMigrationReviewPage(
          { ...ctx, userId: crypto.randomUUID() },
          id,
          1,
          false,
          'blocked',
        ),
      ).toStrictEqual(null);
      const report = await getMigrationReviewPage(ctx, id, 2, true, 'blocked');
      if (!report) expect.unreachable('Expected report');
      expect(report.pagination).toStrictEqual(undefined);
      expect(report.run.items.length).toStrictEqual(121);
      const reject = async (items: typeof last.run.items) => {
        await updateMigrationItems(
          ctx,
          id,
          items.map((i) => i.id),
          { kind: 'reject' },
          Object.fromEntries(
            items.map((
              i,
            ) => [i.id, {
              contentHash: i.contentHash,
              contextHash: i.contextHash,
              decision: i.decision,
            }]),
          ),
        );
      };
      await reject(last.run.items);
      const remaining = await getMigrationReviewPage(ctx, id, 2, false, 'blocked');
      if (!(remaining?.pagination)) expect.unreachable('Expected remaining?.pagination');
      expect(remaining.pagination.page).toStrictEqual(1);
      expect(remaining.pagination.total).toStrictEqual(50);
      expect(remaining.run.reviewProgress).toStrictEqual({
        total: 121,
        pending: 110,
        accepted: 0,
        rejected: 11,
      });
      await reject(remaining.run.items);
      const empty = await getMigrationReviewPage(ctx, id, 2, false, 'blocked');
      if (!(empty?.pagination)) expect.unreachable('Expected empty?.pagination');
      expect(empty.pagination.total).toStrictEqual(0);
      expect(empty.pagination.page).toStrictEqual(1);
      expect(empty.run.items).toStrictEqual([]);
      expect(empty.run.reviewProgress).toStrictEqual({
        total: 121,
        pending: 60,
        accepted: 0,
        rejected: 61,
      });
    });
  },
);
