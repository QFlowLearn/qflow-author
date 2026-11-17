import type { QuestionTypeId } from '../../../lib/types/registry.ts';
import type { RailDraft } from './rail_draft.ts';

/** Clear fixed/pinned flags when shuffle or allow-pins is turned off. */
export function clearPinnedChoices(typeId: QuestionTypeId, draft: RailDraft): Partial<RailDraft> {
  if (typeId === 'gap_match') {
    const gapChoices = draft.gapChoices ?? [];
    if (!gapChoices.some((choice) => choice.fixed)) return {};
    return {
      gapChoices: gapChoices.map((choice) => choice.fixed ? { ...choice, fixed: false } : choice),
    };
  }
  const choices = draft.choices ?? [];
  if (!choices.some((choice) => choice.fixed)) return {};
  return {
    choices: choices.map((choice) => (choice.fixed ? { ...choice, fixed: false } : choice)),
  };
}
