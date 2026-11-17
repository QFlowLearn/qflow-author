import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { AssessmentPublicationStatus as PublicationStatus } from '../../lib/assessment_publication_status.ts';
import Button from '../../components/ui/Button.tsx';

/** Compare content without delaying the page or inferring freshness from dates. */
export default function AssessmentPublicationStatus(props: {
  assessmentId: string;
  versionId: string;
  revisionFingerprint: string;
}) {
  const i18n = useI18n();
  const [status, setStatus] = useState<PublicationStatus | 'checking'>('checking');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('checking');
    async function check() {
      try {
        const response = await fetch(`/api/assessments/${props.assessmentId}/publication-status`, {
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (
          !response.ok || !data || typeof data !== 'object' || !('status' in data) ||
          (data.status !== 'current' && data.status !== 'changed' && data.status !== 'unavailable')
        ) {
          if (!controller.signal.aborted) setStatus('unavailable');
          return;
        }
        if (!controller.signal.aborted) setStatus(data.status);
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      }
    }
    void check();
    return () => controller.abort();
  }, [props.assessmentId, props.versionId, props.revisionFingerprint, retry]);
  return (
    <span class='inline-flex flex-wrap items-center gap-2'>
      <span role='status'>{i18n.t(`publication.${status}`)}</span>
      {status === 'changed' && (
        <Button
          variant='text'
          href={`/assessments/${props.assessmentId}?tool=assessment-export#publication-review`}
        >
          {i18n.t('publication.reviewChanges')}
        </Button>
      )}
      {status === 'unavailable' && (
        <Button variant='text' onClick={() => setRetry(retry + 1)}>
          {i18n.t('publication.retry')}
        </Button>
      )}
    </span>
  );
}
