import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import ItemsIndex from '../components/item_bank/ItemsPage.tsx';
import { BankOverview } from '../components/item_bank/BankOverview.tsx';
import { CATALOGS } from '../lib/i18n/catalogs.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { parseQuestionBankQuery } from '../lib/services/question_bank_query.ts';
import type { EnrichmentOverviewView } from '../lib/services/bank_enrichment_browse_contract.ts';

testCase(
  'category breakdown localizes navigation and counts in five languages with visible filters and no paging',
  () => {
    const scheme = {
      id: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
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
    for (const locale of INTERFACE_LOCALES) {
      const i18n = createI18n(locale, CATALOGS[locale]);
      const query = parseQuestionBankQuery(
        new URLSearchParams(`scheme=${scheme.id}&view=overview&q=cells&page=2`),
      );
      const html = render(
        <ItemsIndex
          kind='overview'
          enrichment={enrichment}
          query={query}
          bankDisplayName={null}
          collectionWorkspace={{
            collections: [],
            operationId: crypto.randomUUID(),
            createId: crypto.randomUUID(),
          }}
          bank={{
            facets: { tags: [], standards: [], owners: [], types: [], targets: [] },
            total: 7787,
          }}
          canManageContent
          notice={null}
          error={null}
          i18n={i18n}
          payload={createI18nPayload(locale, CATALOGS[locale], ['items'])}
        />,
      );
      expect(html).toContain(i18n.t('items.overview.title'));
      expect(html).toContain(i18n.t('items.overview.openCountHint'));
      expect(html).toContain(i18n.t('items.overview.update'));
      expect(html).toContain(i18n.formatNumber(7787));
      expect(html).toContain('<th scope="row"');
      expect(html).toContain(i18n.t('items.overview.subjectTopics', { subject: 'Life science' }));
      expect(html).toContain(i18n.t('items.overview.topicOverlap'));
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('id="overview-topics-0" hidden');
      expect(html).toContain(
        i18n.t('items.overview.openGroup', { count: 7787, group: 'Life science / Easy' }),
      );
      if (!(html.indexOf('name="subject"') < html.indexOf('<details'))) {
        expect.unreachable("Expected html.indexOf('name=\"subject\"') < html.indexOf('<details')");
      }
      if (html.includes('<details open')) {
        expect.unreachable("Expected !html.includes('<details open')");
      }
      if (html.includes('name="questionId"')) {
        expect.unreachable('Expected !html.includes(\'name="questionId"\')');
      }
      if (html.includes('position="bottom"')) {
        expect.unreachable('Expected !html.includes(\'position="bottom"\')');
      }
      if (html.includes(i18n.t('items.results.page', { page: 2, pages: 78 }))) {
        expect.unreachable(
          "Expected !html.includes(i18n.t('items.results.page', { page: 2, pages: 78 }))",
        );
      }
      expect(html).toContain('q=cells&amp;page=1');
      if (
        !(html.split(i18n.t('items.browse.audience', { audience: scheme.audience })).length === 2)
      ) {
        expect.unreachable(
          "Expected html.split(i18n.t('items.browse.audience', { audience: scheme.audience })).length === 2",
        );
      }
      if (!(enrichment.selection)) expect.unreachable('Expected enrichment.selection');
      const historical = render(
        <BankOverview
          query={query}
          i18n={i18n}
          view={{
            ...enrichment,
            selection: {
              ...enrichment.selection,
              scheme: {
                ...scheme,
                versionId: crypto.randomUUID(),
                version: 2,
                audience: 'Adult science',
              },
            },
          }}
        />,
      );
      if (historical.includes(i18n.t('items.browse.audience', { audience: 'Adult science' }))) {
        expect.unreachable(
          "Expected !historical.includes(i18n.t('items.browse.audience', { audience: 'Adult science' }))",
        );
      }
      expect(historical).toContain(i18n.t('items.browse.versionAudience', {
        version: 1,
        audience: 'Grade 6',
      }));
      const unselected = render(
        <BankOverview view={{ ...enrichment, selection: null }} query={query} i18n={i18n} />,
      );
      expect(unselected).toContain(i18n.t('items.overview.matrix'));
      expect(unselected).toContain(i18n.t('items.overview.chooseSet'));
    }
  },
);
