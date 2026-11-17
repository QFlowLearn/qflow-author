import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  AssessmentQuestionPointDefault,
  AssessmentQuestionPointDefaultCommand,
} from '../../lib/assessment_question_defaults.ts';
import {
  readAssessmentPointDefault,
  saveAssessmentPointDefault,
} from '../../lib/client/assessment_question_defaults.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import { parseQuestionPointsInput, questionPointsInputText } from '../../lib/question_points.ts';

type PointDefaultEditState =
  | { readonly _tag: 'Idle' | 'Saved' | 'Conflict' | 'Rejected' | 'Refreshing' | 'RefreshFailed' }
  | {
    readonly _tag: 'Saving' | 'Uncertain';
    readonly command: AssessmentQuestionPointDefaultCommand;
  };

/** Preserve raw input, exact uncertain retries and later edits independently of confirmed policy. */
export function useAssessmentPointDefault(input: {
  readonly assessmentId: string;
  readonly initial: AssessmentQuestionPointDefault;
  readonly onConfirmed: (value: AssessmentQuestionPointDefault) => void;
}) {
  const i18n = useI18n();
  const [confirmed, setConfirmed] = useState(input.initial);
  const [text, setText] = useState(() =>
    questionPointsInputText(input.initial ?? undefined, i18n.locale)
  );
  const [touched, setTouched] = useState(false);
  const [state, setState] = useState<PointDefaultEditState>({ _tag: 'Idle' });
  const latest = useRef({ text, confirmed, state });
  latest.current = { text, confirmed, state };
  const callback = useRef(input.onConfirmed);
  callback.current = input.onConfirmed;
  const request = useRef<AbortController | null>(null);
  const exiting = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  const parsed = parseQuestionPointsInput(text, i18n.locale);
  const dirty = parsed._tag === 'Invalid' ||
    (parsed._tag === 'Value' ? parsed.value : null) !== confirmed;
  const busy = state._tag === 'Saving' || state._tag === 'Refreshing';
  const needsRefresh = state._tag === 'Conflict' || state._tag === 'RefreshFailed';
  const blocked = dirty || busy || state._tag === 'Uncertain' || needsRefresh;
  useEffect(() => {
    if (!blocked) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (exiting.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', warn);
    return () => globalThis.removeEventListener('beforeunload', warn);
  }, [blocked]);

  function confirm(value: AssessmentQuestionPointDefault) {
    latest.current.confirmed = value;
    setConfirmed(value);
    callback.current(value);
  }
  function transition(next: PointDefaultEditState) {
    latest.current.state = next;
    setState(next);
  }
  async function save() {
    if (
      request.current || latest.current.state._tag === 'Conflict' ||
      latest.current.state._tag === 'RefreshFailed'
    ) return;
    const candidate = parseQuestionPointsInput(latest.current.text, i18n.locale);
    const pending = latest.current.state;
    if (pending._tag !== 'Uncertain' && candidate._tag === 'Invalid') {
      setTouched(true);
      return;
    }
    const command = pending._tag === 'Uncertain' ? pending.command : {
      expected: latest.current.confirmed,
      desired: candidate._tag === 'Value' ? candidate.value : null,
    };
    if (pending._tag !== 'Uncertain' && command.expected === command.desired) return;
    const controller = new AbortController();
    request.current = controller;
    transition({ _tag: 'Saving', command });
    try {
      const outcome = await saveAssessmentPointDefault(
        input.assessmentId,
        command,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (outcome._tag === 'Saved') {
        confirm(outcome.value);
        transition({ _tag: 'Saved' });
      } else if (outcome._tag === 'Uncertain') transition({ _tag: 'Uncertain', command });
      else if (outcome._tag === 'Conflict' || outcome._tag === 'Rejected') {
        transition({ _tag: outcome._tag });
      }
    } finally {
      request.current = null;
    }
  }
  async function refresh() {
    if (request.current || latest.current.state._tag === 'Uncertain') return;
    const controller = new AbortController();
    request.current = controller;
    transition({ _tag: 'Refreshing' });
    try {
      const outcome = await readAssessmentPointDefault(input.assessmentId, controller.signal);
      if (controller.signal.aborted) return;
      if (outcome._tag === 'Found') {
        confirm(outcome.value);
        transition({ _tag: 'Idle' });
      } else transition({ _tag: 'RefreshFailed' });
    } finally {
      request.current = null;
    }
  }
  return {
    text,
    confirmed,
    dirty,
    busy,
    blocked,
    status: state._tag,
    inputInvalid: parsed._tag === 'Invalid',
    invalid: touched && parsed._tag === 'Invalid',
    canSave: !busy && !needsRefresh && (dirty || state._tag === 'Uncertain'),
    save,
    refresh,
    blur: () => setTouched(true),
    change: (next: string) => {
      latest.current.text = next;
      setText(next);
      setTouched(false);
    },
    allowExit: () => {
      exiting.current = true;
    },
  };
}
