import { safeErrorSummary } from '../error_summary.ts';
import type { AssessmentExportFinalReceiptId } from './assessment_export_final_receipt.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflightId,
} from './assessment_export_preflight.ts';
import {
  acceptDiagnosedAssessmentExportFallbacks,
  acceptManualAssessmentExportScoring,
  type AssessmentExportRequirements,
  type ExportActorId,
  strictAssessmentExportRequirements,
} from './assessment_export_requirements.ts';

/** Author choices serialized by the preflight and package HTTP boundary. */
export type AssessmentExportRequirementSelection = {
  readonly scoring: 'automatic' | 'manual-accepted';
  readonly interaction: 'preserve' | 'fallback-accepted';
};

/** Result of parsing strict export requirement query parameters. */
export type AssessmentExportRequirementSelectionParseResult =
  | {
    readonly ok: true;
    readonly selection: AssessmentExportRequirementSelection;
  }
  | {
    readonly ok: false;
    readonly body: {
      readonly error: 'ExportRequirementsInvalid';
      readonly message: 'Export scoring and interaction requirements are required.';
    };
  };

/** Parsed result for the receipt identity required by the receipt HTTP endpoint. */
export type AssessmentExportFinalReceiptIdParseResult =
  | {
    readonly ok: true;
    readonly receiptId: AssessmentExportFinalReceiptId;
  }
  | {
    readonly ok: false;
    readonly body:
      | {
        readonly error: 'ReceiptIdRequired';
        readonly message: 'An export receipt ID is required.';
      }
      | {
        readonly error: 'InvalidReceiptId';
        readonly message: 'The export receipt ID is invalid.';
      };
  };

const CONTENT_ID_PATTERN = /^[a-f0-9]{64}$/;

/** Parses the two explicit requirement choices required by preflight and package routes. */
export function parseAssessmentExportRequirementSelection(
  searchParams: URLSearchParams,
): AssessmentExportRequirementSelectionParseResult {
  const scoring = searchParams.get('scoring');
  const interaction = searchParams.get('interaction');
  if (
    (scoring !== 'automatic' && scoring !== 'manual-accepted') ||
    (interaction !== 'preserve' && interaction !== 'fallback-accepted')
  ) {
    return {
      ok: false,
      body: {
        error: 'ExportRequirementsInvalid',
        message: 'Export scoring and interaction requirements are required.',
      },
    };
  }
  return { ok: true, selection: { scoring, interaction } };
}

/** Resolves parsed author choices into requirements attributed to the authenticated actor. */
export function assessmentExportRequirementsFromSelection(
  selection: AssessmentExportRequirementSelection,
  actorId: ExportActorId,
): AssessmentExportRequirements {
  let requirements = strictAssessmentExportRequirements();
  if (selection.scoring === 'manual-accepted') {
    requirements = acceptManualAssessmentExportScoring(requirements, actorId);
  }
  if (selection.interaction === 'fallback-accepted') {
    requirements = acceptDiagnosedAssessmentExportFallbacks(requirements, actorId);
  }
  return requirements;
}

/** Serializes explicit requirement choices into an export API URL. */
export function setAssessmentExportRequirementQuery(
  url: URL,
  selection: AssessmentExportRequirementSelection,
): void {
  url.searchParams.set('scoring', selection.scoring);
  url.searchParams.set('interaction', selection.interaction);
}

/** Parses a required content-addressed preflight identity. */
export function parseAssessmentExportPreflightId(
  value: string | null,
):
  | { readonly ok: true; readonly preflightId: AssessmentExportPreflightId }
  | {
    readonly ok: false;
    readonly body:
      | {
        readonly error: 'PreflightRequired';
        readonly message: 'Run destination preflight before downloading.';
      }
      | {
        readonly error: 'InvalidPreflightId';
        readonly message: 'The export preflight ID is invalid.';
      };
  } {
  if (value === null) {
    return {
      ok: false,
      body: {
        error: 'PreflightRequired',
        message: 'Run destination preflight before downloading.',
      },
    };
  }
  if (!CONTENT_ID_PATTERN.test(value)) {
    return {
      ok: false,
      body: {
        error: 'InvalidPreflightId',
        message: 'The export preflight ID is invalid.',
      },
    };
  }
  // SAFETY: CONTENT_ID_PATTERN established the content-addressed identifier invariant.
  return { ok: true, preflightId: value as AssessmentExportPreflightId };
}

/** Parses an optional warning acknowledgement token, rejecting malformed values. */
export function parseAssessmentExportAcknowledgementToken(
  value: string | null,
):
  | {
    readonly ok: true;
    readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
  }
  | {
    readonly ok: false;
    readonly body: {
      readonly error: 'InvalidAcknowledgementToken';
      readonly message: 'The export warning acknowledgement is invalid.';
    };
  } {
  if (value === null) return { ok: true, acknowledgementToken: null };
  if (!CONTENT_ID_PATTERN.test(value)) {
    return {
      ok: false,
      body: {
        error: 'InvalidAcknowledgementToken',
        message: 'The export warning acknowledgement is invalid.',
      },
    };
  }
  // SAFETY: CONTENT_ID_PATTERN established the content-addressed identifier invariant.
  return {
    ok: true,
    acknowledgementToken: value as AssessmentExportAcknowledgementToken,
  };
}

/** Parses an untrusted receipt query value into a content-addressed receipt identity. */
export function parseAssessmentExportFinalReceiptId(
  value: string | null,
): AssessmentExportFinalReceiptIdParseResult {
  if (value === null) {
    return {
      ok: false,
      body: {
        error: 'ReceiptIdRequired',
        message: 'An export receipt ID is required.',
      },
    };
  }
  if (!CONTENT_ID_PATTERN.test(value)) {
    return {
      ok: false,
      body: {
        error: 'InvalidReceiptId',
        message: 'The export receipt ID is invalid.',
      },
    };
  }
  // SAFETY: CONTENT_ID_PATTERN established the 64-character lowercase SHA-256 invariant.
  return { ok: true, receiptId: value as AssessmentExportFinalReceiptId };
}

/** Builds the content-addressed receipt URL for one exact package response. */
export function buildAssessmentExportReceiptUrl(
  packageUrl: URL,
  receiptId: AssessmentExportFinalReceiptId,
): URL {
  const receiptUrl = new URL(packageUrl);
  receiptUrl.pathname = receiptUrl.pathname.replace(
    /\/package$/,
    `/receipts/${receiptId}`,
  );
  receiptUrl.search = '';
  return receiptUrl;
}

/** Projects an unexpected export defect or dependency failure into a safe HTTP 500 response. */
export function unexpectedAssessmentExportResponse(
  cause: unknown,
  context: {
    readonly assessmentId: string;
    readonly operation: 'delivery-publish-preflight' | 'package' | 'receipt' | 'validate';
  },
): Response {
  console.error(JSON.stringify({
    event: 'assessment_export_failed',
    assessmentId: context.assessmentId,
    operation: context.operation,
    causeType: safeErrorSummary(cause),
  }));
  return Response.json(
    {
      error: 'InternalExportFailure',
      message: 'Assessment export failed unexpectedly.',
    },
    { status: 500 },
  );
}
