import { expect, test as testCase } from 'vitest';

import { formatTimestamp } from '../lib/i18n/dates.ts';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import QuestionRevisionHistoryView from '../components/QuestionRevisionHistory.tsx';
import type { QuestionRevisionHistory } from '../lib/services/questions.ts';
import { CATALOGS } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';

const HASH = 'a'.repeat(64);

testCase(
  'AI import history localizes both generation modes and accepted review in every locale',
  () => {
    const history: QuestionRevisionHistory = {
      questionId: 'question-1',
      createdBy: {
        id: 'author-1',
        displayName: 'Avery Author',
        email: 'avery@example.com',
      },
      origin: {
        _tag: 'Imported',
        artifact: {
          id: 'artifact-1',
          filename: 'source.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 2048,
          sha256: HASH,
        },
        migrationRunId: 'run-1',
        migrationItemId: 'migration-item-1',
        href: 'generated/question-1.xml',
        identifier: 'generated-1',
        providedBy: {
          id: 'author-1',
          displayName: 'Avery Author',
          email: 'avery@example.com',
        },
        assistance: {
          _tag: 'AiGenerated',
          jobId: 'job-1',
          generation: {
            provider: 'openrouter_chat_completions',
            model: 'example/model',
            mode: 'thorough',
            promptVersion: 'qflow.assessment-generation.v1',
          },
        },
        evidence: [{
          kind: 'page',
          artifactId: 'normalized-artifact-1',
          artifactHash: HASH,
          page: 4,
          quote: 'Tectonic plates move slowly across the mantle.',
        }],
        review: {
          decision: 'accepted',
          reviewer: {
            id: 'reviewer-1',
            displayName: 'Riley Reviewer',
            email: 'riley@example.com',
          },
          reviewedAt: '2026-07-30T13:30:00.000Z',
          note: 'The answer is supported by the cited page.',
          contentHash: HASH,
          contextHash: HASH,
        },
      },
      latest: {
        revision: 2,
        qtiXml: '<qti-assessment-item/>',
        body: { title: 'Plate motion', apiToken: 'secret-that-must-not-render' },
      },
      revisions: [
        {
          id: 'revision-2',
          questionId: 'question-1',
          revision: 2,
          note: 'Adjusted the distractor wording.',
          createdAt: '2022-02-02T12:00:00.000Z',
          publishedAt: null,
          draftState: 'draft',
          event: {
            operation: 'revised',
            author: {
              id: 'author-1',
              displayName: 'Avery Author',
              email: 'avery@example.com',
            },
            parentRevision: 1,
            contentBasis: 'qflow',
          },
        },
        {
          id: 'revision-1',
          questionId: 'question-1',
          revision: 1,
          note: null,
          createdAt: '2020-01-01T12:00:00.000Z',
          publishedAt: '2021-01-01T12:00:00.000Z',
          draftState: 'published',
          event: {
            operation: 'created',
            author: {
              id: 'author-1',
              displayName: 'Avery Author',
              email: 'avery@example.com',
            },
            parentRevision: null,
            contentBasis: 'source',
          },
        },
      ],
      beforeRevision: null,
      nextBeforeRevision: null,
    };

    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
      const i18n = createI18n(locale, CATALOGS[locale]);
      const html = renderToString(<QuestionRevisionHistoryView history={history} i18n={i18n} />);
      expect(html).toContain(i18n.t('items.detail.history'));
      expect(html).toContain(i18n.t('items.detail.aiGeneration'));
      expect(html).toContain('source.docx');
      expect(html).toContain('OpenRouter');
      expect(html).toContain('example/model');
      expect(html).toContain('qflow.assessment-generation.v1');
      expect(html).toContain('job-1');
      expect(html).toContain('Avery Author');
      expect(html).toContain('Riley Reviewer');
      expect(html).toContain(i18n.t('items.detail.evidencePage', { page: 4 }));
      expect(html).toContain('Tectonic plates move slowly across the mantle.');
      expect(html.replace(/<[^>]*>/g, '')).toContain(i18n.t('items.detail.reviewAcceptedByOn', {
        name: 'Riley Reviewer',
        date: formatTimestamp(new Date('2026-07-30T13:30:00.000Z'), locale, 'UTC'),
      }));
      expect(html).toContain(i18n.t('items.detail.modeThorough'));
      if (history.origin._tag === 'Imported' && history.origin.assistance._tag === 'AiGenerated') {
        const fastHistory: QuestionRevisionHistory = {
          ...history,
          origin: {
            ...history.origin,
            assistance: {
              ...history.origin.assistance,
              jobId: 'FAST-JOB-SENTINEL',
              generation: { ...history.origin.assistance.generation, mode: 'fast' },
            },
          },
        };
        const fastHtml = renderToString(
          <QuestionRevisionHistoryView history={fastHistory} i18n={i18n} />,
        );
        expect(fastHtml).toContain(i18n.t('items.detail.modeFast'));
        expect(fastHtml).toContain('FAST-JOB-SENTINEL');
      }
      expect(html.includes('secret-that-must-not-render')).toStrictEqual(false);
      expect(html.includes('storageKey')).toStrictEqual(false);
      expect(html.includes('items.detail.')).toStrictEqual(false);
    }
  },
);

