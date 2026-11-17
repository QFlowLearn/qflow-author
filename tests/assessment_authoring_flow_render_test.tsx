import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import '../islands/drivers/single_select.tsx';
import { ActiveQuestionCard } from '../islands/assessment_builder/ActiveQuestionCard.tsx';
import AssessmentWorkspace from '../components/ui/AssessmentWorkspace.tsx';
import AssessmentQuestionPreview from '../islands/assessment_builder/AssessmentQuestionPreview.tsx';
import AssessmentRightRail from '../islands/assessment_builder/AssessmentRightRail.tsx';
import ItemEditorProvider from '../islands/item_editor/ItemEditorProvider.tsx';
import { buildEditingQuestionPresentation } from '../islands/assessment_builder/useAssessmentEditing.ts';
import { sanitizeBodyHtml } from '../lib/sanitize.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { formatAssessmentPlanLabel } from '../islands/assessment_builder/assessment_delivery.ts';

const noOp = () => {};

function authoredDraft(seed: Omit<Draft, 'itemLanguage'>): Draft {
  return { ...seed, itemLanguage: newAuthoringItemLanguage() };
}

testCase('assessment header links to secondary tools without exposing delivery setup', () => {
  const html = renderToString(
    <I18nProvider
      payload={{
        locale: 'en-US',
        namespaces: { assessments: catalogForLocale('en-US').assessments! },
      }}
    >
      <AssessmentWorkspace
        assessment={{
          id: 'assessment-1',
          title: 'US Presidents Sampler',
        }}
        assessmentPlanLabel='Assessment plan · 3/5 aligned'
        onToggleAdd={noOp}
      />
    </I18nProvider>,
  );

  expect(html).toContain('US Presidents Sampler');
  expect(html).toContain('aria-label="Assessment actions"');
  expect(html).toContain('Assessment plan · 3/5 aligned');
  expect(html).toContain('href="/assessments/assessment-1?tool=assessment-plan"');
  expect(html).toContain('Publish &amp; delivery');
  expect(html).toContain('href="/assessments/assessment-1?tool=assessment-export"');
  expect(html.split('<button').length - 1).toStrictEqual(1);
  if (html.includes('aria-controls="assessment-plan"')) {
    expect.unreachable('Expected !html.includes(\'aria-controls="assessment-plan"\')');
  }
  if (html.includes('Harbor')) expect.unreachable("Expected !html.includes('Harbor')");
  if (html.includes('Publish for Delivery')) {
    expect.unreachable("Expected !html.includes('Publish for Delivery')");
  }
});

testCase('assessment header localizes delivery framing in every locale', () => {
  const valid = '2026-01-02T03:04:00.000Z';
  const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
  const rendered: string[] = [];
  for (const locale of locales) {
    const catalog = catalogForLocale(locale);
    const i18n = createI18n(locale, catalog);
    const html = renderToString(
      <I18nProvider payload={{ locale, namespaces: { assessments: catalog.assessments! } }}>
        <AssessmentWorkspace
          assessment={{
            id: 'assessment-1',
            title: 'Authored assessment title',
            delivery: {
              publishedAt: valid,
              assessmentVersionId: 'version-42',
              previewUrl: 'https://delivery.example/preview',
              adminUrl: 'https://delivery.example/admin',
            },
          }}
          assessmentPlanLabel='Plan supplied by caller'
          onToggleAdd={noOp}
        />
      </I18nProvider>,
    );
    rendered.push(html);
    expect(html).toContain('Authored assessment title');
    expect(html.replace(/<[^>]*>/g, '')).toContain(
      i18n.t('list.builder.header.publishedOn', { date: i18n.formatDate(new Date(valid)) }),
    );
    expect(html).toContain(i18n.t('list.builder.header.launch'));
    expect(html).toContain(i18n.t('list.builder.header.manage'));
    expect(html).toContain(i18n.t('list.builder.header.addQuestion'));
    expect(html).toContain(i18n.t('list.builder.header.actions'));
    expect(html.replaceAll('&amp;', '&')).toContain(i18n.t('publication.heading'));
    if (html.includes('version-42')) {
      expect.unreachable("Expected !html.includes('version-42')");
    }
    expect(html).toContain(i18n.t('publication.checking'));
    if (html.includes('list.')) expect.unreachable("Expected !html.includes('list.')");
    const invalidHtml = renderToString(
      <I18nProvider payload={{ locale, namespaces: { assessments: catalog.assessments! } }}>
        <AssessmentWorkspace
          assessment={{
            id: 'assessment-1',
            title: 'Authored assessment title',
            delivery: { publishedAt: 'not-a-date', assessmentVersionId: 'version-43' },
          }}
          assessmentPlanLabel='Plan supplied by caller'
          onToggleAdd={noOp}
        />
      </I18nProvider>,
    );
    expect(invalidHtml).toContain(i18n.t('list.table.unavailable'));
  }
  if (!(rendered[0] !== rendered[2])) expect.unreachable('Expected rendered[0] !== rendered[2]');
  if (!(rendered[0] !== rendered[3])) expect.unreachable('Expected rendered[0] !== rendered[3]');
});

