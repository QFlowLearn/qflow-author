import type { ComponentProps } from 'preact';
import type AuthoringPreferenceControls from '../../islands/assessment_builder/AuthoringPreferenceControls.tsx';
import { useRetryableModule } from '../../islands/useRetryableModule.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import Button from '../ui/Button.tsx';

async function loadPreferences(_key: 'authoring-preferences') {
  return (await import('../../islands/assessment_builder/AuthoringPreferenceControls.tsx')).default;
}

/** Advanced preference explanations load with the question inspector through the existing seam. */
export default function DeferredAuthoringPreferenceControls(
  props: ComponentProps<typeof AuthoringPreferenceControls>,
) {
  const { t } = useI18n();
  const { state, retry } = useRetryableModule('authoring-preferences', loadPreferences);
  if (state._tag === 'Ready') {
    const Controls = state.value;
    return <Controls {...props} />;
  }
  return (
    <div role={state._tag === 'Failed' ? 'alert' : 'status'}>
      <p>
        {t(
          state._tag === 'Failed'
            ? 'assessments.settings.loadFailed'
            : 'assessments.settings.loading',
        )}
      </p>
      {state._tag === 'Failed' && (
        <Button type='button' onClick={retry}>{t('assessments.builder.tool.retry')}</Button>
      )}
    </div>
  );
}
