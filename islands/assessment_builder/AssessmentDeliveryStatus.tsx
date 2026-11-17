import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import {
  type DeliveryAssessmentStatus,
  parseDeliveryAssessmentStatus,
} from '../../lib/delivery_status.ts';
import Button from '../../components/ui/Button.tsx';

export default function AssessmentDeliveryStatus(
  props: { assessmentId: string; versionId: string },
) {
  const i18n = useI18n();
  const [state, setState] = useState<DeliveryAssessmentStatus | 'loading' | 'unavailable'>(
    'loading',
  );
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void (async () => {
      try {
        const response = await fetch(`/api/assessments/${props.assessmentId}/delivery-status`, {
          signal: controller.signal,
        });
        const status = response.ok
          ? parseDeliveryAssessmentStatus(await response.json(), props.versionId)
          : null;
        if (!controller.signal.aborted) setState(status ?? 'unavailable');
      } catch {
        if (!controller.signal.aborted) setState('unavailable');
      }
    })();
    return () => controller.abort();
  }, [props.assessmentId, props.versionId, refresh]);
  return (
    <div class='space-y-1 text-sm'>
      <p class='font-medium'>{i18n.t('delivery.status.heading')}</p>
      <p role='status'>
        {typeof state === 'string'
          ? i18n.t(`delivery.status.${state}`)
          : state.active + state.draft + state.closed === 0
          ? i18n.t('delivery.status.empty')
          : i18n.t('delivery.status.counts', state)}
      </p>
      <Button
        variant='text'
        size='sm'
        disabled={state === 'loading'}
        onClick={() => setRefresh(refresh + 1)}
      >
        {i18n.t('delivery.status.refresh')}
      </Button>
    </div>
  );
}
