import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import {
  type AssessmentPublicationReview as Review,
  parseAssessmentPublicationReview,
} from '../../lib/assessment_publication_review.ts';
import Button from '../../components/ui/Button.tsx';

/** Load a publication comparison only in the publishing workspace. */
export default function AssessmentPublicationReview(
  props: { assessmentId: string; revisionFingerprint: string },
) {
  const i18n = useI18n();
  const [review, setReview] = useState<Review | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReview(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/assessments/${props.assessmentId}/publication-status?review=1`,
          { signal: controller.signal },
        );
        const result = response.ok ? parseAssessmentPublicationReview(await response.json()) : null;
        if (!controller.signal.aborted) setReview(result ?? { status: 'unavailable' });
      } catch {
        if (!controller.signal.aborted) setReview({ status: 'unavailable' });
      }
    })();
    return () => controller.abort();
  }, [props.assessmentId, props.revisionFingerprint, retry]);
  return (
    <section id='publication-review' class='space-y-3 pb-4 scroll-mt-24'>
      <h3 class='font-semibold'>{i18n.t('publication.changesHeading')}</h3>
      <p role='status'>{i18n.t(`publication.${review?.status ?? 'checking'}`)}</p>
      {review?.status === 'changed' && (
        <>
          {review.structureChanged && <p>{i18n.t('publication.structureChanged')}</p>}
          {(['added', 'removed', 'edited'] as const).map((kind) =>
            review[kind].length > 0 && (
              <details key={kind}>
                <summary class='cursor-pointer py-2'>
                  {i18n.t(`publication.${kind}`, { count: review[kind].length })}
                </summary>
                <ul class='list-disc pl-5'>
                  {review[kind].map((title, index) => <li key={index}>{title}</li>)}
                </ul>
              </details>
            )
          )}
          <p class='text-sm text-base-content/80'>{i18n.t('publication.changeEffect')}</p>
        </>
      )}
      {review?.status === 'unavailable' && (
        <Button
          variant='text'
          onClick={() => setRetry(retry + 1)}
        >
          {i18n.t('publication.retry')}
        </Button>
      )}
    </section>
  );
}
