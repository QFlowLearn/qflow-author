import { QuestionCompletionSession } from './question_completion_session.ts';
import {
  needsQuestionComposition,
  parseQuestionCompletion,
  prepareQuestionComposition,
  type QuestionCompletion,
  questionCompletionKey,
  type QuestionComposition,
} from '../../lib/authoring/question_composition.ts';
import QuestionComposerPreview from '../../components/ui/QuestionComposerPreview.tsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useItemEditorState } from './context.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import {
  isTextQuestionType,
  parseQuestionText,
  prepareQuestionText,
  QUESTION_TEXT_MAX_LENGTH,
  type QuestionStructure,
  TEXT_QUESTION_TYPES,
  type TextQuestionFinding,
  type TextQuestionType,
} from '../../lib/authoring/question_text.ts';
import { parseQuestionAssistanceDecision } from '../../lib/authoring/question_assistance.ts';
import {
  applyAuthoringPreferences,
  type AuthoringPreference,
} from '../../lib/authoring_preferences.ts';
import type { Draft } from '../../lib/types/draft.ts';
import QuestionTextPanel from '../../components/ui/QuestionTextPanel.tsx';

type Props = {
  readonly onPrepared: (draft: Draft) => void;
  readonly assessmentId: string;
  readonly recent: readonly QuestionStructure[];
  readonly preferences: readonly AuthoringPreference[];
};
type Suggestions = {
  readonly question: QuestionComposition;
  readonly completion: QuestionCompletion;
};
type Snapshot = {
  readonly draft: Draft;
  readonly titleLocked: boolean;
  readonly suggestions: Suggestions | null;
};
type Status =
  | 'idle'
  | 'working'
  | 'prepared'
  | 'uncertain'
  | 'unavailable'
  | 'edited'
  | 'completing'
  | 'completionFailed';
