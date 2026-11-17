import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import ItemsIndex from '../components/item_bank/ItemsPage.tsx';
import { formatError, formatNotice } from '../lib/http/routes/bank_pages/items.tsx';
import BankSectionNavigation from '../components/item_bank/BankSectionNavigation.tsx';
import { CompatibilitySummary } from '../components/item_bank/CompatibilitySummary.tsx';
import { formatBankDate } from '../components/item_bank/ui.tsx';
import { listSelectableAssessmentExportTargets } from '../lib/export/assessment_export_targets.ts';
import { CATALOGS } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { memberPickerStatus } from '../islands/MemberPicker.tsx';
import MemberPicker from '../islands/MemberPicker.tsx';

testCase('items index presents bank evidence without exposing internal identifiers', () => {
  const itemId = 'f0526c09-4597-5757-bc70-0748684d64fc';
  const html = renderToString(
    <ItemsIndex
      kind='questions'
      enrichment={{ schemes: [], schemesTruncated: false, selection: null }}
      bankDisplayName={null}
      collectionWorkspace={{
        collections: [],
        operationId: '10000000-0000-4000-8000-000000000001',
        createId: '10000000-0000-4000-8000-000000000002',
      }}
      bank={{
        items: [{
          id: itemId,
          title: 'How did FDR reassure Americans in March 1933?',
          tags: ['demo', 'civic-literacy'],
          type: 'single_select',
          typeLabel: 'Single select',
          standards: [{ id: 'std-1', label: 'C3.D2.His.2' }],
          origin: 'Authored',
          owner: { userId: 'user-1', label: 'Ada Author' },
          lifecycle: 'active',
          reviewState: 'approved',
          revision: 2,
          updatedAt: new Date(0).toISOString(),
          duplicateCount: 1,
          compatibility: [],
        }],
        facets: { tags: [], standards: [], owners: [], types: [], targets: [] },
        total: 1,
        page: 1,
        pageSize: 25,
        pageCount: 1,
      }}
      query={{
        sort: { field: 'title', direction: 'asc' },
        search: 'FDR',
        tags: [],
        assignedToMe: false,
        lifecycle: 'active',
        duplicatesOnly: false,
        page: 1,
        pageSize: 25,
      }}
      notice={null}
      error={null}
      canManageContent
      i18n={createI18n('en-US', CATALOGS['en-US'])}
      payload={createI18nPayload('en-US', CATALOGS['en-US'], ['items'])}
    />,
  );

  expect(html).toContain('How did FDR reassure Americans in March 1933?');
  expect(html).toContain('demo');
  expect(html).toContain('civic-literacy');
  expect(html).toContain('C3.D2.His.2');
  expect(html).toContain('Approved');
  expect(html).toContain(`href="/items/${itemId}?bank=`);
  if (html.includes('>Open</a>')) expect.unreachable("Expected !html.includes('>Open</a>')");
  expect(html).toContain('Select this page');
  expect(html).toContain('Columns');
  expect(html).toContain('<table');
  expect(html).toContain('aria-sort="ascending"');
  expect(html).toContain('sort=title&amp;direction=desc&amp;pageSize=25&amp;q=FDR&amp;page=1');
  expect(html).toContain('href="/items/reviews"');
  expect(html).toContain('href="/releases"');
  if (html.includes('href="/items/drafts"')) {
    expect.unreachable('Expected !html.includes(\'href="/items/drafts"\')');
  }
  const navigation = html.slice(
    html.indexOf('<nav aria-label="Question bank"'),
    html.indexOf('</nav>') + 6,
  );
  expect(navigation).toContain('href="/items/reviews"');
  expect(navigation).toContain('href="/releases"');
  if (navigation.includes('Auto-organize')) {
    expect.unreachable("Expected !navigation.includes('Auto-organize')");
  }
  expect(html.includes('href="/items?assigned=me')).toStrictEqual(false);
  expect(html).toContain('Assigned to me');
  expect(html.includes(`>${itemId}<`)).toStrictEqual(false);
  expect(html.includes('Copy ID')).toStrictEqual(false);
});

