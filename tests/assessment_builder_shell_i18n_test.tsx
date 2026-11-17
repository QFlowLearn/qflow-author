import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import type { ComponentChildren } from 'preact';
import AssessmentAddDialog from '../islands/assessment_builder/AssessmentAddDialog.tsx';
import AssessmentCanvas from '../islands/assessment_builder/AssessmentCanvas.tsx';
import {
  ItemActions,
  SettingsButton,
} from '../islands/assessment_builder/AssessmentCanvasControls.tsx';
import AssessmentQuestionPreview from '../islands/assessment_builder/AssessmentQuestionPreview.tsx';
import AssessmentSidebar from '../islands/assessment_builder/AssessmentSidebar.tsx';
import AssessmentRightRail from '../islands/assessment_builder/AssessmentRightRail.tsx';
import type { ItemMeta } from '../islands/assessment_builder/types.ts';
import ItemEditorProvider from '../islands/item_editor/ItemEditorProvider.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { sanitizeInlineHtml } from '../lib/sanitize.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { AUTHORABLE_QUESTION_TYPE_IDS } from '../lib/authoring/question_type_catalog.ts';
import { QUESTION_TYPE_IDS } from '../lib/types/registry.ts';
import { createCreatingQuestionPresentation } from '../islands/assessment_builder/authoring_state.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'];
const noop = () => {};

function metaFor(
  type: (typeof QUESTION_TYPE_IDS)[number],
  id = 'item',
  suggestionCount = 0,
): ItemMeta {
  return {
    id,
    itemId: id,
    title: 'Authored question Ω',
    latestRev: 1,
    questionTypeId: type,
    questionType: 'SERVER-OWNED-ENGLISH-LABEL',
    reviewSuggestions: Array.from({ length: suggestionCount }, (_, index) => ({
      source: 'deterministic' as const,
      code: `quality-${index}`,
      category: 'ambiguity',
      message: `Suggestion ${index}`,
    })),
    preview: {
      promptHtml: sanitizeInlineHtml('Prompt Ω'),
      choices: [{ id: 'A', text: 'Choice Ω' }],
    },
  };
}

function previewFor(
  type: (typeof QUESTION_TYPE_IDS)[number],
  id = 'item',
  suggestionCount = 0,
): ComponentChildren {
  return (
    <AssessmentQuestionPreview
      itemNumber='1.1'
      placement={{ id: `placement-${id}`, itemId: id }}
      partId='part'
      meta={metaFor(type, id, suggestionCount)}
      onEditItem={noop}
    />
  );
}

function shell(locale: InterfaceLocale, children: ComponentChildren): string {
  return renderToString(
    <I18nProvider
      payload={{
        locale,
        namespaces: {
          assessments: catalogForLocale(locale).assessments!,
          authoring: catalogForLocale(locale).authoring!,
        },
      }}
    >
      {children}
    </I18nProvider>,
  );
}

