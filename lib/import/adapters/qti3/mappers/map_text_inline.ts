import type { QtiAssessmentItem, QtiInteraction } from '@longsightgroup/qti3-core';

type QtiResponseDeclaration = QtiAssessmentItem['responseDeclarations'][number];
type QtiMapEntry = NonNullable<QtiResponseDeclaration['mapping']>['entries'][number];
import { createPlaceholderHtml } from '../../../../text_entry_placeholders.ts';
import type { Draft } from '../../../../types/draft.ts';
import type { MappedQtiDraft } from '../qti_import_support.ts';
import { createInlineChoiceMarkerHtml } from '../../../../types/inline_choice.ts';
import type { InlineChoiceSlot } from '../../../../types/inline_choice.ts';
import type { TextEntryAnswer, TextEntrySlot } from '../../../../types/text_entry.ts';
import {
  bodyHtmlWithInteractionMarkers,
  choiceHtmlFromChoice,
  promptHtmlFromInteraction,
} from '../content_html.ts';
import {
  attrNumber,
  correctIdentifiers,
  importedBase,
  inputWidthClassFromClassAttr,
  itemTitle,
  responseDeclarationFor,
  sharedVocabularyFromInteraction,
} from '../qti_import_support.ts';
import { readTextEntryMatchScoring } from '../text_entry_match_scoring.ts';

export function mapInlineChoice(
  item: QtiAssessmentItem,
  interactions: QtiInteraction[],
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'inline_choice' } {
  const mappedSlots = interactions.map((interaction, index) =>
    mapInlineChoiceSlot(item, interaction, index, responseMode)
  );
  const slots = mappedSlots.map((mapped) => mapped.slot);
  return {
    type: 'inline_choice',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interactions[0]),
    bodyHtml: bodyHtmlWithInteractionMarkers(item, (interaction) => {
      const slot = slots.find((entry) => entry.id === interaction.responseIdentifier);
      return slot ? createInlineChoiceMarkerHtml({ id: slot.id, label: slot.label }) : '';
    }),
    inlineChoices: slots,
    responseMode,
    importWarnings: mappedSlots
      .filter((mapped) => mapped.repairedMissingCorrect)
      .map((mapped) => ({
        code: 'MISSING_CORRECT_REPAIRED',
        message:
          `Inline choice slot "${mapped.slot.id}" had no correct response; defaulted to the first option for export.`,
      })),
  };
}

type MappedInlineChoiceSlot = {
  slot: InlineChoiceSlot;
  repairedMissingCorrect: boolean;
};

function mapInlineChoiceSlot(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  index: number,
  responseMode: Draft['responseMode'],
): MappedInlineChoiceSlot {
  const responseId = interaction.responseIdentifier || `RESPONSE_${index + 1}`;
  const responseDecl = responseDeclarationFor(item, responseId);
  const scoreFor = (id: string): number | undefined => {
    if (responseMode !== 'partial' || !responseDecl?.mapping) return undefined;
    const entry = responseDecl.mapping.entries.find((mapEntry: QtiMapEntry) =>
      mapEntry.mapKey === id
    );
    return entry ? entry.mappedValue : 0;
  };
  const options = interaction.choices
    .filter((choice) => choice.role === 'inlineChoice')
    .map((choice) => ({
      id: choice.identifier,
      html: choiceHtmlFromChoice(choice),
      text: choice.text?.trim() || undefined,
      fixed: choice.attributes.fixed === 'true',
      score: scoreFor(choice.identifier),
    }));
  const declaredCorrectId = correctIdentifiers(responseDecl)[0];
  const correctId = declaredCorrectId ?? options[0]?.id;

  return {
    slot: {
      id: responseId,
      label: interaction.attributes.title?.trim() || `Blank ${index + 1}`,
      shuffle: interaction.attributes.shuffle === 'true',
      required: interaction.attributes.required === 'true',
      widthClass: inputWidthClassFromClassAttr(interaction.attributes.class),
      writingOrientation: sharedVocabularyFromInteraction(interaction).writingOrientation,
      options,
      correctId,
    },
    repairedMissingCorrect: !declaredCorrectId && Boolean(correctId),
  };
}

