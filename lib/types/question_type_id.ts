/** Stable question identities, independent of authoring drivers and the QTI compiler. */
export const QUESTION_TYPE_IDS = [
  'single_select',
  'multi_select',
  'text_entry',
  'order',
  'match',
  'associate',
  'inline_choice',
  'extended_text',
  'gap_match',
  'graphic_gap_match',
  'graphic_associate',
  'graphic_order',
  'media',
  'portable_custom',
  'position_object',
  'select_point',
  'slider',
  'upload',
  'hotspot',
  'hottext',
  'custom_interaction',
  'drawing',
  'end_attempt',
] as const;
export type QuestionTypeId = typeof QUESTION_TYPE_IDS[number];
const registered: ReadonlySet<string> = new Set(QUESTION_TYPE_IDS);

/** Parse an identity without loading the authoring implementation graph. */
export function isQuestionTypeId(value: unknown): value is QuestionTypeId {
  return typeof value === 'string' && registered.has(value);
}