testCase('assessment plan labels localize plain and coverage forms', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    expect(formatAssessmentPlanLabel(i18n)).toStrictEqual(i18n.t('list.builder.header.plan'));
    expect(formatAssessmentPlanLabel(i18n, { assigned: 1000, expected: 2000 })).toStrictEqual(
      i18n.t('list.builder.header.planCoverage', {
        assigned: i18n.formatNumber(1000),
        expected: i18n.formatNumber(2000),
      }),
    );
    if (formatAssessmentPlanLabel(i18n, { assigned: 1000, expected: 2000 }).includes('list.')) {
      expect.unreachable(
        "Expected !formatAssessmentPlanLabel(i18n, { assigned: 1000, expected: 2000 }).includes('list.')",
      );
    }
  }
});

testCase('collapsed question cards keep assessment content visible', () => {
  const html = renderToString(
    <I18nProvider
      payload={{
        locale: 'en-US',
        namespaces: { assessments: catalogForLocale('en-US').assessments! },
      }}
    >
      <AssessmentQuestionPreview
        itemNumber='1.1'
        placement={{ id: 'placement-1', itemId: 'question-1' }}
        partId='part-1'
        meta={{
          id: 'placement-1',
          itemId: 'question-1',
          title: 'Capital of France',
          latestRev: 1,
          questionTypeId: 'single_select',
          questionType: 'Single Select',
          reviewSuggestions: [],
          preview: {
            bodyHtml: sanitizeBodyHtml('<p>What is the capital of France?</p>'),
            choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Lyon' }],
          },
        }}
        onEditItem={noOp}
      />
      <AssessmentQuestionPreview
        itemNumber='1.2'
        placement={{ id: 'placement-2', itemId: 'question-2' }}
        partId='part-1'
        meta={{
          id: 'placement-2',
          itemId: 'question-2',
          title: 'Explain your answer',
          latestRev: 1,
          questionTypeId: 'extended_text',
          questionType: 'Extended Text',
          reviewSuggestions: [],
          preview: { bodyHtml: sanitizeBodyHtml('<p>Explain why the location matters.</p>') },
        }}
        onEditItem={noOp}
      />
    </I18nProvider>,
  );

  expect(html).toContain('What is the capital of France?');
  expect(html).toContain('Paris');
  expect(html).toContain('Explain why the location matters.');
  expect(html).toContain('aria-label="Edit question 1.1: Capital of France"');
});

