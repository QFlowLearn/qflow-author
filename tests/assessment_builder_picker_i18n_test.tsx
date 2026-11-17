import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import QuestionTypePicker from '../islands/assessment_builder/QuestionTypePicker.tsx';
import { type LibraryItem, parseLibrarySearchResponse } from '../lib/question_bank_picker.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { LibraryResults } from '../islands/assessment_builder/ImportPicker.tsx';
import { formatDeliveryPublishError } from '../islands/assessment_builder/assessment_delivery.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
const emptyEnrichment = { schemes: [], schemesTruncated: false, selection: null };
const itemId = '11111111-1111-4111-8111-111111111111';
const validItem = {
  id: itemId,
  title: 'Éxito ✨',
  excerpt: '',
  tags: ['tag-ñ'],
  latestRev: 2,
  updatedAt: '2026-01-02T03:04:05.000Z',
  type: 'single_select' as const,
};
function searchBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items: [validItem],
    hasMore: false,
    total: 1,
    collections: [],
    enrichment: emptyEnrichment,
    ...overrides,
  };
}
function itemWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...validItem, ...overrides };
}

testCase('question type picker uses visible translated labels and counts', () => {
  const rendered = new Map<string, string>();
  for (const locale of locales) {
    const catalog = catalogForLocale(locale);
    const html = renderToString(
      <I18nProvider payload={{ locale, namespaces: { assessments: catalog.assessments! } }}>
        <QuestionTypePicker
          search=''
          onSearchChange={() => {}}
          onStartAuthoring={() => {}}
          lastType='single_select'
        />
      </I18nProvider>,
    );
    const i18n = createI18n(locale, { assessments: catalog.assessments! });
    expect(html).toContain(i18n.t('assessments.builder.questionTypeSearchLabel'));
    expect(html).toContain(i18n.t('assessments.builder.questionTypeSearch'));
    expect(html).toContain(i18n.t('assessments.builder.questionTypeAvailable', { count: 21 }));
    expect(html).toContain(i18n.t('assessments.builder.category.choice'));
    expect(html).toContain(i18n.t('assessments.builder.questionTypeDescription.single_select'));
    expect(html).toContain('for="assessment-question-type-search"');
    expect(html).toContain(i18n.t('assessments.builder.lastUsed', {
      type: i18n.t('assessments.builder.questionTypeLabel', { type: 'single_select' }),
    }));
    if (html.includes('assessments.builder.')) {
      expect.unreachable("Expected !html.includes('assessments.builder.')");
    }
    rendered.set(locale, html);
  }
  if (!(rendered.get('en-US') !== rendered.get('es-ES'))) {
    expect.unreachable("Expected rendered.get('en-US') !== rendered.get('es-ES')");
  }
});

testCase('library search parser accepts the exact route contract', () => {
  expect(parseLibrarySearchResponse(searchBody())?.items[0]).toStrictEqual(validItem);
  expect(parseLibrarySearchResponse(searchBody({ items: [], total: 0 }))?.total).toStrictEqual(0);
  for (const field of ['items', 'hasMore', 'total', 'collections', 'enrichment']) {
    const missing = searchBody();
    delete missing[field];
    expect(parseLibrarySearchResponse(missing), `missing root ${field}`).toStrictEqual(null);
  }
  expect(parseLibrarySearchResponse(searchBody({ unexpected: 'hostile' }))).toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ hasMore: 'false' }))).toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ total: 0 }))).toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ total: 1.5 }))).toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ total: -1 }))).toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ total: Number.MAX_SAFE_INTEGER + 1 })))
    .toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ total: 0, items: [validItem] }))).toStrictEqual(
    null,
  );
  for (const field of ['id', 'title', 'excerpt', 'tags', 'latestRev', 'updatedAt', 'type']) {
    const item = itemWith({});
    delete item[field];
    expect(parseLibrarySearchResponse(searchBody({ items: [item] })), `missing item ${field}`)
      .toStrictEqual(null);
  }
  expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ extra: true })] })))
    .toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ id: 'bad' })] })))
    .toStrictEqual(null);
  expect(parseLibrarySearchResponse(
    searchBody({ items: [itemWith({ id: '00000000-0000-0111-8111-111111111111' })] }),
  )).toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ items: [validItem, { ...validItem }] })))
    .toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ title: 1 })] }))).toStrictEqual(
    null,
  );
  if (!(parseLibrarySearchResponse(searchBody({ items: [itemWith({ title: '' })] })) !== null)) {
    expect.unreachable(
      "Expected parseLibrarySearchResponse(searchBody({ items: [itemWith({ title: '' })] })) !== null",
    );
  }
  expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ title: 'x'.repeat(2001) })] })))
    .toStrictEqual(null);
  for (const tags of [undefined, null, 'tag', [1], ['x'.repeat(201)], new Array(101).fill('x')]) {
    expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ tags })] }))).toStrictEqual(
      null,
    );
  }
  for (const latestRev of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ latestRev })] })))
      .toStrictEqual(null);
  }
  expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ updatedAt: 'not-a-date' })] })))
    .toStrictEqual(null);
  expect(parseLibrarySearchResponse(
    searchBody({ items: [itemWith({ updatedAt: '2026-01-02T03:04:05Z' })] }),
  )).toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ type: undefined })] })))
    .toStrictEqual(null);
  expect(parseLibrarySearchResponse(searchBody({ items: [itemWith({ type: 'hostile' })] })))
    .toStrictEqual(null);
});

