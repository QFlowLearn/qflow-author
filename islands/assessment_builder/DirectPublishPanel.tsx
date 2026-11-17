import type { AssessmentExportSelection } from '../../lib/client/assessment_export_workflow.ts';
import type { AssessmentExportPreflightView } from '../../lib/export/assessment_export_preflight_client.ts';
import type { SelectableAssessmentExportTarget } from '../../lib/export/assessment_export_targets.ts';
import CanvasDirectPublish from './CanvasDirectPublish.tsx';

type Props = {
  readonly assessmentId: string;
  readonly target: SelectableAssessmentExportTarget;
  readonly selection: AssessmentExportSelection;
  readonly preflight: Extract<AssessmentExportPreflightView, { readonly _tag: 'Evaluated' }>;
};

/** Renders the integration declared by the selected executable export target. */
export default function DirectPublishPanel(
  { assessmentId, target, selection, preflight }: Props,
) {
  if (target.directPublish === null) return null;
  switch (target.directPublish.provider) {
    case 'canvas':
      if (selection.targetId !== target.id) {
        throw new Error('Canvas direct-publish capability is attached to an invalid target.');
      }
      return (
        <CanvasDirectPublish
          key={preflight.preflightId}
          assessmentId={assessmentId}
          selection={{ ...selection, targetId: target.id }}
          preflight={preflight}
        />
      );
  }
}
