import { useLayoutEffect, useState } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { Draft } from '../../lib/types/draft.ts';
import {
  changeQuestionPresentation,
  type QuestionPresentationHistory,
  questionPresentationHistory,
  undoQuestionPresentation,
} from '../../lib/question_presentation.ts';

/** Own local representation Undo without remounting the active item editor. */
export function useQuestionPresentation(
  draft: Draft,
  setDraft: Dispatch<StateUpdater<Draft>>,
  busy: boolean,
  historyKey: number,
) {
  const [history, setHistory] = useState<QuestionPresentationHistory | null>(null);
  useLayoutEffect(() => setHistory(null), [historyKey]);
  const available = changeQuestionPresentation(draft);
  const undo = history ? undoQuestionPresentation(draft, history) : null;
  return {
    available,
    changed: history !== null,
    undo,
    busy,
    change: () => {
      if (busy || !available.ok) return;
      setHistory(questionPresentationHistory(draft, available.draft));
      setDraft(available.draft);
    },
    undoChange: () => {
      if (busy || !undo?.ok) return;
      setDraft(undo.draft);
      setHistory(null);
    },
  };
}