export function mapTextEntry(
  item: QtiAssessmentItem,
  interactions: QtiInteraction[],
  responseMode: Draft['responseMode'],
): MappedQtiDraft & { type: 'text_entry' } {
  let matchScore: number | undefined;
  if (responseMode === 'all_or_nothing') {
    const scoring = readTextEntryMatchScoring(item);
    // Translate the typed recognition failure at the existing exception-based import boundary.
    if (!scoring.ok) throw scoring.error;
    matchScore = scoring.score;
  }
  const slots = interactions.map((interaction, index) =>
    mapTextEntrySlot(item, interaction, index, matchScore)
  );
  return {
    type: 'text_entry',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interactions[0]),
    bodyHtml: bodyHtmlWithInteractionMarkers(item, (interaction) => {
      const slot = slots.find((entry) => entry.id === interaction.responseIdentifier);
      return slot
        ? createPlaceholderHtml({ id: slot.id, label: slot.label, widthClass: slot.widthClass })
        : '';
    }),
    textEntries: slots,
    responseMode,
  };
}

function mapTextEntrySlot(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
  index: number,
  matchScore: number | undefined,
): TextEntrySlot {
  const identifier = interaction.responseIdentifier || `RESPONSE_${index + 1}`;
  const responseDecl = responseDeclarationFor(item, identifier);
  const answers = parseTextEntryAnswers(responseDecl, matchScore);
  return {
    id: identifier,
    label: interaction.attributes.title?.trim() || identifier,
    base: attrNumber(interaction.attributes.base),
    stringIdentifier: interaction.attributes['string-identifier'] || undefined,
    expectedLength: attrNumber(interaction.attributes['expected-length']),
    widthClass: inputWidthClassFromClassAttr(interaction.attributes.class),
    patternMask: interaction.attributes['pattern-mask'] || undefined,
    patternMessage: interaction.attributes['data-patternmask-message'] || undefined,
    placeholderText: interaction.attributes['placeholder-text'] || undefined,
    format: interaction.attributes.format || undefined,
    responseBaseType: responseDecl?.baseType === 'string' ||
        responseDecl?.baseType === 'integer' ||
        responseDecl?.baseType === 'float'
      ? responseDecl.baseType
      : undefined,
    answers: answers.length
      ? answers
      : [{ id: crypto.randomUUID(), value: '', score: 1, caseSensitive: false }],
  };
}

function parseTextEntryAnswers(
  responseDecl: QtiResponseDeclaration | undefined,
  matchScore: number | undefined,
): TextEntryAnswer[] {
  if (!responseDecl) return [];
  const values = correctIdentifiers(responseDecl);
  if (matchScore !== undefined) {
    return values.map((value) => ({
      id: crypto.randomUUID(),
      value,
      score: matchScore,
      caseSensitive: true,
    }));
  }
  const mapEntries = responseDecl.mapping?.entries ?? [];
  const answers: TextEntryAnswer[] = [];
  for (const value of values) {
    const entry = mapEntries.find((mapEntry: QtiMapEntry) => mapEntry.mapKey === value);
    answers.push({
      id: crypto.randomUUID(),
      value,
      score: entry?.mappedValue ?? 1,
      caseSensitive: entry?.attributes['case-sensitive'] !== 'false',
    });
  }
  for (const entry of mapEntries) {
    const value = entry.mapKey ?? '';
    if (!value || values.includes(value)) continue;
    answers.push({
      id: crypto.randomUUID(),
      value,
      score: entry.mappedValue,
      caseSensitive: entry.attributes['case-sensitive'] !== 'false',
    });
  }
  return answers;
}