testCase('variant history localizes lineage and type labels in every locale', () => {
  const history: QuestionRevisionHistory = {
    questionId: 'variant-question',
    createdBy: {
      id: 'author-1',
      displayName: 'Avery Author',
      email: 'avery@example.com',
    },
    origin: {
      _tag: 'Variant',
      source: { questionId: 'source-question', revision: 3 },
      transformation: {
        kind: 'compatible_type_transform',
        fromType: 'single_select',
        toType: 'multi_select',
      },
    },
    latest: { revision: 1, qtiXml: '<qti-assessment-item/>', body: {} },
    revisions: [{
      id: 'revision-1',
      questionId: 'variant-question',
      revision: 1,
      note: null,
      createdAt: '2026-08-04T12:00:00.000Z',
      publishedAt: '2026-08-04T12:00:00.000Z',
      draftState: 'published',
      event: {
        operation: 'created',
        author: { id: 'author-1', displayName: 'Avery Author', email: 'avery@example.com' },
        parentRevision: null,
        contentBasis: 'qflow',
      },
    }],
    beforeRevision: null,
    nextBeforeRevision: null,
  };

  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    const html = renderToString(<QuestionRevisionHistoryView history={history} i18n={i18n} />);
    expect(html).toContain(i18n.t('items.detail.variantLineage'));
    expect(html).toContain('source-question');
    expect(html).toContain(
      i18n.t('items.detail.variantCreatedFrom', { revision: 3, id: 'source-question' }),
    );
    expect(html).toContain(i18n.t('items.detail.questionType', { type: 'single_select' }));
    expect(html).toContain(i18n.t('items.detail.questionType', { type: 'multi_select' }));
    expect(html.includes('items.detail.')).toStrictEqual(false);
    if (locale.startsWith('es')) {
      expect(html.includes('Revision 3 of question')).toStrictEqual(false);
    }
  }
});

