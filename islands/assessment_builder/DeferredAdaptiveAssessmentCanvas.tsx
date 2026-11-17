import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useRetryableModule } from '../useRetryableModule.ts';
import type { AdaptiveCanvasProps } from './AdaptiveAssessmentCanvas.tsx';

async function loadCanvas(_key: 'adaptive-assessment') {
  return (await import('./AdaptiveAssessmentCanvas.tsx')).default;
}

/** Fixed assessments do not load adaptive authoring or preview code. */
export default function DeferredAdaptiveAssessmentCanvas(props: AdaptiveCanvasProps) {
  const i18n = useI18n();
  const [opened, setOpened] = useState(Boolean(props.assessment.adaptivePlan));
  if (!opened) {
    return (
      <Button
        onClick={() => {
          setOpened(true);
          props.onSetupChange?.(true);
        }}
      >
        {i18n.t('adaptive.title')}
      </Button>
    );
  }
  return (
    <LoadedCanvas
      {...props}
      onSetupChange={(open) => {
        props.onSetupChange?.(open);
        if (!open && !props.assessment.adaptivePlan) setOpened(false);
      }}
    />
  );
}

function LoadedCanvas(props: AdaptiveCanvasProps) {
  const i18n = useI18n();
  const { state, retry } = useRetryableModule('adaptive-assessment', loadCanvas);
  if (state._tag === 'Loading') return <p role='status'>{i18n.t('adaptive.loading')}</p>;
  if (state._tag === 'Failed') {
    return (
      <div role='alert'>
        <p>{i18n.t('adaptive.failed')}</p>
        <Button onClick={retry}>{i18n.t('assessments.builder.library.retry')}</Button>
      </div>
    );
  }
  const Canvas = state.value;
  return <Canvas {...props} />;
}
