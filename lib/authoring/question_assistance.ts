import { parseQuestionComposition, type QuestionComposition } from './question_composition.ts';
import {
  isTextQuestionType,
  QUESTION_TEXT_MAX_LENGTH,
  type QuestionStructure,
  type TextQuestionType,
} from './question_text.ts';

/** Bounded request containing current text and content-free session structure. */
export type QuestionAssistanceInput = {
  readonly text: string;
  readonly recent: readonly QuestionStructure[];
  readonly explicitType: TextQuestionType | null;
};
export type QuestionAssistanceDecision = { readonly composition: QuestionComposition | null };
/** Parse the complete untrusted request before any paid classification. */
export function parseQuestionAssistanceInput(raw: unknown): QuestionAssistanceInput | null {
  if (
    !record(raw) || Object.keys(raw).sort().join(',') !== 'explicitType,recent,text' ||
    !(raw.explicitType === null || isTextQuestionType(raw.explicitType)) ||
    typeof raw.text !== 'string' || !raw.text.trim() ||
    raw.text.length > QUESTION_TEXT_MAX_LENGTH ||
    !Array.isArray(raw.recent) || raw.recent.length > 5
  ) return null;
  const recent: QuestionStructure[] = [];
  for (const entry of raw.recent) {
    if (
      !record(entry) || Object.keys(entry).sort().join(',') !== 'choiceCount,type' ||
      !isTextQuestionType(entry.type) || typeof entry.choiceCount !== 'number' ||
      !Number.isInteger(entry.choiceCount) || entry.choiceCount < 2 || entry.choiceCount > 10
    ) return null;
    recent.push({ type: entry.type, choiceCount: entry.choiceCount });
  }
  return { text: raw.text, recent, explicitType: raw.explicitType };
}
/** Refine source-derived API fields before updating the editor. */
export function parseQuestionAssistanceDecision(raw: unknown): QuestionAssistanceDecision | null {
  if (!record(raw) || Object.keys(raw).join(',') !== 'composition') return null;
  if (raw.composition === null) return { composition: null };
  const composition = parseQuestionComposition(raw.composition);
  return composition ? { composition } : null;
}
function record(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}
