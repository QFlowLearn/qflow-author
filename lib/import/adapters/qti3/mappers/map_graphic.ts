import type { QtiAssessmentItem, QtiInteraction } from '@longsightgroup/qti3-core';
import type { Draft } from '../../../../types/draft.ts';
import type { MappedQtiDraft } from '../qti_import_support.ts';
import { createHottextMarkerHtml } from '../../../../types/hottext.ts';
import {
  bodyHtmlFromContentNodes,
  bodyHtmlFromGapMatchSegments,
  bodyHtmlFromHottextSegments,
  choiceHtmlFromChoice,
  promptHtmlFromInteraction,
} from '../content_html.ts';
import {
  attrNumber,
  attrPositiveInt,
  correctIdentifiers,
  importedBase,
  inputWidthClassFromClassAttr,
  itemTitle,
  responseDeclarationFor,
  sharedVocabularyFromInteraction,
} from '../qti_import_support.ts';

export function mapGraphicAssociate(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'graphic_associate' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const background = interaction.object;
  const correctPairs = correctIdentifiers(responseDecl).map((pair) => {
    const [sourceId, targetId] = pair.split(/\s+/);
    return { sourceId, targetId };
  }).filter((pair) => pair.sourceId && pair.targetId);

  return {
    type: 'graphic_associate',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier,
    graphicAssociateBackgroundSrc: background?.data ?? '',
    graphicAssociateBackgroundAlt: background?.text?.trim() || background?.attributes.alt ||
      undefined,
    graphicAssociateBackgroundType: background?.type || undefined,
    graphicAssociateBackgroundWidth: attrNumber(background?.width),
    graphicAssociateBackgroundHeight: attrNumber(background?.height),
    graphicAssociateHotspots: interaction.choices
      .filter((choice) => choice.role === 'hotspot')
      .map((choice) => ({
        id: choice.identifier,
        shape: hotspotShape(choice.attributes.shape),
        coords: choice.attributes.coords ?? '',
        matchMax: attrPositiveInt(choice.attributes['match-max']),
      })),
    graphicAssociateCorrectPairs: correctPairs,
    minAssociations: attrPositiveInt(interaction.attributes['min-associations']),
    maxAssociations: attrPositiveInt(interaction.attributes['max-associations']),
    responseMode,
  };
}

export function mapGapMatch(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'gap_match' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const gapChoices = interaction.choices
    .filter((choice) => choice.role === 'gapChoice')
    .map((choice) => {
      if (choice.qtiName === 'qti-gap-text') {
        return {
          id: choice.identifier,
          kind: 'text' as const,
          html: choiceHtmlFromChoice(choice),
          text: choice.text?.trim() || undefined,
          fixed: choice.attributes.fixed === 'true',
          matchMax: attrPositiveInt(choice.attributes['match-max']),
        };
      }
      return {
        id: choice.identifier,
        kind: 'image' as const,
        imgSrc: choice.asset?.data,
        imgAlt: choice.asset?.attributes.alt ?? choice.asset?.text,
        fixed: choice.attributes.fixed === 'true',
        matchMax: attrPositiveInt(choice.attributes['match-max']),
      };
    });
  const gapIds = uniqStrings(
    interaction.choices
      .filter((choice) => choice.role === 'gap')
      .map((choice) => choice.identifier),
  );
  const gapWidthById = new Map(
    interaction.choices
      .filter((choice) => choice.role === 'gap')
      .map((choice) => [choice.identifier, inputWidthClassFromClassAttr(choice.attributes.class)]),
  );
  const gaps = gapIds.map((id) => ({ id, label: id, widthClass: gapWidthById.get(id) }));
  const correctGapPairs = correctIdentifiers(responseDecl).map((pair) => {
    const [choiceId, gapId] = pair.split(/\s+/);
    return { choiceId, gapId };
  }).filter((pair) => pair.choiceId && pair.gapId);

  return {
    type: 'gap_match',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: interaction.gapMatchSegments?.length
      ? bodyHtmlFromGapMatchSegments(interaction.gapMatchSegments)
      : bodyHtmlFromContentNodes(item.body, {
        excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
      }),
    responseIdentifier,
    shuffle: interaction.attributes.shuffle === 'true',
    gapChoices,
    gaps,
    correctGapPairs,
    minAssociations: attrPositiveInt(interaction.attributes['min-associations']),
    maxAssociations: attrPositiveInt(interaction.attributes['max-associations']),
    minAssociationsMessage: interaction.attributes['data-min-selections-message'] || undefined,
    maxAssociationsMessage: interaction.attributes['data-max-selections-message'] || undefined,
    sharedVocabulary: sharedVocabularyFromInteraction(interaction),
    responseMode,
  };
}

export function mapHottext(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'hottext' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const hottexts = interaction.choices
    .filter((choice) => choice.role === 'hottext')
    .map((choice) => ({
      id: choice.identifier,
      html: choiceHtmlFromChoice(choice),
      text: choice.text?.trim() || undefined,
    }));

  return {
    type: 'hottext',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: interaction.hottextSegments?.length
      ? bodyHtmlFromHottextSegments(
        interaction.hottextSegments,
        (id, label) => createHottextMarkerHtml({ id, label }),
      )
      : bodyHtmlFromContentNodes(item.body, {
        excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
      }),
    hottexts,
    correctIds: correctIdentifiers(responseDecl),
    responseIdentifier,
    minChoices: attrPositiveInt(interaction.attributes['min-choices']),
    maxChoices: attrPositiveInt(interaction.attributes['max-choices']),
    minChoicesMessage: interaction.attributes['data-min-selections-message'] || undefined,
    maxChoicesMessage: interaction.attributes['data-max-selections-message'] || undefined,
    sharedVocabulary: sharedVocabularyFromInteraction(interaction),
  };
}

