import type { QtiAssessmentItem, QtiChoice, QtiInteraction } from '@longsightgroup/qti3-core';
import type { Draft } from '../../../../types/draft.ts';
import type { MappedQtiDraft } from '../qti_import_support.ts';
import {
  bodyHtmlFromContentNodes,
  choiceHtmlFromChoice,
  promptHtmlFromInteraction,
} from '../content_html.ts';
import {
  attrPositiveInt,
  correctIdentifiers,
  importedBase,
  itemTitle,
  responseDeclarationFor,
  sharedVocabularyFromInteraction,
} from '../qti_import_support.ts';

export function mapMatch(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'match' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const sources = interaction.choices.filter((choice) => choice.role === 'matchSource').map(
    mapMatchChoice,
  );
  const targets = interaction.choices.filter((choice) => choice.role === 'matchTarget').map(
    mapMatchChoice,
  );
  const correctPairs = correctIdentifiers(responseDecl).map((pair) => {
    const [sourceId, targetId] = pair.split(/\s+/);
    return { sourceId, targetId };
  }).filter((pair) => pair.sourceId && pair.targetId);

  return {
    type: 'match',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    sources,
    targets,
    correctPairs,
    minAssociations: attrPositiveInt(interaction.attributes['min-associations']),
    maxAssociations: attrPositiveInt(interaction.attributes['max-associations']),
    shuffle: interaction.attributes.shuffle === 'true',
    sharedVocabulary: sharedVocabularyFromInteraction(interaction),
    responseMode,
  };
}

function mapMatchChoice(choice: QtiChoice) {
  return {
    id: choice.identifier,
    html: choiceHtmlFromChoice(choice),
    text: choice.text?.trim() || undefined,
    matchMax: attrPositiveInt(choice.attributes['match-max']),
  };
}

export function mapAssociate(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'associate' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const correctPairs = correctIdentifiers(responseDecl).map((pair) => {
    const [sourceId, targetId] = pair.split(/\s+/);
    return { sourceId, targetId };
  }).filter((pair) => pair.sourceId && pair.targetId);

  return {
    type: 'associate',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    choices: interaction.choices
      .filter((choice) => choice.role === 'associableChoice')
      .map((choice) => ({
        id: choice.identifier,
        html: choiceHtmlFromChoice(choice),
        text: choice.text?.trim() || undefined,
        matchMax: attrPositiveInt(choice.attributes['match-max']),
      })),
    correctPairs,
    responseIdentifier,
    shuffle: interaction.attributes.shuffle === 'true',
    minAssociations: attrPositiveInt(interaction.attributes['min-associations']),
    maxAssociations: attrPositiveInt(interaction.attributes['max-associations']),
    responseMode,
  };
}
