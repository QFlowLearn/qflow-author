import { QUESTION_TYPES, type QuestionTypeId } from '../types/registry.ts';

export const AUTHORABLE_QUESTION_TYPES = QUESTION_TYPES.filter((t) =>
  t.id !== 'custom_interaction' && t.id !== 'end_attempt'
);

export const AUTHORABLE_QUESTION_TYPE_IDS = new Set<QuestionTypeId>(
  AUTHORABLE_QUESTION_TYPES.map((t) => t.id),
);
