import { expect, test as testCase } from 'vitest';

import { INITIAL_ITEM_DETAIL_QUERY } from '../lib/item_detail_query.ts';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { listSelectableAssessmentExportTargets } from '../lib/export/assessment_export_targets.ts';
import { exportTargetLabel } from '../components/item_bank/CompatibilitySummary.tsx';
import { VersionChanges } from '../components/item_bank/VersionChanges.tsx';
import SnapshotView from '../components/item_bank/QuestionSnapshotPage.tsx';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import ItemBankDetailView, {
  type ItemBankDetailViewData,
} from '../components/item_bank/ItemDetailView.tsx';
import { CompatibilitySummary } from '../components/item_bank/CompatibilitySummary.tsx';
import { formatBankDate } from '../components/item_bank/ui.tsx';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'];
const expectedTargetLabels: Record<InterfaceLocale, Record<string, string>> = {
  'sv-SE': {
    'canvas-classic': 'Canvas Classic Quizzes',
    'canvas-new-quizzes': 'Canvas New Quizzes',
    'blackboard-question-banks': 'Frågebanker i Blackboard Learn',
    'brightspace-course-import': 'Kursimport i Brightspace',
    moodle: 'Moodle',
    'qti3-conformant': 'QTI 3.0-provpaket',
    'qti22-standard': 'QTI 2.2-provpaket',
    'qti21-standard': 'QTI 2.1-provpaket',
    'qti12-standard': 'QTI 1.2-provpaket',
  },
  'en-US': {
    'canvas-classic': 'Canvas Classic Quizzes',
    'canvas-new-quizzes': 'Canvas New Quizzes',
    'blackboard-question-banks': 'Blackboard Learn question banks',
    'brightspace-course-import': 'Brightspace course import',
    moodle: 'Moodle',
    'qti3-conformant': 'QTI 3.0 assessment package',
    'qti22-standard': 'QTI 2.2 assessment package',
    'qti21-standard': 'QTI 2.1 assessment package',
    'qti12-standard': 'QTI 1.2 assessment package',
  },
  'en-GB': {
    'canvas-classic': 'Canvas Classic Quizzes',
    'canvas-new-quizzes': 'Canvas New Quizzes',
    'blackboard-question-banks': 'Blackboard Learn question banks',
    'brightspace-course-import': 'Brightspace course import',
    moodle: 'Moodle',
    'qti3-conformant': 'QTI 3.0 assessment package',
    'qti22-standard': 'QTI 2.2 assessment package',
    'qti21-standard': 'QTI 2.1 assessment package',
    'qti12-standard': 'QTI 1.2 assessment package',
  },
  'es-ES': {
    'canvas-classic': 'Cuestionarios de Canvas Classic',
    'canvas-new-quizzes': 'Nuevos cuestionarios de Canvas',
    'blackboard-question-banks': 'Bancos de preguntas de Blackboard Learn',
    'brightspace-course-import': 'Importación de cursos de Brightspace',
    moodle: 'Moodle',
    'qti3-conformant': 'Paquete de evaluación QTI 3.0',
    'qti22-standard': 'Paquete de evaluación QTI 2.2',
    'qti21-standard': 'Paquete de evaluación QTI 2.1',
    'qti12-standard': 'Paquete de evaluación QTI 1.2',
  },
  'es-419': {
    'canvas-classic': 'Cuestionarios de Canvas Classic',
    'canvas-new-quizzes': 'Nuevos cuestionarios de Canvas',
    'blackboard-question-banks': 'Bancos de preguntas de Blackboard Learn',
    'brightspace-course-import': 'Importación de cursos de Brightspace',
    moodle: 'Moodle',
    'qti3-conformant': 'Paquete de evaluación QTI 3.0',
    'qti22-standard': 'Paquete de evaluación QTI 2.2',
    'qti21-standard': 'Paquete de evaluación QTI 2.1',
    'qti12-standard': 'Paquete de evaluación QTI 1.2',
  },
};