testCase('collapsed question cards allow long QTI choice identifiers to size their badges', () => {
  const html = renderToString(
    <I18nProvider
      payload={{
        locale: 'en-US',
        namespaces: { assessments: catalogForLocale('en-US').assessments! },
      }}
    >
      <AssessmentQuestionPreview
        itemNumber='2.1'
        placement={{ id: 'placement-order', itemId: 'question-order' }}
        partId='part-1'
        meta={{
          id: 'placement-order',
          itemId: 'question-order',
          title: 'Arrange the Presidents',
          latestRev: 1,
          questionTypeId: 'order',
          questionType: 'Ordering',
          reviewSuggestions: [],
          preview: {
            bodyHtml: sanitizeBodyHtml(
              '<p>Arrange these Presidents from earliest to latest service.</p>',
            ),
            choices: [{ id: 'CHOICE_A', text: 'James Madison' }],
          },
        }}
        onEditItem={noOp}
      />
    </I18nProvider>,
  );

  expect(html).toContain('CHOICE_A');
  expect(html).toContain('min-w-6');
  if (html.includes('size-6 shrink-0')) {
    expect.unreachable("Expected !html.includes('size-6 shrink-0')");
  }
});

testCase('question settings inspector is hidden until requested', () => {
  const closedSettingsDraft = authoredDraft({ type: 'single_select' });
  expect(closedSettingsDraft.itemLanguage).toStrictEqual('en-US');
  Object.defineProperty(closedSettingsDraft, 'shuffle', {
    get() {
      throw new Error('Closed settings inspector read its control draft.');
    },
  });
  const closed = renderToString(
    <I18nProvider
      payload={{
        locale: 'en-US',
        namespaces: {
          assessments: catalogForLocale('en-US').assessments!,
          authoring: catalogForLocale('en-US').authoring!,
        },
      }}
    >
      <ItemEditorProvider
        pointEditingAuthority={{ _tag: 'Generated' }}
        choiceRichText={false}
        initialType='single_select'
        initialDraft={authoredDraft({ type: 'single_select' })}
        itemId='question-1'
        persistence={{
          _tag: 'Assessment',
          save: () => Promise.resolve({ itemId: 'question-1', rev: 2, identifier: 'question-1' }),
        }}
        advisoryReviewEnabled={false}
        payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}
        playerCatalog={playerMessageCatalogForLocale('en-US')}
      >
        <AssessmentRightRail
          open={false}
          questionLabel='Question 1.1'
          rightRailType='single_select'
          settingsDraft={closedSettingsDraft}
          onSettingsDraftChange={noOp}
          tags={[]}
          onTagsChange={noOp}
          onClose={noOp}
        >
          <span data-inspector-body-marker>Inspector body marker</span>
        </AssessmentRightRail>
      </ItemEditorProvider>
    </I18nProvider>,
  );
  const open = renderToString(
    <I18nProvider
      payload={{
        locale: 'en-US',
        namespaces: {
          assessments: catalogForLocale('en-US').assessments!,
          authoring: catalogForLocale('en-US').authoring!,
        },
      }}
    >
      <ItemEditorProvider
        pointEditingAuthority={{ _tag: 'Generated' }}
        choiceRichText={false}
        initialType='single_select'
        initialDraft={authoredDraft({ type: 'single_select' })}
        itemId='question-1'
        persistence={{
          _tag: 'Assessment',
          save: () => Promise.resolve({ itemId: 'question-1', rev: 2, identifier: 'question-1' }),
        }}
        advisoryReviewEnabled={false}
        payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}
        playerCatalog={playerMessageCatalogForLocale('en-US')}
      >
        <AssessmentRightRail
          open
          questionLabel='Question 1.1'
          rightRailType='single_select'
          settingsDraft={authoredDraft({ type: 'single_select' })}
          onSettingsDraftChange={noOp}
          tags={[]}
          onTagsChange={noOp}
          onClose={noOp}
        >
          <span data-inspector-body-marker>Inspector body marker</span>
        </AssessmentRightRail>
      </ItemEditorProvider>
    </I18nProvider>,
  );

  expect(closed).toContain('aria-hidden="true"');
  expect(closed).toContain(' inert');
  if (!(/<aside\b[^>]*\shidden(?:=|\s|>)/.test(closed))) {
    expect.unreachable('Expected /<aside\\b[^>]*\\shidden(?:=|\\s|>)/.test(closed)');
  }
  expect(closed).toContain('Question settings');
  if (closed.includes('>Behavior</div>')) {
    expect.unreachable("Expected !closed.includes('>Behavior</div>')");
  }
  if (closed.includes('Randomize choices')) {
    expect.unreachable("Expected !closed.includes('Randomize choices')");
  }
  if (closed.includes('Inspector body marker')) {
    expect.unreachable("Expected !closed.includes('Inspector body marker')");
  }
  if (closed.includes('>Metadata</h3>')) {
    expect.unreachable("Expected !closed.includes('>Metadata</h3>')");
  }
  if (closed.includes('placeholder="e.g., presidents, demo"')) {
    expect.unreachable('Expected !closed.includes(\'placeholder="e.g., presidents, demo"\')');
  }
  expect(open).toContain('aria-hidden="false"');
  if (open.includes(' inert')) expect.unreachable("Expected !open.includes(' inert')");
  if (/<aside\b[^>]*\shidden(?:=|\s|>)/.test(open)) {
    expect.unreachable('Expected !/<aside\\b[^>]*\\shidden(?:=|\\s|>)/.test(open)');
  }
  expect(open).toContain('Question settings');
  expect(open).toContain('data-settings-group="answer"');
  expect(open).toContain('Randomize choices');
  expect(open).toContain('Loading question review');
  if (open.includes('Inspector body marker')) {
    expect.unreachable("Expected !open.includes('Inspector body marker')");
  }
  if (open.includes('Advanced</button>')) {
    expect.unreachable("Expected !open.includes('Advanced</button>')");
  }
});

