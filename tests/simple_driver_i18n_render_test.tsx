import { expect, test as testCase } from 'vitest';

import { useState } from 'preact/hooks';
import { renderPage as render } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { parseInterfaceLocale } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { ChoiceListEditor } from '../islands/drivers/choice_list_editor.tsx';
import type { ChoiceListState } from '../islands/drivers/use_choice_list.ts';
import { OrderContent } from '../islands/drivers/order.tsx';
import { TextEntryContent } from '../islands/drivers/text_entry.tsx';
import { ExtendedTextContent } from '../islands/drivers/extended_text.tsx';
import { EndAttemptContent } from '../islands/drivers/end_attempt.tsx';
import { UploadContent } from '../islands/drivers/upload.tsx';
import Radio from '../components/ui/Radio.tsx';
import '../islands/drivers/single_select.tsx';
import '../islands/drivers/multi_select.tsx';
import { driverViewsFor } from '../islands/drivers/view_registry.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { Draft } from '../lib/types/draft.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
const common = {
  renderPromptField: (placeholder: string) => <span>{placeholder} AUTHORED-UNICODE-Ω</span>,
  fieldHasIssue: () => false,
  fieldIssueText: () => undefined,
};

function RegisteredDriverHarness({ type }: { type: 'single_select' | 'multi_select' }) {
  const [draft, setDraft] = useState<Draft>(() =>
    parsePersistedDraft({
      type,
      itemLanguage: newAuthoringItemLanguage(),
      title: 'AUTHORED-REGISTERED-TITLE',
      bodyHtml: '<p>AUTHORED-REGISTERED-Ω</p>',
      choices: [
        { id: 'A', text: 'AUTHORED-REGISTERED-CHOICE-漢字' },
        { id: 'B', text: 'Second choice' },
      ],
      correctId: 'A',
      correctIds: ['A'],
      shuffle: false,
    }, type)
  );
  const views = driverViewsFor(type);
  if (!views) expect.unreachable(`Missing registered view for ${type}`);
  return (
    <section data-registered-driver={type}>
      {views.ui({
        draft,
        update: setDraft,
        editor: common,
      })}
    </section>
  );
}

function EmptyTextEntry() {
  return (
    <TextEntryContent
      {...common}
      textEntries={[]}
      showIdentifiers={false}
      setShowIdentifiers={() => {}}
      requirePatterns={false}
      setRequirePatterns={() => {}}
      patternSelections={{}}
      setPatternSelection={() => {}}
      insertBlank={() => {}}
      removeSlot={() => {}}
      updateSlotLabel={() => {}}
      updateSlotIdentifier={() => {}}
      updateSlotExpectedLength={() => {}}
      updateSlotWidth={() => {}}
      updateSlotPattern={() => {}}
      updateSlotPatternMessage={() => {}}
      addAnswer={() => {}}
      removeAnswer={() => {}}
      upsertAnswer={() => {}}
    />
  );
}

testCase('simple choice driver registrations are present', () => {
  if (!driverViewsFor('single_select') || !driverViewsFor('multi_select')) {
    throw new Error('Simple choice driver registrations are missing.');
  }
});

