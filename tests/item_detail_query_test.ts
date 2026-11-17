import { expect, test as testCase } from 'vitest';

import {
  itemDetailHref,
  ItemDetailQueryError,
  itemDetailQueryParams,
  parseItemDetailQuery,
} from '../lib/item_detail_query.ts';

testCase('detail navigation round trips comparison and all independently paged evidence', () => {
  const requestId = crypto.randomUUID(), commentId = crypto.randomUUID();
  const query = parseItemDetailQuery(
    new URLSearchParams(
      `compare=2&compareTo=4&historyBefore=7&reviewsBefore=6&commentsFor=${requestId}&commentsBefore=${commentId}`,
    ),
  );
  expect(parseItemDetailQuery(itemDetailQueryParams(query))).toStrictEqual(query);
  const historyLink = new URL(
    itemDetailHref('item', { ...query, historyBefore: 3 }, 'item-history-heading'),
    'http://localhost',
  );
  expect(parseItemDetailQuery(historyLink.searchParams)).toStrictEqual({
    ...query,
    historyBefore: 3,
  });
  const compareForm = itemDetailQueryParams({ ...query, comparison: null });
  compareForm.set('compare', '1');
  compareForm.set('compareTo', '5');
  expect(parseItemDetailQuery(compareForm)).toStrictEqual({
    ...query,
    comparison: { fromRevision: 1, toRevision: 5 },
  });
});

testCase(
  'comparison errors are distinct from pagination and reject partial or repeated pairs',
  () => {
    for (
      const value of [
        'compare=2',
        'compareTo=4',
        'compare=4&compareTo=2',
        'compare=2&compare=3&compareTo=4',
        'compare=2.0&compareTo=4',
      ]
    ) {
      const error = (() => {
        try {
          (() => parseItemDetailQuery(new URLSearchParams(value)))();
        } catch (caught: unknown) {
          if (!(caught instanceof ItemDetailQueryError)) {
            expect.unreachable('Expected ItemDetailQueryError');
          }
          return caught;
        }
        return expect.unreachable('Expected an exception.');
      })();
      expect(error.code).toStrictEqual('invalid_comparison');
    }
    const error = (() => {
      try {
        (() => parseItemDetailQuery(new URLSearchParams('historyBefore=1')))();
      } catch (caught: unknown) {
        if (!(caught instanceof ItemDetailQueryError)) {
          expect.unreachable('Expected ItemDetailQueryError');
        }
        return caught;
      }
      return expect.unreachable('Expected an exception.');
    })();
    expect(error.code).toStrictEqual('invalid_pagination');
  },
);

testCase(
  'bank return navigation preserves filters and row while rejecting external destinations',
  () => {
    const bankHref =
      '/items?collection=unfiled&sort=title&direction=asc&page=2#question-10000000-0000-4000-8000-000000000001';
    const parsed = parseItemDetailQuery(new URLSearchParams({ bank: bankHref }));
    expect(parsed.bankHref).toStrictEqual(bankHref);
    expect(itemDetailQueryParams(parsed).get('bank')).toStrictEqual(bankHref);
    for (
      const bank of [
        'https://evil.example/items',
        '//evil.example/items',
        '/settings',
        '/items?q=x#bad',
      ]
    ) {
      expect(() => parseItemDetailQuery(new URLSearchParams({ bank }))).toThrowError(
        ItemDetailQueryError,
      );
    }
  },
);
