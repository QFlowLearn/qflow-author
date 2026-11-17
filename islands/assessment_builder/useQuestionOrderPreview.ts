import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AssessmentQuestionOrderPreview } from '../../lib/assessment_question_order_preview.ts';
import type { QuestionOrderPreviewRead } from '../../lib/client/assessment_question_order_preview.ts';
import type { CapturedAssessmentParts } from '../../components/assessment_builder/useAssessmentParts.ts';
import type { ItemMeta, Part } from './types.ts';

type PreviewState =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'ready'; readonly value: AssessmentQuestionOrderPreview }
  | {
    readonly kind: 'failed';
    readonly reason: Exclude<Extract<QuestionOrderPreviewRead, { ok: false }>['kind'], 'cancelled'>;
  };

type PreviewRequest = { readonly controller: AbortController; phase: 'guard' | 'reading' };

/** Examples own only their read lifetime; all saved order and question writes retain their owners. */
export function useQuestionOrderPreview(input: {
  readonly assessmentId: string;
  readonly parts: readonly Part[];
  readonly items: Readonly<Record<string, ItemMeta>>;
  readonly blocked: boolean;
  readonly captureOrder: () => CapturedAssessmentParts;
  readonly guardQuestionDraft: () => Promise<boolean>;
}) {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });
  const current = useRef(input);
  const alive = useRef(true);
  const request = useRef<PreviewRequest | null>(null);
  useLayoutEffect(() => {
    current.current = input;
  });
  useLayoutEffect(() => {
    // A successful question-draft guard may save content; capture that confirmed state afterwards.
    if (!input.blocked && request.current?.phase === 'guard') return;
    request.current?.controller.abort();
    request.current = null;
    setState({ kind: 'idle' });
  }, [input.parts, input.items, input.blocked]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.controller.abort();
      request.current = null;
    };
  }, []);

  async function generate() {
    if (current.current.blocked || request.current || !alive.current) return;
    const read: PreviewRequest = { controller: new AbortController(), phase: 'guard' };
    request.current = read;
    setState({ kind: 'loading' });
    const active = () =>
      alive.current && request.current === read && !read.controller.signal.aborted;
    try {
      const proceed = await current.current.guardQuestionDraft();
      if (!active()) return;
      if (!proceed || current.current.blocked) {
        setState({ kind: 'idle' });
        return;
      }
      read.phase = 'reading';
      const capture = current.current.captureOrder();
      const parts = capture.parts;
      capture.release();
      const [{ assessmentArrangementVersion }, { readQuestionOrderPreview }] = await Promise.all([
        import('../../lib/assessment_arrangement_version.ts'),
        import('../../lib/client/assessment_question_order_preview.ts'),
      ]);
      if (!active()) return;
      const version = await assessmentArrangementVersion(current.current.assessmentId, parts);
      if (!active()) return;
      const result = await readQuestionOrderPreview({
        assessmentId: current.current.assessmentId,
        version,
        parts,
        signal: read.controller.signal,
      });
      if (!active()) return;
      setState(
        result.ok
          ? { kind: 'ready', value: result.value }
          : result.kind === 'cancelled'
          ? { kind: 'idle' }
          : { kind: 'failed', reason: result.kind },
      );
    } catch (_cause: unknown) {
      if (active()) setState({ kind: 'failed', reason: 'failed' });
    } finally {
      if (request.current === read) request.current = null;
    }
  }
  return { state, generate, busy: state.kind === 'loading' };
}