testCase(
  'active question heading relies on the number badge instead of repeating the prefix',
  () => {
    const html = renderToString(
      <I18nProvider
        payload={{
          locale: 'en-US',
          namespaces: { assessments: catalogForLocale('en-US').assessments! },
        }}
      >
        <ActiveQuestionCard
          itemId='question-1'
          itemNumber='1.1'
          headerText='Capital of France'
          headerType='Single Select'
          questionType='single_select'
          inspectorOpen={false}
          actionBusy={null}
          onOpenInspector={noOp}
          onCreateVariant={noOp}
          onExportXml={noOp}
          onDelete={noOp}
        >
          <div>Editor</div>
        </ActiveQuestionCard>
      </I18nProvider>,
    );

    expect(html).toContain('>1.1</span>');
    expect(html).toContain('<h3');
    expect(html).toContain('>Capital of France</h3>');
    expect(html).toContain('scroll-margin-top:5rem');
    if (html.includes('Edit 1.1')) expect.unreachable("Expected !html.includes('Edit 1.1')");
  },
);

testCase('editing presentation keeps numbered context for the settings inspector', () => {
  const i18n = createI18n('en-US', catalogForLocale('en-US'));
  const presentation = buildEditingQuestionPresentation(
    {
      _tag: 'Editing',
      revision: 1,
      pointEditingAuthority: { _tag: 'Generated' },
      itemId: 'question-1',
      placementId: 'placement-1',
      partId: 'part-1',
      draft: authoredDraft({ type: 'single_select', title: 'Capital of France' }),
    },
    {},
    () => '1.1',
    i18n,
  );

  expect(presentation.title).toStrictEqual('Capital of France');
  expect(presentation.typeLabel).toStrictEqual(
    i18n.t('assessments.builder.questionTypeLabel', { type: 'single_select' }),
  );
  expect(presentation.inspectorLabel).toStrictEqual(
    i18n.t('assessments.builder.questionWithNumber', { number: '1.1', title: 'Capital of France' }),
  );
});