testCase('bank destinations share one current navigation item', () => {
  const i18n = createI18n('en-US', CATALOGS['en-US']);
  for (const current of ['reviews', 'releases'] as const) {
    const html = renderToString(
      <BankSectionNavigation
        current={current}
        questionsHref='/items'
        overviewHref='/items?view=overview'
        i18n={i18n}
      />,
    );
    const href = current === 'reviews' ? '/items/reviews' : '/releases';
    expect(html).toContain(`href="${href}" aria-current="page"`);
    expect((html.match(/aria-current="page"/g) ?? []).length).toStrictEqual(1);
  }
});

testCase('items index renders localized empty states for every interface locale', () => {
  const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
  const rendered = locales.map((locale) =>
    renderToString(
      <ItemsIndex
        kind='questions'
        enrichment={{ schemes: [], schemesTruncated: false, selection: null }}
        bankDisplayName={null}
        collectionWorkspace={{
          collections: [],
          operationId: '10000000-0000-4000-8000-000000000001',
          createId: '10000000-0000-4000-8000-000000000002',
        }}
        bank={{
          items: [],
          facets: { tags: [], standards: [], owners: [], types: [], targets: [] },
          total: 0,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        }}
        query={{
          search: '',
          tags: [],
          assignedToMe: false,
          lifecycle: 'active',
          duplicatesOnly: false,
          page: 1,
          pageSize: 25,
        }}
        notice={null}
        error={null}
        canManageContent={false}
        i18n={createI18n(locale, CATALOGS[locale])}
        payload={createI18nPayload(locale, CATALOGS[locale], ['items'])}
      />,
    )
  );
  for (const [index, locale] of locales.entries()) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    expect(rendered[index]).toContain(i18n.t('items.results.noResultsTitle'));
    expect(rendered[index]).toContain(i18n.t('items.results.noResultsHint'));
    if (rendered[index].includes('items.')) {
      expect.unreachable("Expected !rendered[index].includes('items.')");
    }
  }
  if (!(rendered[0] !== rendered[2])) expect.unreachable('Expected rendered[0] !== rendered[2]');
});

testCase('items feedback accepts only qualified codes and bounded update counts', () => {
  const i18n = createI18n('es-ES', CATALOGS['es-ES']);
  const queryCodes = [
    'invalid_filter',
    'target_required',
    'unsupported_filter',
    'repeated_filter',
    'invalid_pagination',
    'invalid_owner',
    'invalid_tags',
  ];
  for (const code of queryCodes) {
    expect(formatError(i18n, 'query:' + code) ?? '').toContain('.');
  }
  const formCodes = [
    'invalid_selection',
    'invalid_tags',
    'tags_action_mismatch',
    'owner_action_mismatch',
    'invalid_owner',
    'invalid_field_shape',
    'invalid_action',
    'unsupported_fields',
    'missing_field',
  ];
  for (const code of formCodes) {
    expect(formatError(i18n, 'form:' + code) ?? '').toContain(' ');
  }
  for (const code of ['forbidden', 'invalid_selection', 'invalid_state', 'owner_not_member']) {
    expect(formatError(i18n, 'bulk:' + code) ?? '').toContain(' ');
  }
  expect(formatError(i18n, 'hostile:message') ?? '').toContain('acción');
  expect(formatNotice(i18n, 'updated:1') ?? '').toContain('1');
  expect(formatNotice(i18n, 'updated:100') ?? '').toContain('100');
  expect(formatNotice(i18n, 'updated:0')).toStrictEqual(null);
  expect(formatNotice(i18n, 'updated:101')).toStrictEqual(null);
  expect(formatNotice(i18n, 'updated:999')).toStrictEqual(null);
  expect(formatNotice(i18n, '999 item(s)')).toStrictEqual(null);
});

