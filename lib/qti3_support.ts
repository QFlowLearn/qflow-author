import type { QtiInteractionType } from '@longsightgroup/qti3-core';
import type { QuestionTypeId } from './types/registry.ts';

export const QFLOW_TO_QTI3_INTERACTION = {
  single_select: 'choice',
  multi_select: 'choice',
  text_entry: 'textEntry',
  order: 'order',
  match: 'match',
  associate: 'associate',
  inline_choice: 'inlineChoice',
  extended_text: 'extendedText',
  gap_match: 'gapMatch',
  graphic_gap_match: 'graphicGapMatch',
  graphic_associate: 'graphicAssociate',
  graphic_order: 'graphicOrder',
  media: 'media',
  portable_custom: 'portableCustom',
  position_object: 'positionObject',
  select_point: 'selectPoint',
  slider: 'slider',
  upload: 'upload',
  hotspot: 'hotspot',
  hottext: 'hottext',
  custom_interaction: 'custom',
  drawing: 'drawing',
  end_attempt: 'endAttempt',
} as const satisfies Record<QuestionTypeId, QtiInteractionType>;

const qflowToQti3Entries = Object.entries(QFLOW_TO_QTI3_INTERACTION) as Array<
  [QuestionTypeId, QtiInteractionType]
>;

const QTI3_TO_QFLOW_TYPES = qflowToQti3Entries.reduce(
  (byInteraction, [typeId, interaction]) => {
    const types = byInteraction.get(interaction) ?? [];
    types.push(typeId);
    byInteraction.set(interaction, types);
    return byInteraction;
  },
  new Map<QtiInteractionType, QuestionTypeId[]>(),
);

export function qti3InteractionToQflowTypes(interaction: QtiInteractionType): QuestionTypeId[] {
  const types = QTI3_TO_QFLOW_TYPES.get(interaction);
  if (!types) {
    throw new Error(`No QFlow question types mapped for qti3 interaction: ${interaction}`);
  }
  return types;
}
