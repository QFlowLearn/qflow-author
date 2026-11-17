import { expect, test as testCase } from 'vitest';

import { INITIAL_ITEM_DETAIL_QUERY } from '../lib/item_detail_query.ts';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { MigrationItemPreview } from '../components/imports/migration_item_preview.tsx';
import ItemView from '../components/item_bank/ItemDetailView.tsx';
import SnapshotView from '../components/item_bank/QuestionSnapshotPage.tsx';
import QtiItemPreview from '../islands/QtiItemPreview.tsx';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const xml = exportQti3AssessmentItemXml(
  'single_select',
  prepareDriverDraftForBuild('single_select', {
    ...TYPE_DRIVERS.single_select.defaults(),
    itemLanguage: newAuthoringItemLanguage(),
  }),
  { identifier: 'item-preview-render-test' },
);

testCase('item latest page renders qti3 preview before XML source', () => {
  const timestamp = new Date(0).toISOString();
  const event = {
    operation: 'created' as const,
    author: { id: 'user-1', displayName: 'Ada Author', email: 'ada@example.com' },
    parentRevision: null,
    contentBasis: 'qflow' as const,
  };
  const html = renderToString(
    <ItemView
      query={INITIAL_ITEM_DETAIL_QUERY}
      id='item-1'
      xml={xml}
      title='Preview Item'
      history={{
        questionId: 'item-1',
        origin: { _tag: 'Authored' },
        createdBy: event.author,
        latest: { revision: 1, qtiXml: xml, body: { title: 'Preview Item' } },
        revisions: [{
          id: 'revision-1',
          questionId: 'item-1',
          revision: 1,
          note: null,
          createdAt: timestamp,
          event,
          draftState: 'published',
          publishedAt: timestamp,
        }],
        beforeRevision: null,
        nextBeforeRevision: null,
      }}
      detail={{
        id: 'item-1',
        title: 'Preview Item',
        tags: [],
        type: 'single_select',
        typeLabel: 'Single select',
        standards: [],
        origin: 'Authored',
        owner: { userId: 'user-1', label: 'Ada Author' },
        lifecycle: 'active',
        reviewState: 'not_requested',
        revision: 1,
        updatedAt: timestamp,
        duplicateCount: 1,
        compatibility: [],
        duplicateItems: [],
        duplicateItemCount: 0,
      }}
      reviews={{
        questionId: 'item-1',
        latestRevisionId: 'revision-1',
        latestRevision: 1,
        requests: [],
        beforeRevision: null,
        nextBeforeRevision: null,
      }}
      currentUserId='user-1'
      canManageContent
      comparison={null}
      notice={null}
      error={null}
      previewPayload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}
      memberPickerPayload={createI18nPayload('en-US', catalogForLocale('en-US'), ['items'])}
      playerCatalog={playerMessageCatalogForLocale('en-US')}
    />,
  );

  expect(html).toContain('data-qti-preview-host="true"');
  expect(html).toContain('Preview Item');
  expect(html).toContain('Download QTI 3');
  expect(html).toContain('Canonical QTI 3 source');
});

testCase('item revision page renders qti3 preview and keeps XML download', () => {
  const html = renderToString(
    <SnapshotView
      itemId='item-1'
      rev={2}
      xml={xml}
      title='Preview Revision'
      payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}
      playerCatalog={playerMessageCatalogForLocale('en-US')}
      i18n={createI18n('en-US', catalogForLocale('en-US'))}
    />,
  );

  expect(html).toContain('data-qti-preview-host="true"');
  expect(html).toContain('Preview Revision — Revision 2');
  expect(html).toContain('Download QTI XML');
});

testCase('migration item preview renders qti3 preview island from imported draft', () => {
  const draft = prepareDriverDraftForBuild(
    'single_select',
    {
      ...TYPE_DRIVERS.single_select.defaults(),
      itemLanguage: newAuthoringItemLanguage(),
    },
  );
  const html = renderToString(
    <MigrationItemPreview
      i18n={createI18n('en-US', catalogForLocale('en-US'))}
      payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}
      playerCatalog={playerMessageCatalogForLocale('en-US')}
      item={{
        id: 'migration-item-1',
        runId: 'run-1',
        sourceHref: 'items/item.xml',
        sourceIdentifier: 'source-item-1',
        title: draft.title ?? 'Preview Item',
        itemType: 'single_select',
        itemTypeLabel: 'Single select',
        position: 1,
        readiness: 'ready',
        warnings: [],
        sourceXml: xml,
        importedDraft: parsePersistedDraft(draft, 'single_select'),
        blueprintTargetId: null,
        reviewSuggestions: [],
        decision: 'pending',
        evidence: [],
        extractionUncertainties: [],
        contentHash: 'content',
        contextHash: 'context',
        createdAt: new Date(0).toISOString(),
      }}
    />,
  );

  expect(html).toContain('data-qti-preview-host="true"');
  expect(html).toContain(draft.title ?? 'Preview Item');
});

const PREVIEW_LOCALES: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('qti preview SSR uses the complete four-locale authoring contract', () => {
  const rendered = new Map<InterfaceLocale, string>();
  for (const locale of PREVIEW_LOCALES) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const playerCatalog = playerMessageCatalogForLocale(locale);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderToString(
      <QtiItemPreview
        xml={xml}
        payload={payload}
        playerCatalog={playerCatalog}
      />,
    );
    rendered.set(locale, html);

    expect(Object.keys(payload.namespaces)).toStrictEqual(['authoring']);
    expect(playerCatalog.locale).toStrictEqual(locale);
    for (
      const id of [
        'preview.label',
        'preview.untitled',
        'preview.loading',
        'preview.check',
        'preview.resetButton',
      ]
    ) {
      expect(html).toContain(i18n.t(id));
      if (locale.startsWith('es-')) expect(html.includes(id)).toStrictEqual(false);
    }
    expect(html).toContain(i18n.t('preview.responseChanges', { count: 0 }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-qti-preview-host="true"');
    expect(html.includes('preview.')).toStrictEqual(false);

    const hostileTitle = '<script>alert("x")</script>';
    const titledHtml = renderToString(
      <QtiItemPreview
        xml={xml}
        title={hostileTitle}
        payload={payload}
        playerCatalog={playerCatalog}
      />,
    );
    expect(titledHtml).toContain('&lt;script>alert(&quot;x&quot;)&lt;/script>');
    expect(titledHtml.includes(hostileTitle)).toStrictEqual(false);
    expect(
      i18n.t('preview.responseChanges', { count: 1 }) ===
        i18n.t('preview.responseChanges', { count: 3 }),
    ).toStrictEqual(false);
  }

  expect(rendered.get('en-US') === rendered.get('es-ES')).toStrictEqual(false);
});

testCase('qti preview rejects a mismatched app and player locale', () => {
  const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);
  expect(() =>
    renderToString(
      <QtiItemPreview
        xml={xml}
        payload={payload}
        playerCatalog={playerMessageCatalogForLocale('es-ES')}
      />,
    )
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('Preview locale and player catalog locale must match.')
    ),
  );
});