testCase(
  'history localizes valid and invalid timestamps, draft/published facts, parents, and paging',
  () => {
    const history: QuestionRevisionHistory = {
      questionId: 'question-1',
      origin: { _tag: 'Authored' },
      createdBy: {
        id: 'author-1',
        displayName: 'Avery Author',
        email: 'avery@example.com',
      },
      latest: { revision: 30, qtiXml: '<qti-assessment-item/>', body: {} },
      revisions: [{
        id: 'revision-30',
        questionId: 'question-1',
        revision: 30,
        note: null,
        createdAt: '2026-08-05T12:00:00.000Z',
        publishedAt: null,
        draftState: 'draft',
        event: {
          operation: 'revised',
          author: { id: 'author-1', displayName: 'Avery Author', email: 'avery@example.com' },
          parentRevision: 24,
          contentBasis: 'qflow',
        },
      }, {
        id: 'revision-29',
        questionId: 'question-1',
        revision: 29,
        note: null,
        createdAt: '2020-01-01T12:00:00.000Z',
        publishedAt: '2026-07-04T12:00:00.000Z',
        draftState: 'published',
        event: {
          operation: 'created',
          author: { id: 'author-1', displayName: 'Avery Author', email: 'avery@example.com' },
          parentRevision: null,
          contentBasis: 'qflow',
        },
      }, {
        id: 'revision-28',
        questionId: 'question-1',
        revision: 28,
        note: null,
        createdAt: 'not-a-date',
        publishedAt: null,
        draftState: 'draft',
        event: {
          operation: 'created',
          author: { id: 'author-1', displayName: 'Avery Author', email: 'avery@example.com' },
          parentRevision: null,
          contentBasis: 'qflow',
        },
      }],
      beforeRevision: 30,
      nextBeforeRevision: 20,
    };
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
      const i18n = createI18n(locale, CATALOGS[locale]);
      const html = renderToString(<QuestionRevisionHistoryView history={history} i18n={i18n} />);
      for (
        const id of [
          'savedBy',
          'savedOn',
          'publishedBy',
          'publishedOn',
          'stateDraft',
          'statePublished',
          'revised',
          'created',
          'parentRevision',
          'none',
          'unavailable',
          'latestRevisions',
          'olderRevisions',
        ]
      ) expect(html).toContain(i18n.t(`items.detail.${id}`));
      expect(html).toContain('/items/question-1#item-history-heading');
      expect(html).toContain('/items/question-1?historyBefore=20#item-history-heading');
      expect(html).toContain(formatTimestamp(new Date('2026-08-05T12:00:00.000Z'), locale, 'UTC'));
      expect(html).toContain(formatTimestamp(new Date('2026-07-04T12:00:00.000Z'), locale, 'UTC'));
      expect(html.includes(formatTimestamp(new Date('2020-01-01T12:00:00.000Z'), locale, 'UTC')))
        .toStrictEqual(false);
      expect(html.includes('items.detail.')).toStrictEqual(false);
      if (locale.startsWith('es')) {
        for (const phrase of ['Published by', 'Saved by', 'Latest revisions']) {
          expect(html.includes(phrase)).toStrictEqual(false);
        }
      }
    }
  },
);

testCase('history empty state is localized in every locale', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    const html = renderToString(<QuestionRevisionHistoryView history={null} i18n={i18n} />);
    expect(html).toContain(i18n.t('items.detail.history'));
    expect(html).toContain(i18n.t('items.detail.noHistory'));
    if (locale.startsWith('es')) expect(html.includes('Item history')).toStrictEqual(false);
  }
});