testCase('item detail comparison and export labels render from every locale catalog', () => {
  const changes = [
    {
      kind: 'changed' as const,
      category: 'content' as const,
      field: 'promptHtml',
      before: '<old>&',
      after: '<new>&',
    },
    {
      kind: 'changed' as const,
      category: 'answer_and_scoring' as const,
      field: 'correctId',
      before: 'A',
      after: 'B',
    },
    {
      kind: 'changed' as const,
      category: 'standards_and_accessibility' as const,
      field: 'catalogs',
      before: 'old',
      after: 'new',
    },
    {
      kind: 'changed' as const,
      category: 'details' as const,
      field: 'title',
      before: 'Secret <before>',
      after: 'Title <after>',
    },
  ];
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = renderToString(
      <VersionChanges
        i18n={i18n}
        comparison={{ fromRevision: 1, toRevision: 2, changes }}
      />,
    );
    expect(html).toContain(i18n.t('items.detail.change.changed'));
    expect(html).toContain(i18n.t('items.detail.categoryContent'));
    expect(html).toContain(i18n.t('items.detail.categoryAnswerScoring'));
    expect(html).toContain(i18n.t('items.detail.categoryStandardsAccessibility'));
    expect(html).toContain(i18n.t('items.detail.categoryDetails'));
    expect(html).toContain(i18n.t('items.detail.technicalField', { field: 'promptHtml' }));
    expect(html).toContain('&lt;before>');
    expect(html).toContain('&lt;after>');
    if (html.includes('items.detail.')) {
      expect.unreachable("Expected !html.includes('items.detail.')");
    }
    if (locale.startsWith('es-')) {
      if (html.includes('Answer and scoring')) {
        expect.unreachable("Expected !html.includes('Answer and scoring')");
      }
    }
    const empty = renderToString(
      <VersionChanges i18n={i18n} comparison={{ fromRevision: 1, toRevision: 2, changes: [] }} />,
    );
    expect(empty).toContain(i18n.t('items.detail.sameFields'));
    for (const target of listSelectableAssessmentExportTargets()) {
      const label = exportTargetLabel(target.id, i18n);
      if (!(label.length > 3)) expect.unreachable('Expected label.length > 3');
      if (label.includes('items.detail.')) {
        expect.unreachable("Expected !label.includes('items.detail.')");
      }
      if (!(label === expectedTargetLabels[locale][target.id])) {
        expect.unreachable('Expected label === expectedTargetLabels[locale][target.id]');
      }
    }
  }
});

testCase('immutable snapshot uses dedicated fallback labels for every locale', () => {
  const xml =
    '<qti-assessment-item title="SNAPSHOT &amp; TITLE"><qti-item-body>SNAPSHOT &amp; CONTENT</qti-item-body><script>PRIVATE-SNAPSHOT-SECRET</script></qti-assessment-item>';
  const htmlByLocale: Partial<Record<InterfaceLocale, string>> = {};
  for (const locale of locales) {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, catalog);
    const base = {
      itemId: '11111111-1111-4111-8111-111111111111',
      rev: 3,
      payload: createI18nPayload(locale, catalog, ['authoring']),
      playerCatalog: playerMessageCatalogForLocale(locale),
      i18n,
    };
    const titled = renderToString(<SnapshotView {...base} xml={xml} title='SNAPSHOT <TITLE>' />);
    expect(titled).toContain('SNAPSHOT &lt;TITLE>');
    expect(titled).toContain('SNAPSHOT &amp;amp; CONTENT');
    expect(titled).toContain(i18n.t('items.detail.identifier'));
    expect(titled).toContain(i18n.t('items.results.revision', { revision: 3 }));
    expect(titled).toContain(i18n.t('items.detail.open'));
    expect(titled).toContain(i18n.t('items.snapshot.downloadXml'));
    expect(titled).toContain(i18n.t('items.snapshot.sourceXml'));
    if (!(titled.includes('11111111-1111-4111-8111-111111111111'))) {
      expect.unreachable("Expected titled.includes('11111111-1111-4111-8111-111111111111')");
    }
    if (!(titled.includes('SNAPSHOT &amp;amp; CONTENT'))) {
      expect.unreachable("Expected titled.includes('SNAPSHOT &amp;amp; CONTENT')");
    }
    if (titled.includes('<script>')) {
      expect.unreachable("Expected !titled.includes('<script>')");
    }
    if (!(base.payload.locale === locale && base.playerCatalog.locale === locale)) {
      expect.unreachable(
        'Expected base.payload.locale === locale && base.playerCatalog.locale === locale',
      );
    }
    const untitled = renderToString(<SnapshotView {...base} xml={xml} title={null} />);
    expect(untitled).toContain(i18n.t('items.snapshot.untitled'));
    const unavailable = renderToString(<SnapshotView {...base} xml={null} title={null} />);
    expect(unavailable).toContain(i18n.t('items.snapshot.revisionUnavailable'));
    if (unavailable.includes(i18n.t('items.list.title'))) {
      expect.unreachable("Expected !unavailable.includes(i18n.t('items.list.title'))");
    }
    if (unavailable.includes('items.snapshot.')) {
      expect.unreachable("Expected !unavailable.includes('items.snapshot.')");
    }
    if (locale.startsWith('es-')) {
      if (unavailable.includes('This revision is unavailable.')) {
        expect.unreachable("Expected !unavailable.includes('This revision is unavailable.')");
      }
    }
    htmlByLocale[locale] = titled;
    if (locale.startsWith('es-')) {
      for (
        const english of [
          'Item ID',
          'Open',
          'Download QTI XML',
          'Source QTI XML',
          'This revision is unavailable.',
        ]
      ) {
        if (titled.includes(english)) expect.unreachable('Expected !titled.includes(english)');
      }
    }
  }
  expect(htmlByLocale['en-US']).not.toStrictEqual(htmlByLocale['es-ES']);
});