testCase('items feedback tokens are exact and source-qualified in every locale', () => {
  const expected = {
    query: {
      invalid_filter: 'items.query.invalid_filter',
      target_required: 'items.query.target_required',
      unsupported_filter: 'items.query.unsupported_filter',
      repeated_filter: 'items.query.repeated_filter',
      invalid_pagination: 'items.query.invalid_pagination',
      invalid_owner: 'items.query.invalid_owner',
      invalid_tags: 'items.query.invalid_tags',
    },
    form: {
      invalid_selection: 'items.bulkForm.invalidSelection',
      invalid_tags: 'items.bulkForm.invalidTags',
      tags_action_mismatch: 'items.bulkForm.tagsActionMismatch',
      owner_action_mismatch: 'items.bulkForm.ownerActionMismatch',
      invalid_owner: 'items.bulkForm.invalidOwner',
      invalid_field_shape: 'items.bulkForm.invalidFieldShape',
      invalid_action: 'items.bulkForm.invalidAction',
      unsupported_fields: 'items.bulkForm.unsupportedFields',
      missing_field: 'items.bulkForm.missingField',
    },
    bulk: {
      forbidden: 'items.bulk.forbidden',
      invalid_selection: 'items.bulk.invalid_selection',
      invalid_state: 'items.bulk.invalid_state',
      owner_not_member: 'items.bulk.owner_not_member',
    },
  } as const;
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    for (const [source, codes] of Object.entries(expected)) {
      for (const [code, id] of Object.entries(codes)) {
        expect(formatError(i18n, source + ':' + code)).toStrictEqual(i18n.t(id));
      }
    }
    const unexpected = i18n.t('items.bulk.unexpected');
    for (
      const token of [
        'invalid_filter',
        'query:invalid_tags:extra',
        'form:future',
        'bulk:invalid_filter',
        'free prose',
      ]
    ) {
      expect(formatError(i18n, token)).toStrictEqual(unexpected);
    }
    for (const value of ['updated:1', 'updated:2', 'updated:100']) {
      expect(formatNotice(i18n, value)).toStrictEqual(
        i18n.t('items.bulk.updated', { count: Number(value.slice(8)) }),
      );
    }
    for (
      const value of [
        'updated:0',
        'updated:01',
        'updated:1.5',
        'updated:-1',
        'updated:101',
        'updated:999',
        'updated:1x',
        '1 item',
      ]
    ) {
      expect(formatNotice(i18n, value)).toStrictEqual(null);
    }
  }
});

testCase('MemberPicker status presenter is localized for every interface locale', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    expect(memberPickerStatus(i18n, 'minLength')).toStrictEqual(
      i18n.t('items.memberPicker.minLength'),
    );
    expect(memberPickerStatus(i18n, 'loading')).toStrictEqual(i18n.t('items.memberPicker.loading'));
    expect(memberPickerStatus(i18n, 'noResults')).toStrictEqual(
      i18n.t('items.memberPicker.noResults'),
    );
    expect(memberPickerStatus(i18n, 'results', 1)).toStrictEqual(
      i18n.t('items.memberPicker.resultCount', { count: 1 }),
    );
    expect(memberPickerStatus(i18n, 'results', 3)).toStrictEqual(
      i18n.t('items.memberPicker.resultCount', { count: 3 }),
    );
    expect(memberPickerStatus(i18n, 'selected', 'Ada')).toStrictEqual(
      i18n.t('items.memberPicker.selected', { label: 'Ada' }),
    );
    expect(memberPickerStatus(i18n, 'failure')).toStrictEqual(i18n.t('items.memberPicker.failure'));
  }
});