for (const locale of locales) {
  testCase(`simple authoring drivers use request i18n in ${locale}`, () => {
    const parsed = parseInterfaceLocale(locale);
    if (!parsed) throw new Error(`Unsupported test locale: ${locale}`);
    const payload = createI18nPayload(parsed, catalogForLocale(parsed), ['authoring']);
    const i18n = createI18n(parsed, payload.namespaces);
    const choiceState: ChoiceListState = {
      choices: [{ id: 'A', text: 'AUTHORED-CHOICE-漢字' }],
      canUndoRemoval: false,
      canRedoRemoval: false,
      keyboardHistory: false,
      historyFocus: { sequence: 0, choiceId: '' },
      undoRemoval: () => {},
      redoRemoval: () => {},
      correctId: 'A',
      correctIds: ['A'],
      shuffle: true,
      allowPins: true,
      choiceLabelOptions: {},
      labelEditing: null,
      pastedChoiceCount: 0,
      pasteChoices: () => {},
      undoPaste: () => {},
      keepPasteAsOne: () => {},
      addChoice: () => {},
      updateChoiceText: () => {},
      updateChoiceHtml: () => {},
      removeChoice: () => {},
      toggleChoicePin: () => {},
      setCorrectId: () => {},
      setCorrectIds: () => {},
      beginLabelEdit: () => {},
      commitLabelEdit: () => {},
      onLabelEditInput: () => {},
    };
    const html = render(
      <I18nProvider payload={payload}>
        <div>
          <RegisteredDriverHarness type='single_select' />
          <RegisteredDriverHarness type='multi_select' />
          <EmptyTextEntry />
          <ChoiceListEditor
            {...common}
            list={choiceState}
            promptPlaceholder={i18n.t('driver.singlePrompt')}
            useRteForChoices={false}
            plainTextValue={(text) => text ?? ''}
            isChoiceCorrect={() => true}
            renderCorrectControl={(_choice, index, isCorrect) => (
              <Radio
                name={`correct-${index}`}
                checked={isCorrect}
                title={i18n.t('driver.markCorrect')}
              />
            )}
          />
          <OrderContent
            {...common}
            choices={[{ id: 'A', text: 'AUTHORED-CHOICE-漢字' }, { id: 'B', text: 'Second' }]}
            addChoice={() => {}}
            plainTextValue={(text) => text ?? ''}
            updateChoiceText={() => {}}
            removeChoice={() => {}}
            dragIndex={null}
            setDragIndex={() => {}}
            reorderChoice={() => {}}
          />
          <TextEntryContent
            {...common}
            textEntries={[{
              id: 'RESPONSE',
              label: 'AUTHORED-BLANK',
              expectedLength: 4,
              widthClass: 'qti-input-width-4',
              patternMask: '^[0-9]+$',
              patternMessage: 'AUTHORED-PATTERN',
              answers: [{ id: 'a', value: '42', score: 1, caseSensitive: true }],
            }]}
            showIdentifiers
            setShowIdentifiers={() => {}}
            requirePatterns
            setRequirePatterns={() => {}}
            patternSelections={{ RESPONSE: '^[0-9]+$' }}
            setPatternSelection={() => {}}
            insertBlank={() => {}}
            removeSlot={() => {}}
            updateSlotLabel={() => {}}
            updateSlotIdentifier={() => {}}
            updateSlotExpectedLength={() => {}}
            updateSlotWidth={() => {}}
            updateSlotPattern={() => {}}
            updateSlotPatternMessage={() => {}}
            addAnswer={() => {}}
            removeAnswer={() => {}}
            upsertAnswer={() => {}}
          />
          <ExtendedTextContent
            {...common}
            extendedResponseId='RESPONSE'
            setExtendedResponseId={() => {}}
            extendedRubricHtml='<p>AUTHORED-RUBRIC-✓</p>'
            setExtendedRubricHtml={() => {}}
          />
          <EndAttemptContent
            {...common}
            endAttemptResponseIdentifier='RESPONSE'
            endAttemptTitle='AUTHORED-TITLE'
            setEndAttemptResponseIdentifier={() => {}}
            setEndAttemptTitle={() => {}}
            setEndAttemptCountAttempt={() => {}}
          />
          <UploadContent
            {...common}
            responseIdentifier='RESPONSE'
            setResponseIdentifier={() => {}}
            setMaxFileSize={() => {}}
            setFileTypes={() => {}}
            setMultiple={() => {}}
          />
        </div>
      </I18nProvider>,
    );
    expect(html).toContain('AUTHORED-CHOICE-漢字');
    expect(html).toContain('AUTHORED-UNICODE-Ω');
    expect(html).toContain('AUTHORED-RUBRIC-✓');
    expect(html).toContain('AUTHORED-BLANK');
    expect(html).toContain('AUTHORED-PATTERN');
    expect(html).toContain('qti-input-width-4');
    expect(html).toContain('^[0-9]+$');
    expect(html).toContain('>A<');
    expect(html).toContain('value="RESPONSE"');
    expect(html).toContain(i18n.t('driver.editChoice', { label: 'A' }));
    expect(html).toContain(i18n.t('driver.choices'));
    expect(html).toContain(i18n.t('driver.blanks'));
    expect(html).toContain(i18n.t('driver.noBlanks'));
    for (
      const message of [
        'driver.addChoice',
        'driver.correct',
        'driver.removeChoice',
        'driver.pinChoice',
        'driver.reorderHelp',
        'driver.step',
        'driver.dragToReorder',
        'driver.identifiersHelp',
        'driver.hideIdentifiers',
        'driver.requirePattern',
        'driver.patternRequiredHelp',
        'driver.expectedLength',
        'driver.width',
        'driver.patternMask',
        'driver.customRegex',
        'driver.regexHelp',
        'driver.acceptedAnswers',
        'driver.addAnswer',
        'driver.answerScoreHelp',
        'driver.caseSensitive',
        'driver.scorerRubric',
        'driver.buttonLabel',
        'driver.countAttempt',
        'driver.uploadPrompt',
      ] as const
    ) {
      expect(html).toContain(
        i18n.t(message, message === 'driver.step' ? { number: 1 } : undefined),
      );
    }
    if (locale.startsWith('es')) {
      for (
        const forbidden of [
          'Choices',
          'Add choice',
          'Choice label',
          '>Correct<',
          'Remove choice',
          'Pin choice',
          'Reorder choices',
          'Text blanks',
          'Insert blank',
          'Show identifiers',
          'Require a pattern mask',
          'Expected length',
          'Pattern mask',
          'Custom regex',
          'Accepted answers',
          'Add answer',
          'Case sensitive',
          'Scorer rubric',
          'Button label',
          'Count this as an attempt',
          'Upload the requested file',
        ]
      ) {
        if (html.includes(forbidden)) {
          throw new Error(`English driver UI leaked in ${locale}: ${forbidden}`);
        }
      }
    }
  });
}