testCase('assessment builder shell uses locale catalogs across all supported locales', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const preview = shell(locale, previewFor('single_select'));
    const manyPreview = shell(
      locale,
      <>
        {previewFor('single_select', 'item-one', 1)}
        {previewFor('multi_select', 'item-two', 2)}
      </>,
    );
    const canvas = shell(
      locale,
      <AssessmentCanvas
        authoringState={{ _tag: 'Creating', type: 'single_select', partId: 'part' }}
        editingPresentation={null}
        actionBusy={null}
        parts={[{ id: 'part', title: 'Part Ω', placements: [] }]}
        itemMeta={{}}
        inspectorOpen={false}
        onEditItem={noop}
        onOpenInspector={noop}
        onAddQuestion={noop}
        onCreateVariant={noop}
        onExportXml={noop}
        onDelete={noop}
      />,
    );
    const manySidebar = shell(
      locale,
      <AssessmentSidebar
        assessmentId='assessment'
        parts={[{
          id: 'part',
          title: 'Part Ω',
          placements: Array.from({ length: 1234 }, (_, index) => ({
            id: `placement-${index}`,
            itemId: `item-${index}`,
          })),
        }]}
        collapsed={{ part: true }}
        recent={[{ id: 'recent', title: 'Recent Ω' }]}
        onTogglePart={noop}
      />,
    );
    const controls = shell(
      locale,
      <>
        <SettingsButton open={false} onOpen={noop} />
        <ItemActions
          actionBusy={null}
          questionType='single_select'
          onCreateVariant={noop}
          onExportXml={noop}
          onDelete={noop}
        />
      </>,
    );
    const sidebar = shell(
      locale,
      <AssessmentSidebar
        assessmentId='assessment'
        parts={[]}
        collapsed={{}}
        recent={[{ id: 'recent', title: 'Recent Ω' }]}
        onTogglePart={noop}
      />,
    );
    const add = shell(
      locale,
      <AssessmentAddDialog
        method='create'
        onMethodChange={() => {}}
        trigger={null}
        parts={[{ id: 'part', title: 'Part Ω', placements: [] }]}
        onPartChange={() => {}}
        onStartText={() => {}}
        onStartContent={() => {}}
        open
        onClose={noop}
        assessment={{ id: 'assessment' }}
        part={{ id: 'part', title: 'Part Ω', placements: [] }}
        existingItemIds={new Set()}
        onAdded={noop}
        previewContext={{
          payload: createI18nPayload(locale, catalogForLocale(locale), ['authoring']),
          playerCatalog: playerMessageCatalogForLocale(locale),
        }}
        lastType={null}
        onStartAuthoring={noop}
      />,
    );
    const rail = shell(
      locale,
      <ItemEditorProvider
        pointEditingAuthority={{ _tag: 'Generated' }}
        choiceRichText={false}
        initialType='single_select'
        initialDraft={{ type: 'single_select', itemLanguage: newAuthoringItemLanguage() }}
        itemId={undefined}
        persistence={{
          _tag: 'Assessment',
          save: () => Promise.resolve({ itemId: 'item', rev: 1, identifier: 'item' }),
        }}
        advisoryReviewEnabled={false}
        payload={createI18nPayload(locale, catalogForLocale(locale), ['authoring'])}
        playerCatalog={playerMessageCatalogForLocale(locale)}
      >
        <AssessmentRightRail
          open
          questionLabel='Authored question Ω'
          rightRailType='single_select'
          settingsDraft={{ type: 'single_select', itemLanguage: newAuthoringItemLanguage() }}
          onSettingsDraftChange={noop}
          tags={['tag Ω']}
          onTagsChange={noop}
          onClose={noop}
        />
      </ItemEditorProvider>,
    );
    const allOutput = [preview, manyPreview, canvas, controls, sidebar, manySidebar, add, rail]
      .join('\n');
    for (
      const output of [preview, manyPreview, canvas, controls, sidebar, manySidebar, add, rail]
    ) {
      if (output.includes('assessments.builder.')) {
        expect.unreachable("Expected !output.includes('assessments.builder.')");
      }
    }
    expect(preview).toContain('Authored question Ω');
    expect(preview).toContain('Prompt Ω');
    expect(preview).toContain('Choice Ω');
    expect(canvas).toContain(i18n.t('assessments.builder.assessmentFlow'));
    expect(add).toContain(i18n.t('assessments.builder.addToAssessment'));
    expect(add).toContain(i18n.t('assessments.builder.createNew'));
    expect(add).toContain(i18n.t('assessments.builder.fromLibrary'));
    expect(add).toContain(i18n.t('assessments.builder.closeAddDialog'));
    expect(controls).toContain(i18n.t('assessments.builder.questionActions'));
    expect(controls).toContain(i18n.t('assessments.builder.duplicateQuestion'));
    expect(controls).toContain(i18n.t('assessments.builder.createMultiVariant'));
    expect(controls).toContain(i18n.t('assessments.builder.exportQuestionXml'));
    expect(controls).toContain(i18n.t('assessments.builder.deleteQuestion'));
    expect(sidebar).toContain(i18n.t('assessments.builder.parts'));
    expect(manySidebar).toContain('Part Ω');
    expect(manySidebar).toContain('Recent Ω');
    expect(manySidebar).toContain(i18n.formatNumber(1234));
    expect(manySidebar).toContain('href="/assessments/recent"');
    expect(manySidebar).toContain('href="/assessments/assessment/arrange"');
    expect(rail).toContain(i18n.t('assessments.builder.questionSettings'));
    expect(rail).toContain(i18n.t('editor.loadingReview'));
    expect(rail).toContain('Authored question Ω');
    expect(rail).toContain(i18n.t('editor.unsavedChanges'));
    for (const type of QUESTION_TYPE_IDS) {
      const typeOutput = shell(locale, previewFor(type, `type-${type}`));
      const label = i18n.t('assessments.builder.questionTypeLabel', { type });
      expect(typeOutput).toContain(label);
      if (typeOutput.includes('SERVER-OWNED-ENGLISH-LABEL')) {
        expect.unreachable("Expected !typeOutput.includes('SERVER-OWNED-ENGLISH-LABEL')");
      }
    }
    expect(canvas).toContain(i18n.t('assessments.builder.partQuestionCount', { count: 0 }));
    expect(manyPreview.includes(i18n.t('assessments.builder.reviewCount', { count: 1 })))
      .toStrictEqual(false);
    expect(manyPreview.includes(i18n.t('assessments.builder.reviewCount', { count: 2 })))
      .toStrictEqual(false);
    expect(canvas).toContain(i18n.t('assessments.builder.startFirstQuestion'));
    const oneCanvas = shell(
      locale,
      <AssessmentCanvas
        authoringState={{ _tag: 'Idle' }}
        editingPresentation={null}
        actionBusy={null}
        parts={[{ id: 'part', title: 'Part Ω', placements: [{ id: 'p1', itemId: 'item' }] }]}
        itemMeta={{ p1: metaFor('single_select') }}
        inspectorOpen={false}
        onEditItem={noop}
        onOpenInspector={noop}
        onAddQuestion={noop}
        onCreateVariant={noop}
        onExportXml={noop}
        onDelete={noop}
      />,
    );
    expect(oneCanvas).toContain(i18n.t('assessments.builder.questionCount', { count: 1 }));
    expect(oneCanvas).toContain(i18n.t('assessments.builder.partQuestionCount', { count: 1 }));
    const manyCanvas = shell(
      locale,
      <AssessmentCanvas
        authoringState={{ _tag: 'Idle' }}
        editingPresentation={null}
        actionBusy={null}
        parts={[{
          id: 'part',
          title: 'Part Ω',
          placements: [{ id: 'p1', itemId: 'item-one' }, { id: 'p2', itemId: 'item-two' }],
        }]}
        itemMeta={{
          p1: metaFor('single_select', 'item-one'),
          p2: metaFor('multi_select', 'item-two'),
        }}
        inspectorOpen={false}
        onEditItem={noop}
        onOpenInspector={noop}
        onAddQuestion={noop}
        onCreateVariant={noop}
        onExportXml={noop}
        onDelete={noop}
      />,
    );
    expect(manyCanvas).toContain(i18n.t('assessments.builder.questionCount', { count: 2 }));
    expect(manyCanvas).toContain(i18n.t('assessments.builder.partQuestionCount', { count: 2 }));
    expect(manyPreview).toContain('Authored question Ω');
    expect(preview).toContain('data-authoring-card="item"');
    expect(preview).toContain(
      i18n.t('assessments.builder.editQuestion', { number: '1.1', title: 'Authored question Ω' }),
    );
    const stableAttributes = [...allOutput.matchAll(/(?:href|value|id)="([^"]*)"/g)].map(
      ([, value]) => value,
    );
    for (
      const localizedCopy of [
        i18n.t('assessments.builder.assessmentFlow'),
        i18n.t('assessments.builder.questionSettings'),
        i18n.t('assessments.builder.arrange'),
        i18n.t('assessments.builder.open'),
      ]
    ) {
      if (stableAttributes.some((value) => value.includes(localizedCopy))) {
        expect.unreachable(
          'Expected !stableAttributes.some((value) => value.includes(localizedCopy))',
        );
      }
    }
    if (locale.startsWith('es-')) {
      for (
        const phrase of [
          'Assessment flow',
          'Start with your first question',
          'Add to assessment',
          'Create new',
          'From library',
          'Question settings',
          'Unsaved changes',
          'Item saved',
          'Metadata',
          'Tags',
          'Recent assessments',
          'Arrange',
          'Open',
          'Duplicate question',
          'Export question XML',
          'Remove question from assessment',
          'Question actions',
          'Parts',
          'Add another question',
        ]
      ) {
        if (allOutput.includes(phrase)) {
          expect.unreachable('Expected !allOutput.includes(phrase)');
        }
      }
    }
  }
});

testCase('every authorable type has a localized new-question heading', () => {
  for (const type of AUTHORABLE_QUESTION_TYPE_IDS) {
    const labels = locales.map((locale) => {
      const i18n = createI18n(locale, catalogForLocale(locale));
      const label = createCreatingQuestionPresentation(i18n, type, 'part-1')
        .questionLabel;
      if (label.includes('assessments.builder.')) {
        expect.unreachable("Expected !label.includes('assessments.builder.')");
      }
      expect(label).toContain(i18n.t('assessments.builder.questionTypeLabel', {
        type,
      }));
      return label;
    });
    if (!(labels[2] !== labels[0])) expect.unreachable('Expected labels[2] !== labels[0]');
    if (!(labels[3] !== labels[0])) expect.unreachable('Expected labels[3] !== labels[0]');
  }
});
