import AssessmentDeliveryStatus from './AssessmentDeliveryStatus.tsx';
import type { ComponentChildren } from 'preact';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { ASSESSMENT_TOOL_IDS, assessmentToolHref } from '../../lib/assessment_authoring_tool.ts';
import type { AssessmentView } from './types.ts';

export default function AssessmentPublication(
  props: { assessment: AssessmentView; children?: ComponentChildren },
) {
  const i18n = useI18n();
  return (
    <section
      id='assessment-publication'
      aria-labelledby='assessment-publication-heading'
      class='space-y-3 border-t border-base-300 pt-5 scroll-mt-24'
    >
      <h2 id='assessment-publication-heading' class='text-lg font-semibold'>
        {i18n.t('publication.heading')}
      </h2>
      <p class='max-w-prose text-sm text-base-content/80'>{i18n.t('publication.description')}</p>
      {props.assessment.delivery && (
        <AssessmentDeliveryStatus
          assessmentId={props.assessment.id}
          versionId={props.assessment.delivery.assessmentVersionId}
        />
      )}
      <div class='flex flex-wrap gap-3'>
        {!props.children && (
          <Button
            href={`${
              assessmentToolHref(props.assessment.id, ASSESSMENT_TOOL_IDS.export)
            }#assessment-publication`}
          >
            {i18n.t('publication.review')}
          </Button>
        )}
        {props.assessment.delivery?.adminUrl && (
          <Button href={props.assessment.delivery.adminUrl} target='_blank' rel='noreferrer'>
            {i18n.t('list.builder.header.manage')}
          </Button>
        )}
      </div>
      {props.children}
      {props.assessment.delivery && (
        <details class='text-sm'>
          <summary class='cursor-pointer py-2'>{i18n.t('publication.details')}</summary>
          <p class='break-all font-mono'>{props.assessment.delivery.assessmentVersionId}</p>
        </details>
      )}
    </section>
  );
}
