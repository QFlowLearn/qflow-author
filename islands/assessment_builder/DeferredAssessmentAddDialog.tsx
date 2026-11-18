import { uiEvent } from '../../lib/client/ui_event.ts';
import type { ComponentChildren, ComponentProps } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type AssessmentAddDialog from './AssessmentAddDialog.tsx';
import { useRetryableModule } from '../useRetryableModule.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import Alert from '../../components/ui/Alert.tsx';
import Button from '../../components/ui/Button.tsx';
import QuestionPersistenceNotice from '../../components/ui/QuestionPersistenceNotice.tsx';

const KEY = 'assessment-add-picker' as const;
async function load(_key: typeof KEY) {
  const module = await import('./AssessmentAddDialog.tsx');
  return module.default;
}

/** Keep the persistent tools ready; load question choices only inside the opened picker. */
export default function DeferredAssessmentAddDialog(
  props: ComponentProps<typeof AssessmentAddDialog> & {
    readonly onReloadControls: () => Promise<unknown>;
  },
) {
  const i18n = useI18n();
  const { state } = useRetryableModule(KEY, load);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const picker = container.current?.closest('[data-floating-picker]');
    if (
      state._tag === 'Ready' && globalThis.innerWidth >= 1024 && document.activeElement === picker
    ) {
      container.current?.querySelector<HTMLElement>('[data-picker-focus], [data-focus-type-search]')
        ?.focus({ preventScroll: true });
    }
  }, [state]);
  let content: ComponentChildren;
  if (state._tag === 'Loading') {
    content = (
      <QuestionPersistenceNotice tone='neutral' message={i18n.t('editor.loadingControls')} />
    );
  } else if (state._tag === 'Failed') {
    content = (
      <Alert tone='warning' role='alert'>
        <p>{i18n.t('editor.controlsFailed')}</p>
        <Button type='button' onClick={uiEvent(props.onReloadControls)}>
          {i18n.t('assessments.builder.library.reload')}
        </Button>
        <Button type='button' onClick={props.onClose}>
          {i18n.t('assessments.builder.closeAddDialog')}
        </Button>
      </Alert>
    );
  } else {
    const Picker = state.value;
    content = <Picker {...props} />;
  }
  return <div ref={container}>{content}</div>;
}
