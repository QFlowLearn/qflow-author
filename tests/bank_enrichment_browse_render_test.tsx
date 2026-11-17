import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { BankEnrichmentFilters } from '../components/item_bank/BankEnrichmentFilters.tsx';
import { BankEnrichmentValue } from '../components/item_bank/BankEnrichmentValue.tsx';
import { CATALOGS } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { EnrichmentBrowseView } from '../lib/services/bank_enrichment_browse_contract.ts';

testCase(
  'classification controls localize status and explain historical and unassigned row values',
  () => {
    const scheme = {
      id: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      version: 2,
      name: 'Science',
      audience: 'Grade 9',
    };
    const versionId = crypto.randomUUID();
    const category = {
      versionId,
      version: 1,
      audience: 'Grade 6',
      id: 'easy',
      label: 'Easy',
      count: 12,
    };
    const facet = {
      categories: [category],
      truncated: false,
      pending: 8,
      outside: 4,
      unassigned: 1,
      outdated: 2,
    };
    const view: EnrichmentBrowseView = {
      schemes: [scheme],
      schemesTruncated: false,
      selection: { scheme, facets: { subject: facet, topic: facet, difficulty: facet } },
    };
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
      for (const ownership of ['native', 'component'] as const) {
        const i18n = createI18n(locale, CATALOGS[locale]);
        const html = render(
          <BankEnrichmentFilters
            ownership={ownership}
            view={view}
            filter={{
              schemeId: scheme.id,
              subject: null,
              topic: null,
              difficulty: { kind: 'value', versionId, valueId: 'easy', freshness: 'any' },
            }}
            i18n={i18n}
          />,
        );
        expect(html).toContain(i18n.t('items.browse.vocabulary'));
        if (html.includes(i18n.t('items.browse.audience', { audience: 'Grade 9' }))) {
          expect.unreachable(
            "Expected !html.includes(i18n.t('items.browse.audience', { audience: 'Grade 9' }))",
          );
        }
        expect(html).toContain('Easy (12)');
        expect(html).toContain(
          i18n.t('items.browse.versionAudience', { version: 1, audience: 'Grade 6' }),
        );
        expect(html, ownership).toMatch(
          new RegExp(
            `<option[^>]*(?:selected[^>]*value="${versionId}:easy"|value="${versionId}:easy"[^>]*selected)[^>]*>`,
          ),
        );
        const row = render(
          <BankEnrichmentValue
            value={{
              state: 'classified',
              value: { state: 'unassigned', reason: 'insufficient_context' },
              versionId,
              categories: [],
              version: 1,
              audience: 'Grade 6',
              outdated: true,
            }}
            scheme={scheme}
            i18n={i18n}
          />,
        );
        expect(row).toContain(i18n.t('items.browse.reason.insufficient_context'));
        expect(row).toContain(i18n.t('items.browse.outdated'));
        expect(row).toContain('Grade 6');
        if (html.includes('items.browse.')) {
          expect.unreachable("Expected !html.includes('items.browse.')");
        }
        const unloaded = render(
          <BankEnrichmentFilters
            ownership={ownership}
            view={{ ...view, selection: null }}
            filter={null}
            i18n={i18n}
          />,
        );
        expect((unloaded.match(/<select[^>]*disabled/g) ?? []).length).toStrictEqual(3);
        expect((unloaded.match(new RegExp(i18n.t('items.browse.none'), 'g')) ?? []).length)
          .toStrictEqual(4);
        expect(render(
          <BankEnrichmentFilters
            ownership={ownership}
            view={{ schemes: [], schemesTruncated: false, selection: null }}
            filter={null}
            i18n={i18n}
          />,
        )).toStrictEqual('');
      }
    }
  },
);