testCase('populated item detail localizes management and authored data in every locale', () => {
  const xml =
    '<qti-assessment-item title="AUTHORED&lt;TITLE&amp;"><qti-item-body>AUTHORED&lt;XML&amp;</qti-item-body></qti-assessment-item>';
  const timestamp = '2026-07-04T12:00:00.000Z';
  const detail = {
    id: 'item-sentinel',
    title: 'AUTHORED<TITLE>&',
    tags: ['TAG-SENTINEL<script>'],
    type: 'single_select' as const,
    typeLabel: 'PRIVATE-SERVICE-SECRET',
    standards: [{ id: 'STD', label: 'STANDARD-SENTINEL<script>' }],
    origin: 'Authored' as const,
    owner: { userId: 'user-1', label: 'OWNER-SENTINEL' },
    lifecycle: 'active' as const,
    reviewState: 'open' as const,
    revision: 2,
    updatedAt: timestamp,
    duplicateCount: 2,
    compatibility: listSelectableAssessmentExportTargets().map((target, index) => ({
      targetId: target.id,
      targetContractId: target.targetContractId,
      outcome: (['exact', 'normalized', 'lossy', 'blocked'] as const)[index % 4],
      diagnosticCodes: [],
    })),
    duplicateItems: [{ id: 'dup-1', title: 'DUPLICATE<TITLE>&' }],
    duplicateItemCount: 2,
  };
  const history = {
    questionId: 'item-sentinel',
    origin: { _tag: 'Authored' as const },
    createdBy: { id: 'user-1', displayName: 'OWNER-SENTINEL', email: 'owner@example.com' },
    latest: { revision: 2, qtiXml: xml, body: { title: 'AUTHORED-TITLE' } },
    revisions: [{
      id: 'revision-2',
      questionId: 'item-sentinel',
      revision: 2,
      note: 'NOTE<SENTINEL>&',
      createdAt: timestamp,
      event: {
        operation: 'revised' as const,
        author: { id: 'user-1', displayName: 'OWNER-SENTINEL', email: 'owner@example.com' },
        parentRevision: 1,
        contentBasis: 'qflow' as const,
      },
      draftState: 'draft' as const,
      publishedAt: null,
    }],
    beforeRevision: 3,
    nextBeforeRevision: 1,
  };
  const reviews = {
    questionId: 'item-sentinel',
    latestRevisionId: 'revision-2',
    latestRevision: 2,
    requests: [{
      id: 'request-1',
      revisionId: 'revision-2',
      revision: 2,
      requestedBy: 'user-1',
      reviewer: { userId: 'user-1', label: 'REVIEWER-SENTINEL' },
      state: 'open' as const,
      requestedAt: timestamp,
      decidedAt: null,
      decidedBy: null,
      changeReason: null,
      approvalIndependence: null,
      decisionNote: 'DECISION<NOTE>&',
      comments: [{
        id: 'comment-1',
        author: { userId: 'reviewer-1', label: 'COMMENT-AUTHOR' },
        body: 'COMMENT <AUTHORED>',
        createdAt: timestamp,
      }],
      beforeCommentId: 'comment-0',
      nextBeforeCommentId: 'comment-2',
    }],
    beforeRevision: 3,
    nextBeforeRevision: 1,
  };
  for (const locale of locales) {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, catalog);
    const data: ItemBankDetailViewData = {
      query: INITIAL_ITEM_DETAIL_QUERY,
      id: 'item-sentinel',
      xml,
      title: 'AUTHORED<TITLE>&',
      history,
      detail,
      reviews,
      currentUserId: 'user-1',
      canManageContent: true,
      comparison: {
        fromRevision: 1,
        toRevision: 2,
        beforeXml: '<qti-assessment-item/>',
        afterXml: '<qti-assessment-item/>',
        changes: [
          {
            kind: 'changed' as const,
            category: 'content',
            field: 'promptHtml',
            before: 'BEFORE',
            after: 'AFTER',
          },
          {
            kind: 'changed' as const,
            category: 'answer_and_scoring',
            field: 'correctId',
            before: 'A',
            after: 'B',
          },
          {
            kind: 'changed' as const,
            category: 'standards_and_accessibility',
            field: 'catalogs',
            before: 'OLD',
            after: 'NEW',
          },
          {
            kind: 'changed' as const,
            category: 'details',
            field: 'title',
            before: 'OLD TITLE',
            after: 'AUTHORED-TITLE',
          },
        ],
      },
      notice: 'LOCALIZED-NOTICE-SENTINEL',
      error: 'LOCALIZED-ERROR-SENTINEL',
      previewPayload: createI18nPayload(locale, catalog, ['authoring']),
      memberPickerPayload: createI18nPayload(locale, catalog, ['items']),
      playerCatalog: playerMessageCatalogForLocale(locale),
    };
    const html = renderToString(<ItemBankDetailView {...data} />);
    expect(html).toContain(i18n.t('items.detail.bankDetails'));
    expect(html).toContain(i18n.t('items.detail.comparison'));
    expect(html).toContain(i18n.t('items.detail.review'));
    expect(html).toContain('LOCALIZED-NOTICE-SENTINEL');
    expect(html).toContain('LOCALIZED-ERROR-SENTINEL');
    if (!(countOccurrences(html, 'LOCALIZED-NOTICE-SENTINEL') === 1)) {
      expect.unreachable("Expected countOccurrences(html, 'LOCALIZED-NOTICE-SENTINEL') === 1");
    }
    if (!(countOccurrences(html, 'LOCALIZED-ERROR-SENTINEL') === 1)) {
      expect.unreachable("Expected countOccurrences(html, 'LOCALIZED-ERROR-SENTINEL') === 1");
    }
    for (
      const id of [
        'items.detail.back',
        'items.detail.questionType',
        'items.results.revision',
        'items.detail.originAuthored',
        'items.detail.createRevision',
        'items.detail.download',
        'items.detail.compareHelp',
        'items.detail.earlierRevision',
        'items.detail.compareRevisions',
        'items.detail.assignedTo',
        'items.detail.decisionNote',
        'items.detail.addComment',
        'items.detail.comment',
        'items.detail.changesPlaceholder',
        'items.detail.approve',
        'items.detail.requestChanges',
        'items.detail.reviewHistory',
        'items.detail.latestComments',
        'items.detail.olderComments',
        'items.detail.latestReviews',
        'items.detail.olderReviews',
        'items.detail.canonicalSource',
        'items.detail.owner',
        'items.detail.source',
        'items.detail.state',
        'items.detail.updated',
        'items.detail.transferOwnership',
        'items.detail.transfer',
        'items.detail.archive',
        'items.detail.exactDuplicates',
        'items.detail.duplicateHelp',
        'items.detail.history',
        'items.detail.historyDescription',
        'items.detail.originHeading',
        'items.detail.revisionsHeading',
        'items.detail.historyPages',
        'items.detail.latestRevisions',
        'items.detail.olderRevisions',
      ]
    ) {
      expect(html).toContain(i18n.t(id, {
        revision: 2,
        name: 'REVIEWER-SENTINEL',
        count: 1,
        type: 'single_select',
        outcome: 'exact',
        field: 'title',
        date: timestamp,
      }));
    }
    expect(html).toContain(renderToString(<>{formatBankDate(timestamp, i18n)}</>));
    expect(html).toContain('AUTHORED&lt;TITLE>');
    expect(html).toContain('TAG-SENTINEL&lt;script>');
    expect(html).toContain('STANDARD-SENTINEL&lt;script>');
    expect(html).toContain('REVIEWER-SENTINEL');
    expect(html).toContain('COMMENT &lt;AUTHORED>');
    expect(html).toContain('DECISION&lt;NOTE>');
    expect(html).toContain('NOTE&lt;SENTINEL>');
    expect(html).toContain('DUPLICATE&lt;TITLE>');
    expect(html).toContain('AUTHORED');
    if (html.includes('<secret>')) expect.unreachable("Expected !html.includes('<secret>')");
    expect(html).toContain(i18n.t('items.detail.latestComments'));
    expect(html).toContain(i18n.t('items.detail.olderComments'));
    expect(html).toContain(i18n.t('items.detail.latestReviews'));
    expect(html).toContain(i18n.t('items.detail.olderReviews'));
    expect(html).toContain(i18n.t('items.detail.showingDuplicates', { shown: 1, total: 2 }));
    if (html.includes(i18n.t('items.detail.exportResults'))) {
      expect.unreachable("Expected !html.includes(i18n.t('items.detail.exportResults'))");
    }
    if (html.includes('items.detail.')) {
      expect.unreachable("Expected !html.includes('items.detail.')");
    }
    if (html.includes('PRIVATE-SERVICE-SECRET')) {
      expect.unreachable("Expected !html.includes('PRIVATE-SERVICE-SECRET')");
    }
    if (locale.startsWith('es-')) {
      if (html.includes('Bank details')) {
        expect.unreachable("Expected !html.includes('Bank details')");
      }
    }
  }
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

testCase('minimal item detail omits manager-only controls in every locale', () => {
  for (const locale of locales) {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, catalog);
    const html = renderToString(
      <ItemBankDetailView
        query={INITIAL_ITEM_DETAIL_QUERY}
        id='item-minimal'
        xml='<xml />'
        title='Minimal'
        detail={{
          id: 'item-minimal',
          title: 'Minimal',
          tags: [],
          type: 'single_select',
          typeLabel: 'unused',
          standards: [],
          origin: 'Authored',
          owner: { userId: 'u', label: 'Owner' },
          lifecycle: 'archived',
          reviewState: 'not_requested',
          revision: 1,
          updatedAt: 'invalid',
          duplicateCount: 0,
          compatibility: [],
          duplicateItems: [],
          duplicateItemCount: 0,
        }}
        history={{
          questionId: 'item-minimal',
          origin: { _tag: 'Authored' },
          createdBy: { id: 'u', displayName: 'Owner', email: 'o@example.com' },
          latest: { revision: 1, qtiXml: '<xml />', body: { title: 'Minimal' } },
          revisions: [],
          beforeRevision: null,
          nextBeforeRevision: null,
        }}
        reviews={{
          questionId: 'item-minimal',
          latestRevisionId: 'r',
          latestRevision: 1,
          requests: [],
          beforeRevision: null,
          nextBeforeRevision: null,
        }}
        currentUserId='u'
        canManageContent={false}
        comparison={null}
        notice={null}
        error={null}
        previewPayload={createI18nPayload(locale, catalog, ['authoring'])}
        memberPickerPayload={createI18nPayload(locale, catalog, ['items'])}
        playerCatalog={playerMessageCatalogForLocale(locale)}
      />,
    );
    if (html.includes(i18n.t('items.detail.comparison'))) {
      expect.unreachable("Expected !html.includes(i18n.t('items.detail.comparison'))");
    }
    expect(html).toContain(i18n.t('items.detail.noReview'));
    if (html.includes(i18n.t('items.detail.transferOwnership'))) {
      expect.unreachable("Expected !html.includes(i18n.t('items.detail.transferOwnership'))");
    }
    if (html.includes('items.detail.')) {
      expect.unreachable("Expected !html.includes('items.detail.')");
    }
  }
});

testCase('compatibility summary renders selected and aggregate outcomes in every locale', () => {
  const targets = listSelectableAssessmentExportTargets();
  const compatibility = targets.map((target, index) => ({
    targetId: target.id,
    targetContractId: target.targetContractId,
    outcome: (['exact', 'normalized', 'lossy', 'blocked'] as const)[index % 4],
    diagnosticCodes: [],
  }));
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const aggregate = renderToString(
      <CompatibilitySummary compatibility={compatibility} targets={targets} i18n={i18n} />,
    );
    expect(aggregate).toContain(i18n.t('items.compatibility.exportProfiles'));
    expect(aggregate).toContain(i18n.t('items.compatibility.summary', {
      exactCount: 3,
      normalizedCount: 2,
      attentionCount: 4,
    }));
    for (const entry of compatibility) {
      const selected = renderToString(
        <CompatibilitySummary
          compatibility={compatibility}
          targets={targets}
          selectedTarget={entry.targetId}
          i18n={i18n}
        />,
      );
      expect(selected).toContain(expectedTargetLabels[locale][entry.targetId]);
      expect(selected).toContain(
        i18n.t('items.compatibility.selected', { outcome: entry.outcome }),
      );
    }
  }
});