testCase('authored history localizes origin and revision facts in every locale', () => {
  const history: QuestionRevisionHistory = {
    questionId: 'sentinel-question',
    origin: { _tag: 'Authored' },
    createdBy: { id: 'author', displayName: 'Authored Sentinel', email: 'sentinel@example.test' },
    latest: { revision: 1, qtiXml: '<qti/>', body: {} },
    revisions: [{
      id: 'revision-1',
      questionId: 'sentinel-question',
      revision: 1,
      note: 'Authored note',
      createdAt: 'not-a-date',
      publishedAt: null,
      draftState: 'draft',
      event: {
        operation: 'created',
        author: { id: 'author', displayName: 'Authored Sentinel', email: 'sentinel@example.test' },
        parentRevision: null,
        contentBasis: 'qflow',
      },
    }],
    beforeRevision: null,
    nextBeforeRevision: null,
  };
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    const html = renderToString(<QuestionRevisionHistoryView history={history} i18n={i18n} />);
    for (
      const id of [
        'history',
        'historyDescription',
        'originHeading',
        'originSource',
        'authoringMethod',
        'writtenInQflow',
        'revisionsHeading',
        'stateDraft',
        'created',
        'savedBy',
        'savedOn',
        'parentRevision',
        'none',
        'revisionNote',
        'unavailable',
      ]
    ) expect(html).toContain(i18n.t(`items.detail.${id}`));
    expect(html).toContain(i18n.t('items.detail.authoredOrigin', { name: 'Authored Sentinel' }));
    expect(html.includes('items.detail.')).toStrictEqual(false);
    expect(html).toContain('Authored Sentinel');
    expect(html).toContain('Authored note');
    expect(html).toContain(i18n.t('items.detail.unavailable'));
    if (locale.startsWith('es')) expect(html.includes('Saved by')).toStrictEqual(false);
  }
});

testCase(
  'deterministic import history localizes framing and preserves adapter facts in every locale',
  () => {
    const history: QuestionRevisionHistory = {
      questionId: 'det-question',
      createdBy: { id: 'creator', displayName: 'Creator Sentinel', email: 'creator@example.test' },
      origin: {
        _tag: 'Imported',
        artifact: {
          id: 'artifact',
          filename: 'SOURCE-FILE-SENTINEL',
          mimeType: 'text/plain',
          size: 1,
          sha256: HASH,
        },
        migrationRunId: 'run',
        migrationItemId: 'migration',
        href: '/source/path',
        identifier: 'source-id',
        providedBy: {
          id: 'provider',
          displayName: 'Provider Sentinel',
          email: 'provider@example.test',
        },
        assistance: {
          _tag: 'DeterministicImport',
          adapter: {
            id: 'ADAPTER-ID-SENTINEL',
            label: 'ADAPTER-LABEL-SENTINEL',
            version: 'ADAPTER-VERSION-SENTINEL',
          },
        },
        evidence: [{
          kind: 'block',
          artifactId: 'artifact',
          artifactHash: HASH,
          blockId: 'BLOCK-SENTINEL',
          quote: 'QUOTE-SENTINEL',
        }],
        review: {
          decision: 'accepted',
          reviewer: {
            id: 'reviewer',
            displayName: 'Reviewer Sentinel',
            email: 'reviewer@example.test',
          },
          reviewedAt: '2026-01-01T00:00:00.000Z',
          note: null,
          contentHash: HASH,
          contextHash: HASH,
        },
      },
      latest: { revision: 1, qtiXml: '<qti/>', body: {} },
      revisions: [{
        id: 'revision',
        questionId: 'det-question',
        revision: 1,
        note: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        publishedAt: null,
        draftState: 'draft',
        event: {
          operation: 'created',
          author: { id: 'creator', displayName: 'Creator Sentinel', email: 'creator@example.test' },
          parentRevision: null,
          contentBasis: 'source',
        },
      }],
      beforeRevision: null,
      nextBeforeRevision: null,
    };
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
      const i18n = createI18n(locale, CATALOGS[locale]);
      const html = renderToString(<QuestionRevisionHistoryView history={history} i18n={i18n} />);
      expect(html).toContain(i18n.t('items.detail.deterministicConversion'));
      expect(html).toContain(i18n.t('items.detail.adapter'));
      expect(html).toContain(i18n.t('items.detail.adapterVersion'));
      for (
        const sentinel of [
          'ADAPTER-LABEL-SENTINEL',
          'ADAPTER-VERSION-SENTINEL',
          'SOURCE-FILE-SENTINEL',
          'QUOTE-SENTINEL',
        ]
      ) expect(html).toContain(sentinel);
      expect(html.includes('storageKey')).toStrictEqual(false);
      expect(html.includes('items.detail.')).toStrictEqual(false);
    }
  },
);
