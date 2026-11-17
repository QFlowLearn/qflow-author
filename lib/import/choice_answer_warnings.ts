import type { Draft } from '../types/draft.ts';
import type { ImportWarning } from './types.ts';

/** Classify choice-key defects from their fields, including before source-only review projection. */
export function choiceAnswerWarnings(draft: Draft, path: string): ImportWarning[] {
  if (draft.type !== 'single_select' && draft.type !== 'multi_select') return [];
  const keys = draft.type === 'single_select'
    ? (draft.correctId ? [draft.correctId] : [])
    : (draft.correctIds ?? []);
  if (keys.length === 0) {
    return [{ code: 'MISSING_CORRECT', message: 'No correct choice was supplied.', path }];
  }
  if (keys.some((key) => !(draft.choices ?? []).some((choice) => choice.id === key))) {
    return [{
      code: 'INVALID_ANSWER_REFERENCE',
      message: 'The answer key names a choice that is not present.',
      path,
    }];
  }
  return [];
}
