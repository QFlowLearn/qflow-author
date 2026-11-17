import { useEffect, useRef, useState } from 'preact/hooks';
import type { QtiExecutableTest, QtiTestSession } from '@longsightgroup/qti3-core';
import { adaptiveItemReferenceId } from '../../lib/assessment_adaptive_export.ts';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import BankQuestionPreview, { type BankPreviewContext } from './BankQuestionPreview.tsx';
import type { AssessmentView } from './types.ts';

type Engine = Pick<typeof import('@longsightgroup/qti3-core'), 'submitQtiTestAnswer'>;
type PreviewState = { kind: 'loading' } | { kind: 'failed' } | {
  kind: 'ready';
  test: QtiExecutableTest;
  session: QtiTestSession;
  engine: Engine;
};

/** Author answers the frozen QTI form using the same engine as delivery. */
export default function AdaptiveAnswerPreview(
  props: BankPreviewContext & {
    assessment: AssessmentView;
    onClose: () => void;
  },
) {
  const i18n = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [response, engine] = await Promise.all([
          fetch(`/api/assessments/${props.assessment.id}/adaptive-preview?scenario=answer`, {
            signal: controller.signal,
          }),
          import('@longsightgroup/qti3-core'),
        ]);
        const raw: unknown = await response.json();
        if (
          !response.ok || !raw || typeof raw !== 'object' || !('xml' in raw) ||
          typeof raw.xml !== 'string'
        ) throw new Error('Invalid preview.');
        const test = engine.parseQtiTest(raw.xml);
        if (!test.ok) throw new Error('Unsupported preview.');
        const started = engine.startQtiTest(test.value);
        if (!started.ok) throw new Error('Preview test cannot start.');
        if (!controller.signal.aborted) {
          setState({
            kind: 'ready',
            test: test.value,
            session: started.value,
            engine,
          });
        }
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'failed' });
      }
    }
    void load();
    return () => controller.abort();
  }, [props.assessment.id]);
  const answered = state.kind === 'ready' ? state.session.submissions.length : 0;
  useEffect(() => {
    heading.current?.focus();
  }, [answered]);
  const plan = props.assessment.adaptivePlan;
  if (!plan) throw new Error('Adaptive preview requires a plan.');
  const currentRef = state.kind === 'ready' && state.session.status === 'active'
    ? state.session.currentItemRef
    : null;
  const item = state.kind === 'ready'
    ? state.test.sections.flatMap((section) => section.items).find((item) =>
      item.identifier === currentRef
    )
    : null;
  const currentLevel = item
    ? plan.levels.find((_, index) => item.categories.includes(`QFLOW_LEVEL_${index}`))
    : null;
  const placement = item
    ? props.assessment.parts[0].placements.find((entry) =>
      adaptiveItemReferenceId(entry.id) === item.identifier
    )
    : null;
  if (currentRef && (!placement || !('itemId' in placement) || !placement.snapshotRev)) {
    throw new Error('Preview revision is missing.');
  }
  return (
    <section class='space-y-4' aria-labelledby='adaptive-answer-heading'>
      <div class='flex items-center justify-between gap-3'>
        <h2 id='adaptive-answer-heading' ref={heading} tabIndex={-1} class='font-semibold'>
          {i18n.t('adaptive.answerPreviewHeading')}
        </h2>
        <Button variant='text' onClick={props.onClose}>{i18n.t('adaptive.closePreview')}</Button>
      </div>
      {state.kind === 'loading' && <p role='status'>{i18n.t('adaptive.loading')}</p>}
      {state.kind === 'failed' && <p role='alert'>{i18n.t('adaptive.failed')}</p>}
      {state.kind === 'ready' && (state.session.status === 'completed'
        ? <p role='status'>{i18n.t('adaptive.previewCount', { count: answered })}</p>
        : placement && 'itemId' in placement && placement.snapshotRev && (
          <>
            <p role='status'>
              <span>
                {i18n.t('adaptive.progress', {
                  current: answered + 1,
                  count: plan.settings.questionCount,
                })}
              </span>
              {currentLevel && ` · ${currentLevel.label}`}
            </p>
            <BankQuestionPreview
              key={currentRef}
              itemId={placement.itemId}
              revision={placement.snapshotRev}
              payload={props.payload}
              playerCatalog={props.playerCatalog}
              scoreLabel={i18n.t('adaptive.submit')}
              onScored={(answer) => {
                if (state.session.status !== 'active') return;
                const score = answer.outcomes.SCORE;
                if (score !== 0 && score !== 1) {
                  setState({ kind: 'failed' });
                  return;
                }
                const next = state.engine.submitQtiTestAnswer(state.test, state.session, {
                  itemRef: state.session.currentItemRef,
                  score,
                });
                setState(next.ok ? { ...state, session: next.value } : { kind: 'failed' });
              }}
            />
          </>
        ))}
    </section>
  );
}
