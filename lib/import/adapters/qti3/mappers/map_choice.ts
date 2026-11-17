import type { QtiAssessmentItem, QtiChoice, QtiInteraction } from '@longsightgroup/qti3-core';
import type { Draft } from '../../../../types/draft.ts';
import type { MappedQtiDraft } from '../qti_import_support.ts';
import {
  bodyHtmlFromContentNodes,
  choiceHtmlFromChoice,
  promptHtmlFromInteraction,
} from '../content_html.ts';
import {
  attrBool,
  attrPositiveInt,
  correctIdentifiers,
  deriveChoiceLabel,
  importedBase,
  itemTitle,
  responseDeclarationFor,
  sharedVocabularyFromInteraction,
} from '../qti_import_support.ts';

export function mapChoice(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'single_select' | 'multi_select' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const maxChoices = attrPositiveInt(interaction.attributes['max-choices']);
  const isMulti = responseDecl?.cardinality === 'multiple' || (maxChoices ?? 0) > 1;
  const sharedVocabulary = sharedVocabularyFromInteraction(interaction);
  const choices = interaction.choices
    .filter((choice) => choice.role === 'simpleChoice')
    .map((choice, index) => mapSimpleChoice(choice, index));
  const answerMasking = choices.some((choice) => (choice.showHide ?? '').toLowerCase() === 'hide');
  const base = {
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    choices,
    responseIdentifier,
    shuffle: interaction.attributes.shuffle === 'true',
    minChoices: attrPositiveInt(interaction.attributes['min-choices']),
    maxChoices,
    responseMode,
    answerMasking,
    sharedVocabulary,
  };

  if (isMulti) {
    return {
      type: 'multi_select',
      ...base,
      correctIds: correctIdentifiers(responseDecl),
    };
  }

  const correctIds = correctIdentifiers(responseDecl);
  return {
    type: 'single_select',
    ...base,
    correctId: correctIds[0] ?? '',
    required: (base.minChoices ?? 0) > 0,
  };
}

function mapSimpleChoice(choice: QtiChoice, index: number) {
  return {
    id: choice.identifier,
    html: choiceHtmlFromChoice(choice),
    text: choice.text?.trim() || undefined,
    fixed: choice.attributes.fixed === 'true',
    showHide: choice.attributes['show-hide'] || undefined,
    label: deriveChoiceLabel(choice.identifier, index),
  };
}

export function mapOrder(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'order' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const correctOrder = correctIdentifiers(responseDecl);
  return {
    type: 'order',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    choices: interaction.choices
      .filter((choice) => choice.role === 'simpleChoice')
      .map((choice) => ({
        id: choice.identifier,
        html: choiceHtmlFromChoice(choice),
        text: choice.text?.trim() || undefined,
      })),
    correctOrder: correctOrder.length ? correctOrder : undefined,
    minChoices: attrPositiveInt(interaction.attributes['min-choices']),
    maxChoices: attrPositiveInt(interaction.attributes['max-choices']),
    minChoicesMessage: interaction.attributes['data-min-selections-message'] || undefined,
    maxChoicesMessage: interaction.attributes['data-max-selections-message'] || undefined,
    shuffle: attrBool(interaction.attributes.shuffle),
    sharedVocabulary: sharedVocabularyFromInteraction(interaction),
    responseMode,
  };
}
