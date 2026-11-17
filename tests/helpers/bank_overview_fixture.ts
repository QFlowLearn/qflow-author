import type { EnrichmentOverviewView } from '../../lib/services/bank_enrichment_browse_contract.ts';
import { parseQuestionBankQuery } from '../../lib/services/question_bank_query.ts';

/** Fixed display contract used for the before/after table observation. */
export function bankOverviewFixture() {
  const scheme = {
    id: '10000000-0000-4000-8000-000000000001',
    versionId: '10000000-0000-4000-8000-000000000002',
    version: 1,
    name: 'Science',
    audience: 'Grade 6',
  };
  const subject = {
    key: `${scheme.versionId}:life`,
    filter: { kind: 'value', versionId: scheme.versionId, valueId: 'life', freshness: 'any' },
    category: { label: 'Life science', version: 1, audience: scheme.audience },
  } as const;
  const difficulty = {
    key: `${scheme.versionId}:easy`,
    filter: { kind: 'value', versionId: scheme.versionId, valueId: 'easy', freshness: 'any' },
    category: { label: 'Easy', version: 1, audience: scheme.audience },
  } as const;
  const emptyFacet = {
    categories: [],
    truncated: false,
    pending: 0,
    outside: 0,
    unassigned: 0,
    outdated: 0,
  };
  const enrichment: EnrichmentOverviewView = {
    schemes: [scheme],
    schemesTruncated: false,
    selection: {
      scheme,
      facets: { subject: emptyFacet, topic: emptyFacet, difficulty: emptyFacet },
      overview: {
        columns: [difficulty],
        rows: [{
          bucket: subject,
          counts: [7787],
          total: 7787,
          topics: [{
            bucket: {
              ...subject,
              key: 'cells',
              filter: { ...subject.filter, valueId: 'cells' },
              category: { ...subject.category, label: 'Cells' },
            },
            counts: [7787],
            total: 7787,
          }],
        }],
        totals: [7787],
        total: 7787,
        statuses: [],
      },
    },
  };
  return {
    view: enrichment,
    query: parseQuestionBankQuery(
      new URLSearchParams(`scheme=${scheme.id}&view=overview&q=cells&page=2`),
    ),
  };
}
