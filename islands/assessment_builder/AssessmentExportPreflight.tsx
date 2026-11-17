import { useEffect, useReducer, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';

import Button from '../../components/ui/Button.tsx';
import Alert from '../../components/ui/Alert.tsx';
import Disclosure from '../../components/ui/Disclosure.tsx';
import AssessmentExportDestinationSelect from './AssessmentExportDestinationSelect.tsx';
import DeferredPrintPanel from './DeferredPrintPanel.tsx';
import {
  downloadAssessmentExportPackage,
  saveAssessmentExportPackage,
} from '../../lib/client/assessment_export_package.ts';
import {
  assessmentExportSelectionKey,
  createAssessmentExportWorkflow,
  reduceAssessmentExportWorkflow,
} from '../../lib/client/assessment_export_workflow.ts';
import type {
  AssessmentExportPreflightFailure,
  AssessmentExportPreflightItemView,
  AssessmentExportPreflightMappingView,
  AssessmentExportPreflightView,
  AssessmentExportRepairView,
} from '../../lib/export/assessment_export_preflight_client.ts';
import type { AssessmentExportPackageFailure } from '../../lib/client/assessment_export_package.ts';
import type { SelectableAssessmentExportTargetId } from '../../lib/export/assessment_export_targets.ts';
import { loadAssessmentExportPreflight } from '../../lib/export/assessment_export_preflight_client.ts';
import {
  listSelectableAssessmentExportTargets,
  resolveAssessmentExportTarget,
} from '../../lib/export/assessment_export_targets.ts';
import DirectPublishPanel from './DirectPublishPanel.tsx';

type Props = {
  readonly assessmentId: string;
  readonly revisionFingerprint: string;
  readonly onRepairPrint?: (placementId: string) => void;
};

const selectableTargets = listSelectableAssessmentExportTargets();

export default function AssessmentExportPreflight(
  { assessmentId, revisionFingerprint, onRepairPrint }: Props,
) {
  const i18n = useI18n();
  const [paperSelected, setPaperSelected] = useState(false);
  const [state, dispatch] = useReducer(
    reduceAssessmentExportWorkflow,
    revisionFingerprint,
    createAssessmentExportWorkflow,
  );
  const stateRevision = state._tag === 'Idle'
    ? state.revisionFingerprint
    : state.selection.revisionFingerprint;
  const targetId = state._tag === 'Idle' ? null : state.selection.targetId;

  useEffect(() => {
    if (stateRevision !== revisionFingerprint) {
      dispatch({ _tag: 'RevisionChanged', revisionFingerprint });
    }
  }, [stateRevision, revisionFingerprint]);

  useEffect(() => {
    if (state._tag !== 'Loading') return;
    const selection = state.selection;
    const controller = new AbortController();
    loadAssessmentExportPreflight(
      assessmentId,
      selection.targetId,
      selection.requirements,
      {
        signal: controller.signal,
      },
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        dispatch({
          _tag: 'PreflightFailed',
          selection,
          error: result.error,
        });
        return;
      }
      dispatch({ _tag: 'PreflightLoaded', selection, preflight: result.preflight });
    }).catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      dispatch({
        _tag: 'PreflightFailed',
        selection,
        error: { code: 'PreflightRequestFailed' },
      });
    });
    return () => controller.abort();
  }, [
    assessmentId,
    state._tag === 'Loading' ? assessmentExportSelectionKey(state.selection) : null,
  ]);

  const selectTarget = (value: string) => {
    setPaperSelected(value === 'printable-pack');
    if (value === 'printable-pack') {
      dispatch({ _tag: 'TargetSelected', targetId: null });
      return;
    }
    if (value.length === 0) {
      dispatch({ _tag: 'TargetSelected', targetId: null });
      return;
    }
    const resolved = resolveAssessmentExportTarget(value);
    if (!resolved.ok) return;
    dispatch({ _tag: 'TargetSelected', targetId: resolved.target.id });
  };

  const downloadPackage = async () => {
    if (
      state._tag !== 'Ready' ||
      state.preflight._tag !== 'Evaluated' ||
      state.preflight.overallOutcome === 'blocked' ||
      state.download._tag === 'Downloading' ||
      state.selection.revisionFingerprint !== revisionFingerprint
    ) return;
    // Downloading accepts this exact derivative with its consequences disclosed above the action.
    dispatch({ _tag: 'WarningsAcknowledged', accepted: true });
    dispatch({ _tag: 'DownloadStarted' });
    const result = await downloadAssessmentExportPackage({
      assessmentId,
      selection: state.selection,
      preflight: state.preflight,
    });
    if (!result.ok) {
      dispatch({ _tag: 'DownloadFailed', failure: result.failure });
      return;
    }
    saveAssessmentExportPackage(result.blob, result.filename);
    dispatch({ _tag: 'DownloadCompleted', receiptUrl: result.receiptUrl });
  };

  const readyState = state._tag === 'Ready' ? state : null;
  const readyPreflight = readyState?.preflight ?? null;
  const selectedTarget = targetId === null
    ? null
    : selectableTargets.find((target) => target.id === targetId) ?? null;
  const revisionIsCurrent = stateRevision === revisionFingerprint;
  const exportsStandardQuiz = readyPreflight?.packageDiagnosticCodes.includes(
    'qflow.export.adaptive_sequence_omitted',
  ) ?? false;
  const packageConsequences = readyPreflight?.packageDiagnosticCodes.flatMap((code) => {
    switch (code) {
      case 'qflow.export.adaptive_sequence_omitted':
      case 'product_import_evidence.not_recorded':
      case 'profile_release_evidence.not_recorded':
      case 'qti3_conformance.not_run':
        return [];
      default: {
        const explanation = diagnosticExplanation(i18n, code);
        return explanation === null ? [] : [explanation];
      }
    }
  }) ?? [];

  return (
    <section
      aria-labelledby='assessment-export-preflight-heading'
      class='border-y border-base-300 bg-base-100 px-4 py-5 sm:px-6'
    >
      <div class='flex flex-wrap items-start justify-between gap-4'>
        <div class='max-w-2xl'>
          <h2
            id='assessment-export-preflight-heading'
            class='text-base font-semibold text-base-content'
          >
            {i18n.t('delivery.preflight.title')}
          </h2>
          <p class='mt-1 text-sm leading-6 text-base-content/70'>
            {i18n.t('delivery.preflight.subtitle')}
          </p>
          <p class='mt-1 text-xs leading-5 text-base-content/60'>
            {i18n.t('delivery.preflight.portability')}{' '}
            <a class='ds-link' href='/help/portability'>
              {i18n.t('delivery.preflight.portabilityLink')}
            </a>
          </p>
        </div>
        {readyPreflight && revisionIsCurrent && (
          <OutcomeBadge
            i18n={i18n}
            outcome={readyPreflight.overallOutcome}
            standardQuiz={exportsStandardQuiz}
          />
        )}
      </div>

      <AssessmentExportDestinationSelect
        value={paperSelected ? 'printable-pack' : targetId ?? ''}
        onChange={selectTarget}
        targetLabel={(id) => targetLabel(i18n, id)}
      />
      {paperSelected && (
        <DeferredPrintPanel
          assessmentId={assessmentId}
          revisionFingerprint={revisionFingerprint}
          onRepairPrint={onRepairPrint}
        />
      )}

      <div class='mt-5' aria-live='polite' aria-atomic='true'>
        {!paperSelected && state._tag === 'Idle' && revisionIsCurrent && (
          <p class='text-sm text-base-content/65'>
            {i18n.t('delivery.preflight.idle')}
          </p>
        )}
        {(state._tag === 'Loading' || !revisionIsCurrent) && <PreflightLoading i18n={i18n} />}
        {state._tag === 'Failed' && revisionIsCurrent && (
          <div class='ds-alert ds-alert-error' role='alert'>
            <div>
              <div class='font-medium'>{i18n.t('delivery.preflight.failedTitle')}</div>
              <div class='mt-1 text-sm'>{preflightFailureMessage(i18n, state.error)}</div>
            </div>
          </div>
        )}
      </div>

      {readyState && readyPreflight && selectedTarget && revisionIsCurrent && (
        <div class='mt-5 space-y-5'>
          <PreflightSummary
            i18n={i18n}
            preflight={readyPreflight}
            targetLabel={targetLabel(i18n, selectedTarget.id)}
          />

          {exportsStandardQuiz && (
            <Alert id='assessment-export-changes' tone='neutral'>
              <div>
                <h3 class='font-semibold'>{i18n.t('delivery.preflight.staticQuizTitle')}</h3>
                <p class='mt-1 max-w-3xl text-sm leading-6'>
                  {i18n.t('delivery.diagnostic.adaptiveSequenceOmitted')}
                </p>
                <div class='mt-2 text-sm leading-6'>
                  <ExportChanges i18n={i18n} items={readyPreflight.items} />
                  <p>{i18n.t('delivery.preflight.exportChangesDetail')}</p>
                </div>
              </div>
            </Alert>
          )}

          {readyPreflight.repairs.length > 0 && (
            <div>
              <h3 class='text-sm font-semibold text-base-content'>
                {i18n.t('delivery.preflight.decisions')}
              </h3>
              <div class='mt-2 divide-y divide-base-300 border-y border-base-300'>
                {readyPreflight.repairs.map((repair) => (
                  <div
                    key={repair.id}
                    class='flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between'
                  >
                    <div class='max-w-2xl'>
                      <div class='text-sm font-medium'>{repairLabel(i18n, repair)}</div>
                      <p class='mt-1 text-sm leading-6 text-base-content/70'>
                        {repairConsequence(i18n, repair)}
                      </p>
                      <p class='mt-1 text-xs text-base-content/60'>
                        {i18n.t('delivery.preflight.affectedQuestions', {
                          count: repair.affectedItemIds.length,
                        })}
                      </p>
                    </div>
                    <Button
                      size='sm'
                      type='button'
                      onClick={() => dispatch({ _tag: 'RepairAccepted', repair })}
                    >
                      {repairLabel(i18n, repair)}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {readyPreflight.packageDiagnosticCodes.length > 0 && (
            <div class='space-y-3'>
              {packageConsequences.length > 0 && (
                <ul class='space-y-2 text-sm text-base-content' role='list'>
                  {packageConsequences.map((explanation) => (
                    <li key={explanation}>{explanation}</li>
                  ))}
                </ul>
              )}
              <Disclosure summary={i18n.t('delivery.preflight.packageEvidence')}>
                <DiagnosticList i18n={i18n} codes={readyPreflight.packageDiagnosticCodes} />
              </Disclosure>
            </div>
          )}

          {readyPreflight.overallOutcome === 'warning' && !exportsStandardQuiz && (
            <Alert id='assessment-export-changes' tone='neutral'>
              <div class='max-w-3xl text-sm leading-6'>
                <ExportChanges i18n={i18n} items={readyPreflight.items} />
                <p>{i18n.t('delivery.preflight.exportChangesDetail')}</p>
              </div>
            </Alert>
          )}

          {readyState.download._tag === 'Failed' && (
            <div class='ds-alert ds-alert-error' role='alert'>
              <span>{packageFailureMessage(i18n, readyState.download.failure)}</span>
            </div>
          )}

          <div class='flex flex-wrap items-center gap-3'>
            <Button
              type='button'
              variant='primary'
              disabled={readyPreflight._tag !== 'Evaluated' ||
                readyPreflight.overallOutcome === 'blocked' ||
                readyState.download._tag === 'Downloading'}
              aria-describedby={readyPreflight.overallOutcome === 'warning'
                ? 'assessment-export-changes'
                : undefined}
              onClick={downloadPackage}
            >
              {readyState.download._tag === 'Downloading'
                ? i18n.t('delivery.package.preparing')
                : exportsStandardQuiz
                ? i18n.t('delivery.package.downloadStandardQuiz')
                : i18n.t(
                  readyPreflight.overallOutcome === 'warning'
                    ? 'delivery.package.downloadWithChanges'
                    : 'delivery.package.downloadTarget',
                  {
                    target: targetLabel(i18n, selectedTarget.id),
                  },
                )}
            </Button>
            {readyState.download._tag === 'Downloaded' && readyState.download.receiptUrl && (
              <Button href={readyState.download.receiptUrl} download>
                {i18n.t('delivery.package.downloadReceipt')}
              </Button>
            )}
            <span class='text-xs text-base-content/60'>
              {readyPreflight.targetContractId}
              {readyPreflight.artifact && (
                ` · ${
                  i18n.t('delivery.package.artifactDetails', {
                    bytes: formatBytes(i18n, readyPreflight.artifact.byteLength),
                  })
                }`
              )}
            </span>
          </div>
          <p class='text-xs leading-5 text-base-content/60'>
            {i18n.t('delivery.preflight.savedRevisionNote')}
          </p>

          <div>
            <h3 class='text-sm font-semibold text-base-content'>
              {i18n.t('delivery.preflight.questionOutcomes')}
            </h3>
            <ol class='mt-2 divide-y divide-base-300 border-y border-base-300' role='list'>
              {readyPreflight.items.map((item, index) => (
                <PreflightItem i18n={i18n} key={item.itemId} item={item} position={index + 1} />
              ))}
            </ol>
          </div>

          {selectedTarget.directPublish !== null && readyPreflight._tag === 'Evaluated' &&
            readyPreflight.overallOutcome !== 'blocked' && (
            <DirectPublishPanel
              assessmentId={assessmentId}
              target={selectedTarget}
              selection={readyState.selection}
              preflight={readyPreflight}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ExportChanges({ i18n, items }: {
  readonly i18n: I18n;
  readonly items: readonly AssessmentExportPreflightItemView[];
}) {
  const manual = items.filter((item) =>
    item._tag !== 'Blocked' &&
    item.mappings.some((mapping) =>
      mapping.sourceScoring === 'automatic' && mapping.scoring === 'manual'
    )
  ).length;
  const changed = items.filter((item) =>
    item._tag !== 'Blocked' &&
    item.mappings.some((mapping) =>
      // Exact mappings can use different QTI wire names for the same learner interaction.
      (mapping.fidelity !== 'exact' &&
        mapping.sourceInteraction !== mapping.emittedInteraction) || mapping.fallback !== null
    )
  ).length;
  if (manual === 0 && changed === 0) return null;
  return (
    <ul class='list-disc pl-5'>
      {manual > 0 && <li>{i18n.t('delivery.preflight.manualGradingSummary', { count: manual })}
      </li>}
      {changed > 0 && (
        <li>{i18n.t('delivery.preflight.interactionChangesSummary', { count: changed })}</li>
      )}
    </ul>
  );
}

function PreflightSummary(
  { i18n, preflight, targetLabel }: {
    readonly i18n: I18n;
    readonly preflight: AssessmentExportPreflightView;
    readonly targetLabel: string;
  },
) {
  const counts = {
    preserved: preflight.items.filter((item) => item._tag === 'Preserved').length,
    transformed: preflight.items.filter((item) => item._tag === 'Transformed').length,
    warning: preflight.items.filter((item) => item._tag === 'Warning').length,
    blocked: preflight.items.filter((item) => item._tag === 'Blocked').length,
  };
  return (
    <div class='flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm'>
      <strong>{targetLabel}</strong>
      <span>{i18n.t('delivery.summary.preserved', { count: counts.preserved })}</span>
      <span>{i18n.t('delivery.summary.transformed', { count: counts.transformed })}</span>
      <span>{i18n.t('delivery.summary.warning', { count: counts.warning })}</span>
      <span>{i18n.t('delivery.summary.blocked', { count: counts.blocked })}</span>
    </div>
  );
}

function PreflightItem(
  { i18n, item, position }: {
    readonly i18n: I18n;
    readonly item: AssessmentExportPreflightItemView;
    readonly position: number;
  },
) {
  return (
    <li class='py-4'>
      <div class='flex flex-wrap items-start justify-between gap-3'>
        <div class='min-w-0'>
          <div class='text-sm font-medium text-base-content'>
            {i18n.formatNumber(position)}. {item.title}
          </div>
          <div class='mt-1 font-mono text-xs text-base-content/55'>{item.itemIdentifier}</div>
        </div>
        <OutcomeBadge i18n={i18n} outcome={itemTagToOutcome(item._tag)} />
      </div>
      {item.mappings.length > 0 && (
        <details class='mt-3'>
          <summary class='cursor-pointer text-sm font-medium text-base-content/75'>
            {i18n.t('delivery.mapping.review')}
          </summary>
          <ul class='mt-3 space-y-3' role='list'>
            {item.mappings.map((mapping) => (
              <MappingEvidence
                i18n={i18n}
                key={`${item.itemId}-${mapping.index}`}
                mapping={mapping}
              />
            ))}
          </ul>
        </details>
      )}
      {item.diagnosticCodes.length > 0 && (
        <div class='mt-3'>
          <DiagnosticList i18n={i18n} codes={item.diagnosticCodes} />
        </div>
      )}
    </li>
  );
}

function DiagnosticList(
  { i18n, codes }: { readonly i18n: I18n; readonly codes: readonly string[] },
) {
  return (
    <ul
      class='space-y-2 text-sm text-base-content/70'
      role='list'
      aria-label={i18n.t('delivery.diagnostic.listLabel')}
    >
      {codes.map((code) => {
        // Adaptive consequences are already visible above the download action.
        const explanation = code === 'qflow.export.adaptive_sequence_omitted'
          ? null
          : diagnosticExplanation(i18n, code);
        return (
          <li key={code}>
            {explanation && <span class='block'>{explanation}</span>}
            <code class='block break-words text-xs text-base-content/55'>{code}</code>
          </li>
        );
      })}
    </ul>
  );
}

function MappingEvidence(
  { i18n, mapping }: {
    readonly i18n: I18n;
    readonly mapping: AssessmentExportPreflightMappingView;
  },
) {
  return (
    <li class='text-sm leading-6 text-base-content/75'>
      <span class='font-medium text-base-content'>{mapping.sourceInteraction}</span>
      {' → '}
      <span>{mapping.emittedInteraction}</span>
      <span>
        {' · '}
        {i18n.t(`delivery.fidelity.${mapping.fidelity}`)} ·{' '}
        {i18n.t(`delivery.scoring.${mapping.scoring}`)}
      </span>
      {mapping.fallback && (
        <span>{i18n.t('delivery.mapping.fallback', { fallback: mapping.fallback })}</span>
      )}
      {mapping.sourceScoring === 'automatic' && mapping.scoring !== 'automatic' && (
        <span class='block font-medium text-error'>
          {i18n.t('delivery.mapping.automaticLoss', {
            scoring: i18n.t(`delivery.scoring.${mapping.scoring}`),
          })}
        </span>
      )}
    </li>
  );
}

function OutcomeBadge(
  { i18n, outcome, standardQuiz = false }: {
    readonly i18n: I18n;
    readonly outcome: AssessmentExportPreflightView['overallOutcome'];
    readonly standardQuiz?: boolean;
  },
) {
  const presentation = {
    preserved: { id: 'preserved', symbol: '✓', class: 'ds-badge-success' },
    transformed: { id: 'transformed', symbol: '↗', class: 'ds-badge-info' },
    warning: standardQuiz
      ? { id: 'standardQuiz', symbol: 'ⓘ', class: 'ds-badge-ghost' }
      : { id: 'warning', symbol: '!', class: 'ds-badge-warning' },
    blocked: { id: 'blocked', symbol: '×', class: 'ds-badge-error' },
  }[outcome];
  return (
    <span class={`ds-badge ${presentation.class} gap-1 font-medium`}>
      <span aria-hidden='true'>{presentation.symbol}</span>
      {i18n.t(`delivery.outcome.${presentation.id}`)}
    </span>
  );
}

function PreflightLoading({ i18n }: { readonly i18n: I18n }) {
  return (
    <div class='space-y-3' aria-label={i18n.t('delivery.preflight.loading')}>
      <div class='ds-skeleton h-5 w-56' />
      <div class='ds-skeleton h-16 w-full max-w-3xl' />
    </div>
  );
}

function itemTagToOutcome(
  tag: AssessmentExportPreflightItemView['_tag'],
): AssessmentExportPreflightView['overallOutcome'] {
  switch (tag) {
    case 'Preserved':
      return 'preserved';
    case 'Transformed':
      return 'transformed';
    case 'Warning':
      return 'warning';
    case 'Blocked':
      return 'blocked';
  }
}

function repairLabel(i18n: I18n, repair: AssessmentExportRepairView): string {
  switch (repair._tag) {
    case 'AcceptManualScoring':
      return i18n.t('delivery.repair.acceptManualScoring');
    case 'AcceptDiagnosedFallbacks':
      return i18n.t('delivery.repair.acceptDiagnosedFallbacks');
  }
}

function repairConsequence(i18n: I18n, repair: AssessmentExportRepairView): string {
  switch (repair._tag) {
    case 'AcceptManualScoring':
      return i18n.t('delivery.repair.manualConsequence');
    case 'AcceptDiagnosedFallbacks':
      return i18n.t('delivery.repair.fallbackConsequence');
  }
}

function targetLabel(i18n: I18n, targetId: SelectableAssessmentExportTargetId): string {
  switch (targetId) {
    case 'canvas-classic':
      return i18n.t('delivery.target.canvas-classic');
    case 'canvas-new-quizzes':
      return i18n.t('delivery.target.canvas-new-quizzes');
    case 'blackboard-question-banks':
      return i18n.t('delivery.target.blackboard-question-banks');
    case 'brightspace-course-import':
      return i18n.t('delivery.target.brightspace-course-import');
    case 'moodle':
      return i18n.t('delivery.target.moodle');
    case 'qti3-conformant':
      return i18n.t('delivery.target.qti3-conformant');
    case 'qti22-standard':
      return i18n.t('delivery.target.qti22-standard');
    case 'qti21-standard':
      return i18n.t('delivery.target.qti21-standard');
    case 'qti12-standard':
      return i18n.t('delivery.target.qti12-standard');
  }
}

function diagnosticExplanation(i18n: I18n, code: string): string | null {
  switch (code) {
    case 'qflow.requirement.automatic_scoring_lost':
      return i18n.t('delivery.diagnostic.automaticScoringLost');
    case 'qflow.requirement.interaction_not_preserved':
      return i18n.t('delivery.diagnostic.interactionChanged');
    case 'qflow.preflight.item_report_missing':
      return i18n.t('delivery.diagnostic.itemReportMissing');
    case 'qflow.preflight.source_interaction_missing':
      return i18n.t('delivery.diagnostic.sourceInteractionMissing');
    case 'qflow.preflight.canonical_validation_failed':
      return i18n.t('delivery.diagnostic.validationFailed');
    case 'qflow.preflight.asset_resolution_failed':
      return i18n.t('delivery.diagnostic.assetResolutionFailed');
    case 'qflow.export.adaptive_sequence_omitted':
      return i18n.t('delivery.diagnostic.adaptiveSequenceOmitted');
    case 'qflow.export.stale_organization_omitted':
      return i18n.t('delivery.diagnostic.staleOrganizationOmitted');
    case 'qflow.export.standalone_text_omitted':
      return i18n.t('delivery.diagnostic.standaloneTextOmitted');
    case 'qflow.export.standalone_image_omitted':
      return i18n.t('delivery.diagnostic.standaloneImageOmitted');
    case 'qflow.export.standalone_video_omitted':
      return i18n.t('delivery.diagnostic.standaloneVideoOmitted');
    case 'qflow.export.standalone_video_link_omitted':
      return i18n.t('delivery.diagnostic.standaloneVideoLinkOmitted');
    case 'qflow.export.part_instructions_omitted':
      return i18n.t('delivery.diagnostic.partInstructionsOmitted');
    case 'qflow.export.answer_feedback_omitted':
      return i18n.t('delivery.diagnostic.answerFeedbackOmitted');
    case 'qflow.export.part_answer_feedback_release_omitted':
      return i18n.t('delivery.diagnostic.answerFeedbackReleaseOmitted');
    case 'qflow.export.part_feedback_omitted':
      return i18n.t('delivery.diagnostic.partFeedbackOmitted');
    case 'qflow.export.part_navigation_omitted':
      return i18n.t('delivery.diagnostic.partNavigationOmitted');
    case 'qflow.export.part_submission_omitted':
      return i18n.t('delivery.diagnostic.partSubmissionOmitted');
    case 'qflow.export.part_time_limits_omitted':
      return i18n.t('delivery.diagnostic.partTimeLimitsOmitted');
    case 'qflow.export.part_structure_omitted':
      return i18n.t('delivery.diagnostic.partStructureOmitted');
    case 'qflow.preflight.target_conversion_failed':
      return i18n.t('delivery.diagnostic.targetConversionFailed');
    case 'profile_release_evidence.not_recorded':
      return i18n.t('delivery.diagnostic.profileEvidenceMissing');
    case 'product_import_evidence.not_recorded':
      return i18n.t('delivery.diagnostic.productEvidenceMissing');
    case 'qti3_conformance.not_run':
      return i18n.t('delivery.diagnostic.conformanceNotRun');
    default:
      return null;
  }
}

function formatBytes(i18n: I18n, value: number): string {
  if (value < 1024) return i18n.t('delivery.package.sizeBytes', { value: Math.round(value) });
  if (value < 1024 * 1024) {
    return i18n.t('delivery.package.sizeKiB', {
      value: Math.round((value / 1024) * 10) / 10,
    });
  }
  return i18n.t('delivery.package.sizeMiB', {
    value: Math.round((value / (1024 * 1024)) * 10) / 10,
  });
}

function preflightFailureMessage(i18n: I18n, failure: AssessmentExportPreflightFailure): string {
  switch (failure.code) {
    case 'PreflightRequestFailed':
      return i18n.t('delivery.preflight.requestFailed');
    case 'InvalidPreflightResponse':
      return i18n.t('delivery.preflight.invalidResponse');
    case 'PreflightFailed':
      switch (failure.diagnosticCode) {
        case 'PreflightStale':
          return i18n.t('delivery.preflight.diagnosticStale');
        case 'not_found':
          return i18n.t('delivery.preflight.diagnosticNotFound');
        default:
          return failure.diagnosticCode
            ? i18n.t('delivery.preflight.rejectedWithCode', { code: failure.diagnosticCode })
            : i18n.t('delivery.preflight.rejected');
      }
  }
}

function packageFailureMessage(
  i18n: I18n,
  failure: AssessmentExportPackageFailure,
): string {
  switch (failure.code) {
    case 'PackageRequestFailed':
      return i18n.t('delivery.package.requestFailed');
    case 'PackageRejected':
      switch (failure.diagnosticCode) {
        case 'PreflightStale':
          return i18n.t('delivery.package.stale');
        case 'PreflightBlocked':
          return i18n.t('delivery.package.blocked');
        case 'WarningsNotAcknowledged':
          return i18n.t('delivery.package.warningsNotAcknowledged');
        case 'not_found':
          return i18n.t('delivery.package.notFound');
        default:
          return failure.diagnosticCode
            ? i18n.t('delivery.package.rejectedWithCode', { code: failure.diagnosticCode })
            : i18n.t('delivery.package.rejected');
      }
  }
}
