import { expect, test as testCase } from 'vitest';

import {
  parseQuestionBankFilterForm,
  parseQuestionBankQuery,
  QuestionBankInputError,
} from '../lib/services/question_bank_query.ts';
import {
  appendBankEnrichmentFilter,
  bankEnrichmentAlternatives,
  bankEnrichmentFilterValue,
  enrichmentResultHref,
} from '../lib/services/bank_enrichment_query.ts';
import { parseItemDetailQuery } from '../lib/item_detail_query.ts';
import { parseEnrichmentScope } from '../lib/services/bank_enrichment_scope.ts';
import { questionBankGroupHref } from '../lib/question_bank_link.ts';

testCase(
  'bank classification URLs pin category versions and preserve detail returns and frozen filters',
  () => {
    const scheme = crypto.randomUUID(),
      version = crypto.randomUUID(),
      question = crypto.randomUUID();
    const params = new URLSearchParams({
      scheme,
      subject: `${version}:life`,
      topic: `${version}:cells`,
      difficulty: `${version}:moderate`,
      tags: 'source-science',
      q: 'Cell',
      page: '2',
      pageSize: '100',
      sort: 'title',
      direction: 'asc',
    });
    const query = parseQuestionBankQuery(params);
    if (!(query.enrichment)) expect.unreachable('Expected query.enrichment');
    expect(query.enrichment.difficulty).toStrictEqual({
      kind: 'value',
      versionId: version,
      valueId: 'moderate',
      freshness: 'any',
    });
    const serialized = new URLSearchParams();
    appendBankEnrichmentFilter(serialized, query.enrichment);
    expect(parseQuestionBankQuery(serialized).enrichment).toStrictEqual(query.enrichment);
    const bankHref = `/items?${params}#question-${question}`;
    expect(parseItemDetailQuery(new URLSearchParams({ bank: bankHref })).bankHref).toStrictEqual(
      bankHref,
    );
    const captured = parseEnrichmentScope({ _tag: 'Filtered', queryString: params.toString() });
    if (!(captured && captured._tag === 'Filtered')) {
      expect.unreachable("Expected captured && captured._tag === 'Filtered'");
    }
    expect(captured.query.enrichment).toStrictEqual(query.enrichment);
    expect(captured.query.tags).toStrictEqual(['source-science']);
    expect(captured.query.page).toStrictEqual(1);
    if (captured.queryString.includes('page=')) {
      expect.unreachable("Expected !captured.queryString.includes('page=')");
    }
    if (captured.queryString.includes('sort=')) {
      expect.unreachable("Expected !captured.queryString.includes('sort=')");
    }
  },
);
testCase(
  'unassigned, unfinished, outside-run and outdated states are distinct filters within an explicit vocabulary',
  () => {
    const scheme = crypto.randomUUID();
    for (const state of ['unassigned', 'pending', 'outside', 'outdated'] as const) {
      const query = parseQuestionBankQuery(new URLSearchParams({ scheme, difficulty: state }));
      expect(query.enrichment?.difficulty).toStrictEqual(
        state === 'outdated'
          ? { kind: 'unconstrained', freshness: 'outdated' }
          : { kind: state, freshness: 'any' },
      );
    }
    for (
      const params of [
        new URLSearchParams({ difficulty: 'unassigned' }),
        new URLSearchParams({ scheme: 'invalid' }),
        new URLSearchParams({ scheme, difficulty: 'easy' }),
        new URLSearchParams({ scheme, topic: `${crypto.randomUUID()}:a:extra` }),
        new URLSearchParams({ scheme, subject: `${crypto.randomUUID()}:UPPERCASE` }),
        new URLSearchParams(`scheme=${scheme}&scheme=${scheme}`),
      ]
    ) expect(() => parseQuestionBankQuery(params)).toThrowError(QuestionBankInputError);
  },
);

testCase('category drill-down retains independent freshness and alternative scopes agree', () => {
  const scheme = crypto.randomUUID(), version = crypto.randomUUID();
  const category = `${version}:life`;
  for (
    const [current, next, expected] of [
      ['outdated', category, `${category}:outdated`],
      [category, 'outdated', `${category}:outdated`],
      ['outdated', 'unassigned', 'unassigned:outdated'],
      ['unassigned', 'outdated', 'unassigned:outdated'],
      ['unassigned:outdated', category, `${category}:outdated`],
      [`${category}:outdated`, `${version}:physical`, `${version}:physical:outdated`],
    ]
  ) {
    const query = parseQuestionBankQuery(new URLSearchParams({ scheme, subject: current }));
    const target = parseQuestionBankQuery(new URLSearchParams({ scheme, subject: next }));
    if (!(target.enrichment?.subject)) expect.unreachable('Expected target.enrichment?.subject');
    const href = questionBankGroupHref(query, { subject: target.enrichment.subject });
    expect(new URL(href, 'https://qflow.test').searchParams.get('subject')).toStrictEqual(expected);
  }
  for (const value of ['outdated', `${category}:outdated`, 'unassigned:outdated']) {
    const query = parseQuestionBankQuery(new URLSearchParams({ scheme, subject: value }));
    if (!(query.enrichment)) expect.unreachable('Expected query.enrichment');
    const alternatives = bankEnrichmentAlternatives(query.enrichment.subject);
    if (!alternatives) expect.unreachable('Expected alternatives');
    expect(bankEnrichmentFilterValue(alternatives)).toStrictEqual('outdated');
  }
  for (const value of ['pending:outdated', 'outside:outdated']) {
    expect(() => parseQuestionBankQuery(new URLSearchParams({ scheme, subject: value })))
      .toThrowError(Error);
  }
});

testCase(
  'run result navigation retains source scope and removes categories the run may have replaced',
  () => {
    const scheme = crypto.randomUUID();
    const url = new URL(
      enrichmentResultHref(
        'tags=arc&q=cell&page=2&subject=unassigned&difficulty=pending&collection=unfiled',
        scheme,
      ),
      'https://example.com',
    );
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      tags: 'arc',
      q: 'cell',
      collection: 'unfiled',
      scheme,
    });
  },
);

testCase(
  'native vocabulary form clears prior categories, retains same-vocabulary filters, and rejects malformed submissions',
  () => {
    const a = crypto.randomUUID(), b = crypto.randomUUID(), version = crypto.randomUUID();
    const params = new URLSearchParams({
      loadedScheme: a,
      scheme: b,
      subject: `${version}:life`,
      tags: 'arc',
    });
    const switched = parseQuestionBankFilterForm(params);
    if (!switched) expect.unreachable('Expected switched');
    expect(Object.fromEntries(switched)).toStrictEqual({ scheme: b, tags: 'arc' });
    expect(params.get('subject'), 'Parser must not mutate caller input').toStrictEqual(
      `${version}:life`,
    );
    params.set('scheme', a);
    const same = parseQuestionBankFilterForm(params);
    if (!same) expect.unreachable('Expected same');
    expect(same.get('subject')).toStrictEqual(`${version}:life`);
    params.set('scheme', '');
    const cleared = parseQuestionBankFilterForm(params);
    if (!cleared) expect.unreachable('Expected cleared');
    expect(cleared.has('subject')).toStrictEqual(false);
    params.append('subject', `${version}:life`);
    expect(() => parseQuestionBankFilterForm(params)).toThrowError(QuestionBankInputError);
    params.delete('subject');
    params.set('loadedScheme', 'invalid');
    expect(() => parseQuestionBankFilterForm(params)).toThrowError(QuestionBankInputError);
  },
);