/** Protect every field preparation replaces, including titles and selection limits. */
function contentKey(draft: Draft): string {
  return JSON.stringify([
    draft.type,
    draft.title,
    draft.bodyHtml,
    draft.promptHtml,
    draft.choices,
    draft.correctId,
    draft.correctIds,
    draft.textEntries,
    draft.minChoices,
    draft.maxChoices,
    draft.shuffle,
  ]);
}
/** Stable source input; all prepared content is written into the existing canonical editor. */
export default function QuestionTextAssistance(
  { assessmentId, recent, preferences, onPrepared }: Props,
) {
  const state = useItemEditorState();
  const i18n = useI18n();
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const [completionSession] = useState(() =>
    new QuestionCompletionSession(async (question, { signal }) => {
      const response = await fetch(`/api/assessments/${assessmentId}/question-completion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(question),
        signal: AbortSignal.any([signal, AbortSignal.timeout(47000)]),
      });
      return response.ok ? parseQuestionCompletion(await response.json(), question) : null;
    })
  );
  const [explicitType, setExplicitType] = useState<TextQuestionType | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [findings, setFindings] = useState<readonly TextQuestionFinding[]>([]);
  const [undoDraft, setUndoDraft] = useState<Snapshot | null>(null);
  const [redoDraft, setRedoDraft] = useState<Snapshot | null>(null);
  const [composing, setComposing] = useState(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lastText = useRef('');
  const lastApplied = useRef(contentKey(state.content.draft));
  const protectedFields = useRef(false);
  const explicitRef = useRef(explicitType);
  explicitRef.current = explicitType;
  const current = useRef(state);
  current.current = state;
  const textRef = useRef(text);
  textRef.current = text;
  const automaticCalls = useRef(0);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => sourceRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => () => {
    sequence.current++;
    controller.current?.abort();
    completionSession.cancel();
  }, []);
  useLayoutEffect(() => {
    if (contentKey(state.content.draft) === lastApplied.current) return;
    protectedFields.current = true;
    sequence.current++;
    controller.current?.abort();
    completionSession.cancel();
    setStatus('edited');
  }, [state.content.draft]);

  function apply(
    result: ReturnType<typeof prepareQuestionText>,
    proposed: Suggestions | null = null,
    captureUndo = true,
    settled = true,
  ) {
    const before = current.current.content.draft;
    const type = result.draft.type;
    if (!isTextQuestionType(type)) return;
    // Retain non-content author settings. The parser explicitly clears all answer-bearing fields.
    const prepared = { ...before, ...result.draft };
    // Apply target-type defaults only to a new preparation, never when Undo restores a snapshot.
    const withPreferences = type === before.type
      ? prepared
      : applyAuthoringPreferences(prepared, type, preferences);
    const next = result.draft.shuffle === undefined
      ? withPreferences
      : { ...withPreferences, shuffle: result.draft.shuffle };
    onPrepared(next);
    if (contentKey(next) !== contentKey(before)) {
      if (captureUndo) {
        setUndoDraft({
          draft: before,
          titleLocked: current.current.inspector.titleLocked,
          suggestions: suggestionsRef.current,
        });
      }
      setRedoDraft(null);
      current.current.inspector.setTitleLocked(true);
      current.current.content.setDraft(next);
    }
    lastApplied.current = contentKey(next);
    setFindings(result.findings);
    setSuggestions(proposed);
    suggestionsRef.current = proposed;
    current.current.content.setAssistancePending(!settled);
    setStatus('prepared');
    protectedFields.current = false;
  }

  async function prepare(source: string, automatic: boolean) {
    if (!source.trim() || source.length > QUESTION_TEXT_MAX_LENGTH || composing) return;
    if (
      automatic &&
      (protectedFields.current || source === lastText.current || source !== textRef.current)
    ) return;
    const draftAtRequest = contentKey(current.current.content.draft);
    current.current.content.setAssistancePending(true);
    const parsed = parseQuestionText(source);
    const localType = explicitRef.current ?? parsed.type;
    const revision = ++sequence.current;
    controller.current?.abort();
    lastText.current = source;
    if (localType && !needsQuestionComposition(source)) {
      completionSession.cancel();
      apply(
        prepareQuestionText(
          parsed,
          localType,
          recent.at(-1)?.choiceCount ?? 4,
          current.current.content.draft.itemLanguage,
        ),
      );
      return;
    }
    if (automatic && automaticCalls.current >= 10) {
      setStatus('uncertain');
      return;
    }
    if (automatic) automaticCalls.current++;
    const request = new AbortController();
    controller.current = request;
    setStatus('working');
    try {
      const response = await fetch(`/api/assessments/${assessmentId}/question-assistance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source, recent, explicitType: explicitRef.current }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
      });
      const decision = response.ok ? parseQuestionAssistanceDecision(await response.json()) : null;
      if (revision !== sequence.current || textRef.current !== source) return;
      if (contentKey(current.current.content.draft) !== draftAtRequest) {
        protectedFields.current = true;
        setStatus('edited');
        return;
      }
      if (!decision) {
        setStatus('unavailable');
        return;
      }
      if (!decision.composition) {
        setStatus('uncertain');
        return;
      }
      const question = decision.composition;
      const previous = suggestionsRef.current;
      if (
        question.complete && previous && question.shuffle !== previous.question.shuffle &&
        questionCompletionKey(question) === questionCompletionKey(previous.question)
      ) {
        // A presentation command changes only the setting, never existing question content.
        const wasProtected = protectedFields.current;
        const draft = current.current.content.draft;
        apply(
          { draft: { ...draft, shuffle: question.shuffle ?? draft.shuffle }, findings },
          { ...previous, question },
        );
        if (wasProtected) {
          protectedFields.current = true;
          setStatus('edited');
        }
        return;
      }
      if (!question.complete) completionSession.cancel();
      const language = current.current.content.draft.itemLanguage;
      apply(prepareQuestionComposition(question, language), null, true, !question.complete);
      if (question.complete) {
        current.current.content.setAssistancePending(true);
        setStatus('completing');
        const completion = await completionSession.complete(question);
        if (revision !== sequence.current || textRef.current !== source) return;
        if (!completion) {
          setStatus('completionFailed');
          return;
        }
        apply(prepareQuestionComposition(question, language, completion), {
          question,
          completion,
        }, false);
      }
    } catch {
      if (revision === sequence.current && !request.signal.aborted) setStatus('unavailable');
    }
  }

  useEffect(() => {
    if (composing || !text.trim() || text === lastText.current || protectedFields.current) return;
    const timer = setTimeout(() => {
      void prepare(text, true);
    }, 800);
    return () => clearTimeout(timer);
  }, [text, composing]);

  function changeText(value: string) {
    sequence.current++;
    controller.current?.abort();
    current.current.content.setAssistancePending(true);
    lastText.current = '';
    textRef.current = value;
    setFindings([]);
    setStatus(protectedFields.current ? 'edited' : 'idle');
    setText(value);
  }
  function restore(snapshot: Snapshot, direction: 'undo' | 'redo') {
    completionSession.cancel();
    sequence.current++;
    controller.current?.abort();
    const { draft, titleLocked, suggestions: restoredSuggestions } = snapshot;
    const displaced = {
      draft: current.current.content.draft,
      titleLocked: current.current.inspector.titleLocked,
      suggestions: suggestionsRef.current,
    };
    if (direction === 'undo') {
      setRedoDraft(displaced);
      setUndoDraft(null);
    } else {
      setUndoDraft(displaced);
      setRedoDraft(null);
    }
    lastApplied.current = contentKey(draft);
    current.current.inspector.setTitleLocked(titleLocked);
    onPrepared(draft);
    current.current.content.setDraft(draft);
    setSuggestions(restoredSuggestions);
    suggestionsRef.current = restoredSuggestions;
    current.current.content.setAssistancePending(false);
    protectedFields.current = true;
    lastText.current = textRef.current;
    setFindings([]);
    setStatus('edited');
  }
  function chooseType(value: string) {
    sequence.current++;
    controller.current?.abort();
    const type = isTextQuestionType(value) ? value : null;
    explicitRef.current = type;
    setExplicitType(type);
    // Selecting a type locks future inference; existing field edits require explicit replacement.
    if (!protectedFields.current && textRef.current.trim()) void prepare(textRef.current, false);
    else if (protectedFields.current) {
      completionSession.cancel();
      current.current.content.setAssistancePending(true);
      setStatus('edited');
    }
  }
  return (
    <QuestionTextPanel
      text={text}
      sourceRef={sourceRef}
      maxLength={QUESTION_TEXT_MAX_LENGTH}
      onText={changeText}
      onComposition={(active) => {
        setComposing(active);
        if (active) {
          current.current.content.setAssistancePending(true);
          lastText.current = '';
          sequence.current++;
          controller.current?.abort();
        }
      }}
      type={explicitType ?? state.content.draft.type}
      onType={chooseType}
      types={TEXT_QUESTION_TYPES.map((type) => ({
        value: type,
        label: i18n.t(`editor.assistance.type.${type}`),
      }))}
      status={i18n.t(`editor.assistance.status.${status}`)}
      findings={findings.map((finding) => i18n.t(`editor.assistance.${finding}`))}
      busy={status === 'working' || status === 'completing'}
      disabled={composing || !text.trim()}
      replacing={protectedFields.current}
      onUseEditor={() => {
        completionSession.cancel();
        sequence.current++;
        controller.current?.abort();
        protectedFields.current = true;
        lastText.current = textRef.current;
        current.current.content.setAssistancePending(false);
        setStatus('edited');
      }}
      onPrepare={() => {
        void prepare(text, false);
      }}
      onUndo={undoDraft ? () => restore(undoDraft, 'undo') : undefined}
      onRedo={redoDraft ? () => restore(redoDraft, 'redo') : undefined}
    >
      <QuestionComposerPreview draft={state.content.draft} suggestions={suggestions?.completion} />
    </QuestionTextPanel>
  );
}
