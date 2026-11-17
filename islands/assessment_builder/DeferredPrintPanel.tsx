import { useRetryableModule } from '../useRetryableModule.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import Button from '../../components/ui/Button.tsx';

const load = async (_key: 'print-panel') => (await import('./AssessmentPrintPanel.tsx')).default;
/** Keep the PDF viewer out of ordinary builder/QTI bundles until paper output is selected. */
export default function DeferredPrintPanel(
  props: {
    readonly assessmentId: string;
    readonly revisionFingerprint: string;
    readonly onRepairPrint?: (placementId: string) => void;
  },
) {
  const { state, retry } = useRetryableModule('print-panel', load), i18n = useI18n();
  if (state._tag === 'Ready') {
    const Panel = state.value;
    return <Panel {...props} />;
  }
  if (state._tag === 'Failed') {
    return (
      <div role='alert'>
        <p>{i18n.t('print.requestFailed')}</p>
        <Button type='button' onClick={retry}>{i18n.t('assessments.builder.tool.retry')}</Button>
      </div>
    );
  }
  return <p role='status'>{i18n.t('print.loading')}</p>;
}