testCase('library result presentation is production-backed in every locale', () => {
  const htmlByLocale = new Map<string, string>();
  for (const locale of locales) {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, { assessments: catalog.assessments! });
    const item: LibraryItem = { ...validItem, title: '', tags: ['Étiquette ✨'] };
    const html = renderToString(
      <I18nProvider payload={{ locale, namespaces: { assessments: catalog.assessments! } }}>
        <LibraryResults
          items={[item]}
          total={1}
          loading={false}
          error={false}
          enrichment={emptyEnrichment}
          selected={[]}
          existingItemIds={new Set()}
          adding={false}
          onToggle={() => {}}
          previewContext={{
            payload: {
              locale: locale,
              namespaces: { assessments: catalogForLocale(locale).assessments! },
            },
            playerCatalog: playerMessageCatalogForLocale(locale),
          }}
        />
      </I18nProvider>,
    );
    expect(html).toContain(i18n.t('assessments.builder.library.results', { count: 1 }));
    expect(html).toContain(i18n.t('assessments.builder.untitledItem'));
    expect(html).toContain('Étiquette');
    expect(html).toContain(
      i18n.formatDate(new Date(validItem.updatedAt), { dateStyle: 'medium', timeZone: 'UTC' }),
    );
    if (html.includes('assessments.builder.')) {
      expect.unreachable("Expected !html.includes('assessments.builder.')");
    }
    if (locale.startsWith('es-')) {
      if (html.includes('Results')) expect.unreachable("Expected !html.includes('Results')");
      if (html.includes('Search library')) {
        expect.unreachable("Expected !html.includes('Search library')");
      }
    }
    htmlByLocale.set(locale, html);
  }
  const empty = renderToString(
    <I18nProvider
      payload={{
        locale: 'en-US',
        namespaces: { assessments: catalogForLocale('en-US').assessments! },
      }}
    >
      <LibraryResults
        items={[]}
        total={0}
        loading={false}
        error={false}
        enrichment={emptyEnrichment}
        selected={[]}
        existingItemIds={new Set()}
        adding={false}
        onToggle={() => {}}
        previewContext={{
          payload: {
            locale: 'en-US',
            namespaces: { assessments: catalogForLocale('en-US').assessments! },
          },
          playerCatalog: playerMessageCatalogForLocale('en-US'),
        }}
      />
    </I18nProvider>,
  );
  expect(empty).toContain('No results');
  expect(empty).toContain('No matches yet');
  const countI18n = createI18n('en-US', { assessments: catalogForLocale('en-US').assessments! });
  const two = countI18n.t('assessments.builder.library.results', { count: 2 });
  expect(two).toContain('2');
  expect(countI18n.t('assessments.builder.library.results', { count: 0 })).toContain('No results');
  const usDate = htmlByLocale.get('en-US')!;
  const gbDate = htmlByLocale.get('en-GB')!;
  if (!(usDate !== gbDate)) expect.unreachable('Expected usDate !== gbDate');
  if (!(htmlByLocale.get('en-US') !== htmlByLocale.get('es-ES'))) {
    expect.unreachable("Expected htmlByLocale.get('en-US') !== htmlByLocale.get('es-ES')");
  }
});

testCase('delivery failure formatter never exposes server prose', () => {
  const i18n = createI18n('es-ES', { assessments: catalogForLocale('es-ES').assessments! });
  const output = formatDeliveryPublishError(i18n, {
    message: 'HOSTILE_MESSAGE',
    setupHint: 'HOSTILE_HINT',
    error: 'HOSTILE_ERROR',
    issues: [{ message: 'HOSTILE_ISSUE' }, 'HOSTILE_ISSUE_TEXT'],
    exception: 'HOSTILE_EXCEPTION',
    qflowTenantId: 'workspace-123',
  }, 'invalidResponse');
  for (
    const marker of [
      'HOSTILE_MESSAGE',
      'HOSTILE_HINT',
      'HOSTILE_ERROR',
      'HOSTILE_ISSUE',
      'HOSTILE_ISSUE_TEXT',
      'HOSTILE_EXCEPTION',
    ]
  ) {
    if (output.includes(marker)) expect.unreachable(`leaked hostile marker: ${marker}`);
  }
  expect(output).toContain('workspace-123');
  expect(output).not.toMatch(/HOSTILE_/i);
});
