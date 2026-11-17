import type { AssessmentExportRequirementSelection } from '../export/assessment_export_http.ts';
import type {
  AssessmentExportPreflightFailure,
  AssessmentExportPreflightView,
  AssessmentExportRepairView,
} from '../export/assessment_export_preflight_client.ts';
import type {
  AssessmentExportPackageErrorCode,
  AssessmentExportPackageFailure,
} from './assessment_export_package.ts';
import type { SelectableAssessmentExportTargetId } from '../export/assessment_export_targets.ts';

export type AssessmentExportSelection = {
  readonly revisionFingerprint: string;
  readonly targetId: SelectableAssessmentExportTargetId;
  readonly requirements: AssessmentExportRequirementSelection;
};

type AssessmentExportDownloadState =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Downloading' }
  | { readonly _tag: 'Downloaded'; readonly receiptUrl: string | null }
  | {
    readonly _tag: 'Failed';
    readonly failure: AssessmentExportPackageFailure;
  };

/** One coherent state for selection, preflight, acknowledgement, and package download. */
export type AssessmentExportWorkflowState =
  | { readonly _tag: 'Idle'; readonly revisionFingerprint: string }
  | { readonly _tag: 'Loading'; readonly selection: AssessmentExportSelection }
  | {
    readonly _tag: 'Failed';
    readonly selection: AssessmentExportSelection;
    readonly error: AssessmentExportPreflightFailure;
  }
  | {
    readonly _tag: 'Ready';
    readonly selection: AssessmentExportSelection;
    readonly preflight: AssessmentExportPreflightView;
    readonly warningsAcknowledged: boolean;
    readonly download: AssessmentExportDownloadState;
  };

export type AssessmentExportWorkflowEvent =
  | {
    readonly _tag: 'TargetSelected';
    readonly targetId: SelectableAssessmentExportTargetId | null;
  }
  | { readonly _tag: 'RevisionChanged'; readonly revisionFingerprint: string }
  | { readonly _tag: 'RepairAccepted'; readonly repair: AssessmentExportRepairView }
  | {
    readonly _tag: 'PreflightLoaded';
    readonly selection: AssessmentExportSelection;
    readonly preflight: AssessmentExportPreflightView;
  }
  | {
    readonly _tag: 'PreflightFailed';
    readonly selection: AssessmentExportSelection;
    readonly error: AssessmentExportPreflightFailure;
  }
  | { readonly _tag: 'WarningsAcknowledged'; readonly accepted: boolean }
  | { readonly _tag: 'DownloadStarted' }
  | {
    readonly _tag: 'DownloadCompleted';
    readonly receiptUrl: string | null;
  }
  | {
    readonly _tag: 'DownloadFailed';
    readonly failure: {
      readonly code: AssessmentExportPackageErrorCode;
      readonly diagnosticCode?: string;
    };
  };

// Destination selection proposes the useful derivative. The download action accepts its
// exact, disclosed consequences through the revision-bound acknowledgement token.
const EXPORT_REQUIREMENTS: AssessmentExportRequirementSelection = {
  scoring: 'manual-accepted',
  interaction: 'fallback-accepted',
};

/** Creates the initial destination-export workflow for one saved assessment revision. */
export function createAssessmentExportWorkflow(
  revisionFingerprint: string,
): AssessmentExportWorkflowState {
  return { _tag: 'Idle', revisionFingerprint };
}

/** Pure transition function that rejects stale async results by exact selection identity. */
export function reduceAssessmentExportWorkflow(
  state: AssessmentExportWorkflowState,
  event: AssessmentExportWorkflowEvent,
): AssessmentExportWorkflowState {
  switch (event._tag) {
    case 'TargetSelected': {
      const revisionFingerprint = workflowRevision(state);
      return event.targetId === null ? { _tag: 'Idle', revisionFingerprint } : {
        _tag: 'Loading',
        selection: {
          revisionFingerprint,
          targetId: event.targetId,
          requirements: EXPORT_REQUIREMENTS,
        },
      };
    }
    case 'RevisionChanged': {
      const selection = workflowSelection(state);
      return selection === null
        ? { _tag: 'Idle', revisionFingerprint: event.revisionFingerprint }
        : {
          _tag: 'Loading',
          selection: { ...selection, revisionFingerprint: event.revisionFingerprint },
        };
    }
    case 'RepairAccepted': {
      if (state._tag !== 'Ready') return state;
      const requirements = event.repair._tag === 'AcceptManualScoring'
        ? { ...state.selection.requirements, scoring: 'manual-accepted' as const }
        : { ...state.selection.requirements, interaction: 'fallback-accepted' as const };
      return {
        _tag: 'Loading',
        selection: { ...state.selection, requirements },
      };
    }
    case 'PreflightLoaded':
      return state._tag === 'Loading' && sameSelection(state.selection, event.selection)
        ? {
          _tag: 'Ready',
          selection: state.selection,
          preflight: event.preflight,
          warningsAcknowledged: false,
          download: { _tag: 'Idle' },
        }
        : state;
    case 'PreflightFailed':
      return state._tag === 'Loading' && sameSelection(state.selection, event.selection)
        ? {
          _tag: 'Failed',
          selection: state.selection,
          error: event.error,
        }
        : state;
    case 'WarningsAcknowledged':
      return state._tag === 'Ready'
        ? { ...state, warningsAcknowledged: event.accepted, download: { _tag: 'Idle' } }
        : state;
    case 'DownloadStarted':
      return state._tag === 'Ready' ? { ...state, download: { _tag: 'Downloading' } } : state;
    case 'DownloadCompleted':
      return state._tag === 'Ready'
        ? { ...state, download: { _tag: 'Downloaded', receiptUrl: event.receiptUrl } }
        : state;
    case 'DownloadFailed':
      return state._tag === 'Ready'
        ? { ...state, download: { _tag: 'Failed', failure: event.failure } }
        : state;
  }
}

export function assessmentExportSelectionKey(selection: AssessmentExportSelection): string {
  return [
    selection.revisionFingerprint,
    selection.targetId,
    selection.requirements.scoring,
    selection.requirements.interaction,
  ].join('\n');
}

function workflowRevision(state: AssessmentExportWorkflowState): string {
  return state._tag === 'Idle' ? state.revisionFingerprint : state.selection.revisionFingerprint;
}

function workflowSelection(
  state: AssessmentExportWorkflowState,
): AssessmentExportSelection | null {
  return state._tag === 'Idle' ? null : state.selection;
}

function sameSelection(
  left: AssessmentExportSelection,
  right: AssessmentExportSelection,
): boolean {
  return assessmentExportSelectionKey(left) === assessmentExportSelectionKey(right);
}
