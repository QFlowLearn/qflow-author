// Item-layer QTI import router: parseQtiXml output maps to QFlow drafts via mapper modules.
// New interactions belong in mappers/map_<name>.ts — do not extend package parsing.
import type { QtiAssessmentItem, QtiDocument } from '@longsightgroup/qti3-core';
import type { Draft } from '../../../types/draft.ts';
import { mapChoice, mapOrder } from './mappers/map_choice.ts';
import {
  mapGapMatch,
  mapGraphicAssociate,
  mapGraphicGapMatch,
  mapGraphicOrder,
  mapHotspot,
  mapHottext,
} from './mappers/map_graphic.ts';
import { mapAssociate, mapMatch } from './mappers/map_match.ts';
import {
  mapCustomInteraction,
  mapDrawing,
  mapEndAttempt,
  mapExtendedText,
  mapMedia,
  mapPortableCustom,
  mapPositionObject,
  mapSelectPoint,
  mapSlider,
  mapUpload,
} from './mappers/map_misc.ts';
import { mapInlineChoice, mapTextEntry } from './mappers/map_text_inline.ts';
import {
  deriveResponseMode,
  itemTitle,
  type MappedQtiDraft,
  QtiItemLanguageImportError,
} from './qti_import_support.ts';
import { catalogsFromQtiItem, stylesheetsFromQtiItem } from '../../../catalog_metadata.ts';
import { parseItemLanguage } from '../../../types/item_language.ts';
import type { ItemLanguage } from '../../../types/item_language.ts';

export type ParsedItemDraft = {
  identifier: string;
  title: string;
  draft: Draft & { type: Required<Draft>['type'] };
};

export function qtiDocumentToDraft(document: QtiDocument): ParsedItemDraft {
  const item = document.item;
  let itemLanguage: ItemLanguage;
  try {
    itemLanguage = parseItemLanguage(item.language);
  } catch (_cause: unknown) {
    throw new QtiItemLanguageImportError('Assessment item xml:lang is missing or invalid.');
  }
  const responseMode = deriveResponseMode(item.responseProcessing);
  const interactions = item.interactions;

  const textEntries = interactions.filter((interaction) => interaction.type === 'textEntry');
  if (textEntries.length > 0) {
    return wrapItem(item, itemLanguage, mapTextEntry(item, textEntries, responseMode));
  }

  const inlineChoices = interactions.filter((interaction) => interaction.type === 'inlineChoice');
  if (inlineChoices.length > 0) {
    return wrapItem(item, itemLanguage, mapInlineChoice(item, inlineChoices, responseMode));
  }

  if (interactions.length === 0) {
    throw new Error('Unsupported interaction type in item');
  }

  const interaction = interactions[0];
  switch (interaction.type) {
    case 'choice':
      return wrapItem(item, itemLanguage, mapChoice(item, interaction, responseMode));
    case 'order':
      return wrapItem(item, itemLanguage, mapOrder(item, interaction, responseMode));
    case 'match':
      return wrapItem(item, itemLanguage, mapMatch(item, interaction, responseMode));
    case 'associate':
      return wrapItem(item, itemLanguage, mapAssociate(item, interaction, responseMode));
    case 'graphicAssociate':
      return wrapItem(item, itemLanguage, mapGraphicAssociate(item, interaction, responseMode));
    case 'gapMatch':
      return wrapItem(item, itemLanguage, mapGapMatch(item, interaction, responseMode));
    case 'hottext':
      return wrapItem(item, itemLanguage, mapHottext(item, interaction));
    case 'graphicGapMatch':
      return wrapItem(item, itemLanguage, mapGraphicGapMatch(item, interaction));
    case 'hotspot':
      return wrapItem(item, itemLanguage, mapHotspot(item, interaction));
    case 'graphicOrder':
      return wrapItem(item, itemLanguage, mapGraphicOrder(item, interaction));
    case 'media':
      return wrapItem(item, itemLanguage, mapMedia(item, interaction));
    case 'positionObject':
      return wrapItem(item, itemLanguage, mapPositionObject(item, interaction));
    case 'selectPoint':
      return wrapItem(item, itemLanguage, mapSelectPoint(item, interaction));
    case 'slider':
      return wrapItem(item, itemLanguage, mapSlider(item, interaction));
    case 'upload':
      return wrapItem(item, itemLanguage, mapUpload(item, interaction));
    case 'endAttempt':
      return wrapItem(item, itemLanguage, mapEndAttempt(item, interaction));
    case 'drawing':
      return wrapItem(item, itemLanguage, mapDrawing(item, interaction));
    case 'portableCustom':
      return wrapItem(item, itemLanguage, mapPortableCustom(item, interaction));
    case 'custom':
      if (interaction.qtiName !== 'qti-custom-interaction') {
        throw new Error(`Unsupported interaction type in item: ${interaction.qtiName}`);
      }
      return wrapItem(item, itemLanguage, mapCustomInteraction(item, interaction));
    case 'extendedText':
      return wrapItem(item, itemLanguage, mapExtendedText(item, interaction));
    default:
      throw new Error(`Unsupported interaction type in item: ${interaction.type}`);
  }
}

function wrapItem(
  item: QtiAssessmentItem,
  itemLanguage: ItemLanguage,
  draft: MappedQtiDraft,
): ParsedItemDraft {
  return {
    identifier: item.identifier,
    title: itemTitle(item),
    draft: {
      ...draft,
      itemLanguage,
      catalogs: catalogsFromQtiItem(item),
      stylesheets: stylesheetsFromQtiItem(item),
    },
  };
}