testCase(
  'populated item-bank list preserves authored data and localizes cards in all locales',
  () => {
    const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
    const states = ['not_requested', 'open', 'approved', 'changes_requested'] as const;
    const origins = ['Authored', 'Imported', 'Variant'] as const;
    for (const locale of locales) {
      const i18n = createI18n(locale, CATALOGS[locale]);
      const html = renderToString(
        <ItemsIndex
          kind='questions'
          enrichment={{ schemes: [], schemesTruncated: false, selection: null }}
          bankDisplayName={null}
          collectionWorkspace={{
            collections: [],
            operationId: '10000000-0000-4000-8000-000000000001',
            createId: '10000000-0000-4000-8000-000000000002',
          }}
          bank={{
            items: states.map((reviewState, index) => ({
              id: '00000000-0000-4000-8000-00000000000' + (index + 1),
              title: 'Authored title ' + index,
              tags: ['customer-tag'],
              type: 'single_select',
              typeLabel: 'Single select',
              standards: [{ id: 'std', label: 'Customer standard' }],
              origin: origins[index % origins.length],
              owner: { userId: 'owner', label: 'Customer owner' },
              lifecycle: index === 3 ? 'archived' : 'active',
              reviewState,
              revision: index + 1,
              updatedAt: index === 2
                ? 'not-a-date'
                : new Date('2025-01-15T12:00:00Z').toISOString(),
              duplicateCount: index === 3 ? 2 : 1,
              compatibility: [],
            })),
            facets: { tags: [], standards: [], owners: [], types: [], targets: [] },
            total: 4,
            page: 2,
            pageSize: 4,
            pageCount: 3,
          }}
          query={{
            search: '',
            tags: [],
            assignedToMe: false,
            lifecycle: 'active',
            duplicatesOnly: false,
            page: 2,
            pageSize: 4,
          }}
          notice={null}
          error={null}
          canManageContent={false}
          i18n={i18n}
          payload={createI18nPayload(locale, CATALOGS[locale], ['items'])}
        />,
      );
      expect(html).toContain(i18n.t('items.results.total', { count: 4 }));
      expect(html).toContain(i18n.t('items.results.page', { page: 2, pages: 3 }));
      expect(html).toContain(i18n.t('items.results.paginationLabel'));
      expect(html).toContain(i18n.t('items.results.archived'));
      expect(html).toContain(i18n.t('items.results.exactCopy', { count: 2 }));
      expect(html).toContain(i18n.t('items.shared.unavailable'));
      expect(html).toContain(i18n.t('items.review.notReviewed'));
      expect(html).toContain(i18n.t('items.review.inReview'));
      expect(html).toContain(i18n.t('items.review.approved'));
      expect(html).toContain(i18n.t('items.review.changesRequested'));
      for (const origin of origins) {
        expect(html).toContain(i18n.t(
          {
            Authored: 'items.filter.authored',
            Imported: 'items.filter.imported',
            Variant: 'items.filter.variant',
          }[origin],
        ));
      }
      expect(html).toContain('Authored title 0');
      expect(html).toContain('customer-tag');
      expect(html).toContain('Customer standard');
      if (html.includes('<td class="whitespace-nowrap">Customer owner</td>')) {
        expect.unreachable(
          'Expected !html.includes(\'<td class="whitespace-nowrap">Customer owner</td>\')',
        );
      }
      if (html.includes('items.')) expect.unreachable("Expected !html.includes('items.')");
    }
  },
);

testCase('MemberPicker SSR uses an items-only payload and caller hint', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const payload = createI18nPayload(locale, CATALOGS[locale], ['items']);
    const hint = 'Caller-provided hint ' + locale + '.';
    const html = renderToString(
      <MemberPicker name='ownerUserId' label='Owner' hint={hint} payload={payload} />,
    );
    expect(html).toContain(hint);
    expect(html).toContain('aria-live="polite"');
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1] ?? '';
    if (!(describedBy.length > 0)) expect.unreachable('Expected describedBy.length > 0');
    for (const id of describedBy.split(' ')) expect(html).toContain('id="' + id + '"');
    expect(Object.keys(payload.namespaces)).toStrictEqual(['items']);
  }
});

testCase('compatibility summary and date formatting use each request locale', () => {
  const outcomes = ['exact', 'normalized', 'lossy', 'blocked'] as const;
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    const targets = listSelectableAssessmentExportTargets();
    const target = targets.find((candidate) => candidate.id === 'qti3-conformant');
    if (!target) throw new Error('Test target is not registered.');
    const compatibility = outcomes.map((outcome) => ({
      targetId: target.id,
      targetContractId: target.targetContractId,
      outcome,
      diagnosticCodes: [],
    }));
    const selected = renderToString(
      <CompatibilitySummary
        compatibility={compatibility}
        selectedTarget='qti3-conformant'
        targets={targets}
        i18n={i18n}
      />,
    );
    expect(selected).toContain(i18n.t('items.compatibility.selected', { outcome: 'exact' }));
    const aggregate = renderToString(
      <CompatibilitySummary compatibility={compatibility} targets={targets} i18n={i18n} />,
    );
    expect(aggregate).toContain(i18n.t('items.compatibility.summary', {
      exactCount: 1,
      normalizedCount: 1,
      attentionCount: 2,
    }));
    const dateHtml = renderToString(<>{formatBankDate('2025-01-15T12:00:00Z', i18n)}</>);
    expect(dateHtml).toContain('datetime="2025-01-15T12:00:00.000Z"');
    expect(dateHtml).toContain(i18n.formatDate(new Date('2025-01-15T12:00:00Z'), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }));
    expect(dateHtml.includes('(UTC)')).toStrictEqual(false);
    expect(formatBankDate('invalid', i18n)).toStrictEqual(i18n.t('items.shared.unavailable'));
  }
});