export function mapGraphicGapMatch(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'graphic_gap_match' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const background = interaction.object;
  const choices = interaction.choices
    .filter((choice) => choice.role === 'gapChoice')
    .map((choice) => {
      if (choice.qtiName === 'qti-gap-text') {
        return {
          id: choice.identifier,
          kind: 'text' as const,
          html: choiceHtmlFromChoice(choice),
          text: choice.text?.trim() || undefined,
          matchMax: attrPositiveInt(choice.attributes['match-max']),
          fixed: choice.attributes.fixed === 'true',
        };
      }
      return {
        id: choice.identifier,
        kind: 'image' as const,
        imgSrc: choice.asset?.data ?? '',
        imgAlt: choice.asset?.attributes.alt ?? choice.asset?.text,
        imgType: choice.asset?.attributes.type,
        matchMax: attrPositiveInt(choice.attributes['match-max']),
        fixed: choice.attributes.fixed === 'true',
      };
    });
  const targets = interaction.choices
    .filter((choice) => choice.role === 'hotspot')
    .map((choice) => ({
      id: choice.identifier,
      shape: hotspotShape(choice.attributes.shape),
      coords: choice.attributes.coords ?? '',
      matchMax: attrPositiveInt(choice.attributes['match-max']),
    }));
  const correctPairs = correctIdentifiers(responseDecl).map((pair) => {
    const [choiceId, targetId] = pair.split(/\s+/);
    return { choiceId, targetId };
  });

  return {
    type: 'graphic_gap_match',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    choices,
    targets,
    correctPairs,
    graphicBackgroundSrc: background?.data ?? '',
    graphicBackgroundAlt: background?.text?.trim() || background?.attributes.alt || undefined,
    graphicBackgroundType: background?.attributes.type,
    sharedVocabulary: sharedVocabularyFromInteraction(interaction),
    minAssociations: attrPositiveInt(interaction.attributes['min-associations']),
    maxAssociations: attrPositiveInt(interaction.attributes['max-associations']),
    minAssociationsMessage: interaction.attributes['data-min-selections-message'] || undefined,
    maxAssociationsMessage: interaction.attributes['data-max-selections-message'] || undefined,
    responseIdentifier,
  };
}

export function mapHotspot(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'hotspot' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const image = interaction.object;
  const correctIds = correctIdentifiers(responseDecl);
  const maxChoices = attrPositiveInt(interaction.attributes['max-choices']);
  const repairedMaxChoices = maxChoices ?? (correctIds.length > 1 ? correctIds.length : undefined);
  return {
    type: 'hotspot',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    choices: interaction.choices
      .filter((choice) => choice.role === 'hotspot')
      .map((choice) => ({
        id: choice.identifier,
        shape: hotspotShape(choice.attributes.shape),
        coords: choice.attributes.coords ?? '',
      })),
    hotspotImageSrc: image?.data ?? '',
    hotspotImageAlt: image?.text?.trim() || image?.attributes.alt || undefined,
    responseIdentifier,
    minChoices: attrPositiveInt(interaction.attributes['min-choices']),
    maxChoices: repairedMaxChoices,
    minChoicesMessage: interaction.attributes['data-min-selections-message'] || undefined,
    maxChoicesMessage: interaction.attributes['data-max-selections-message'] || undefined,
    correctIds,
    sharedVocabulary: sharedVocabularyFromInteraction(interaction),
    importWarnings: !maxChoices && correctIds.length > 1
      ? [{
        code: 'MISSING_MAX_CHOICES_REPAIRED',
        message:
          'Hotspot max choices was missing for multiple correct responses; defaulted for export.',
      }]
      : [],
  };
}

export function mapGraphicOrder(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'graphic_order' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const image = interaction.object;
  return {
    type: 'graphic_order',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier,
    graphicOrderBackgroundSrc: image?.data ?? '',
    graphicOrderBackgroundAlt: image?.text?.trim() || image?.attributes.alt || undefined,
    graphicOrderBackgroundType: image?.type || undefined,
    graphicOrderBackgroundWidth: attrNumber(image?.width),
    graphicOrderBackgroundHeight: attrNumber(image?.height),
    graphicOrderHotspots: interaction.choices
      .filter((choice) => choice.role === 'hotspot')
      .map((choice) => ({
        id: choice.identifier,
        shape: hotspotShape(choice.attributes.shape),
        coords: choice.attributes.coords ?? '',
        label: choice.attributes['hotspot-label'] ??
          (choice.attributes['aria-label'] || undefined),
      })),
    graphicOrderCorrectOrder: correctIdentifiers(responseDecl),
    minChoices: attrPositiveInt(interaction.attributes['min-choices']),
    maxChoices: attrPositiveInt(interaction.attributes['max-choices']),
  };
}

function hotspotShape(value?: string): 'circle' | 'poly' | 'rect' {
  if (value === 'circle' || value === 'poly') return value;
  return 'rect';
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
