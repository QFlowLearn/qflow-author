import Button from '../../components/ui/Button.tsx';
import type {
  AssessmentBlueprint,
  AssessmentBlueprintCoverage,
} from '../../lib/assessment_blueprint.ts';
import { ASSESSMENT_TOOL_IDS } from '../../lib/assessment_authoring_tool.ts';
import type { DeliveryPublishCapability } from '../../lib/delivery_publish.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useRetryableModule } from '../useRetryableModule.ts';
import type { AssessmentSettingsPanelProps } from './AssessmentSettingsPanel.tsx';

type PlanToolProps = {
  readonly activeTool: typeof ASSESSMENT_TOOL_IDS.plan;
  readonly assessmentId: string;
  readonly blueprint: AssessmentBlueprint;
  readonly coverage?: AssessmentBlueprintCoverage;
  readonly onBlueprintSaved: (blueprint: AssessmentBlueprint) => void;
  readonly payload: I18nPayload;
};

type ExportToolProps = {
  readonly activeTool: typeof ASSESSMENT_TOOL_IDS.export;
  readonly assessmentId: string;
  readonly revisionFingerprint: string;
  readonly onRepairPrint?: (placementId: string) => void;
  readonly publishedVersionId?: string;
  readonly deliveryCapability: DeliveryPublishCapability;
  readonly busy: boolean;
  readonly onPublish: () => void;
};

type AssessmentToolPanelProps = PlanToolProps | ExportToolProps;

async function loadAssessmentPlan(_key: typeof ASSESSMENT_TOOL_IDS.plan) {
  const module = await import('../BlueprintPanel.tsx');
  return module.default;
}

async function loadAssessmentExport(_key: typeof ASSESSMENT_TOOL_IDS.export) {
  const [preflightModule, deliveryModule, reviewModule] = await Promise.all([
    import('./AssessmentExportPreflight.tsx'),
    import('./HostedDeliveryPanel.tsx'),
    import('./AssessmentPublicationReview.tsx'),
  ]);
  return {
    Preflight: preflightModule.default,
    Delivery: deliveryModule.default,
    Review: reviewModule.default,
  };
}

function DeferredAssessmentPlan(props: PlanToolProps) {
  const i18n = useI18n();
  const { state, retry } = useRetryableModule(props.activeTool, loadAssessmentPlan);

  if (state._tag === 'Loading') {
    return (
      <div id={props.activeTool} class='py-5 text-sm text-base-content/65' role='status'>
        {i18n.t('assessments.builder.tool.loadingPlan')}
      </div>
    );
  }
  if (state._tag === 'Failed') {
    return (
      <div id={props.activeTool} class='ds-alert ds-alert-error' role='alert'>
        <div>
          <div class='font-medium'>{i18n.t('assessments.builder.tool.planFailed')}</div>
          <Button class='mt-3' size='sm' type='button' onClick={retry}>
            {i18n.t('assessments.builder.tool.retry')}
          </Button>
        </div>
      </div>
    );
  }

  const Panel = state.value;
  return (
    <div id={props.activeTool}>
      <Panel
        resource='assessment'
        resourceId={props.assessmentId}
        initialBlueprint={props.blueprint}
        coverage={props.coverage}
        onSaved={props.onBlueprintSaved}
        payload={props.payload}
      />
    </div>
  );
}

function DeferredAssessmentExport(props: ExportToolProps) {
  const i18n = useI18n();
  const { state, retry } = useRetryableModule(props.activeTool, loadAssessmentExport);

  if (state._tag === 'Loading') {
    return (
      <div id={props.activeTool} class='py-5 text-sm text-base-content/65' role='status'>
        {i18n.t('assessments.builder.tool.loadingExport')}
      </div>
    );
  }
  if (state._tag === 'Failed') {
    return (
      <div id={props.activeTool} class='ds-alert ds-alert-error' role='alert'>
        <div>
          <div class='font-medium'>{i18n.t('assessments.builder.tool.exportFailed')}</div>
          <Button class='mt-3' size='sm' type='button' onClick={retry}>
            {i18n.t('assessments.builder.tool.retry')}
          </Button>
        </div>
      </div>
    );
  }

  const { Preflight, Delivery, Review } = state.value;
  return (
    <div id={props.activeTool}>
      {props.publishedVersionId && (
        <Review
          assessmentId={props.assessmentId}
          revisionFingerprint={`${props.publishedVersionId}:${props.revisionFingerprint}`}
        />
      )}
      <Delivery
        capability={props.deliveryCapability}
        busy={props.busy}
        onPublish={props.onPublish}
      />
      <details class='mt-6 border-t border-base-300 pt-3'>
        <summary class='cursor-pointer py-2 font-medium'>{i18n.t('publication.download')}</summary>
        <Preflight
          assessmentId={props.assessmentId}
          revisionFingerprint={props.revisionFingerprint}
          onRepairPrint={props.onRepairPrint}
        />
      </details>
    </div>
  );
}

/** Loads and mounts only the secondary tool selected by the current authoring URL. */
export default function AssessmentToolPanel(props: AssessmentToolPanelProps) {
  if (props.activeTool === ASSESSMENT_TOOL_IDS.plan) {
    return <DeferredAssessmentPlan {...props} />;
  }
  return <DeferredAssessmentExport {...props} />;
}

async function loadAssessmentSettings(_key: 'assessment-settings') {
  return (await import('./AssessmentSettingsPanel.tsx')).default;
}

/** Keep the deferred inspector mounted after first opening so closing retains raw edits. */
export function DeferredAssessmentSettings(props: AssessmentSettingsPanelProps) {
  const i18n = useI18n();
  const { state, retry } = useRetryableModule('assessment-settings', loadAssessmentSettings);
  if (state._tag === 'Ready') {
    const Panel = state.value;
    return <Panel {...props} />;
  }
  if (!props.open) return null;
  return (
    <div role={state._tag === 'Failed' ? 'alert' : 'status'}>
      <p>
        {i18n.t(
          state._tag === 'Failed'
            ? 'assessments.settings.loadFailed'
            : 'assessments.settings.loading',
        )}
      </p>
      {state._tag === 'Failed' && (
        <Button type='button' onClick={retry}>{i18n.t('assessments.builder.tool.retry')}</Button>
      )}
      <Button type='button' onClick={props.onClose}>{i18n.t('assessments.settings.close')}</Button>
    </div>
  );
}
