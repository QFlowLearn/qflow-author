import { sha256Hex } from '../sha256.ts';
import type { AssessmentExportFidelityReceipt } from './assessment_export_receipt.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflight,
  AssessmentExportPreflightId,
} from './assessment_export_preflight.ts';
import type { ExportActorId } from './assessment_export_requirements.ts';

const authorizedAssessmentExportBrand: unique symbol = Symbol('AuthorizedAssessmentExport');

type AssessmentExportArtifact = {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mediaType: string;
};

type AssessmentExportAuthorizationCandidate = {
  readonly artifact: AssessmentExportArtifact;
  readonly fidelityReceipt: AssessmentExportFidelityReceipt;
  readonly preflight: AssessmentExportPreflight;
};

/** Export evidence that passed one shared freshness, warning, policy, and linkage decision. */
export type AuthorizedAssessmentExport = {
  readonly [authorizedAssessmentExportBrand]: 'AuthorizedAssessmentExport';
  readonly artifact: AssessmentExportArtifact;
  readonly fidelityReceipt: AssessmentExportFidelityReceipt;
  readonly preflight:
    & Extract<AssessmentExportPreflight, { readonly _tag: 'Evaluated' }>
    & { readonly overallOutcome: 'preserved' | 'transformed' | 'warning' };
  readonly authorizedBy: ExportActorId;
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
};

/** Exhaustive decision returned by the only package/publish authorization gate. */
export type AssessmentExportAuthorizationDecision =
  | { readonly _tag: 'Authorized'; readonly value: AuthorizedAssessmentExport }
  | { readonly _tag: 'PreflightStale'; readonly preflight: AssessmentExportPreflight }
  | { readonly _tag: 'PreflightBlocked'; readonly preflight: AssessmentExportPreflight }
  | { readonly _tag: 'WarningsNotAcknowledged'; readonly preflight: AssessmentExportPreflight }
  | {
    readonly _tag: 'EvidenceMismatch';
    readonly message: 'QFlowLearn export evidence is internally inconsistent.';
  };

/**
 * Authorizes one exact artifact for download or delivery publication.
 *
 * Routes may project this decision into different protocols, but may not recreate its policy.
 */
export async function authorizeAssessmentExport(input: {
  readonly candidate: AssessmentExportAuthorizationCandidate;
  readonly authorizedBy: ExportActorId;
  readonly approvedPreflightId: AssessmentExportPreflightId | null;
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
}): Promise<AssessmentExportAuthorizationDecision> {
  const { preflight } = input.candidate;
  if (preflight._tag === 'BuildBlocked') {
    return { _tag: 'PreflightBlocked', preflight };
  }
  if (preflight.overallOutcome === 'blocked') {
    return { _tag: 'PreflightBlocked', preflight };
  }
  if (
    input.approvedPreflightId !== null &&
    input.approvedPreflightId !== preflight.preflightId
  ) {
    return { _tag: 'PreflightStale', preflight };
  }
  if (
    preflight.overallOutcome === 'warning' &&
    input.acknowledgementToken !== preflight.acknowledgementToken
  ) {
    return { _tag: 'WarningsNotAcknowledged', preflight };
  }
  if (!requirementsBelongToActor(preflight, input.authorizedBy)) {
    return evidenceMismatch();
  }
  if (!(await evidenceIsLinked(input.candidate))) {
    return evidenceMismatch();
  }
  const authorizedPreflight: AuthorizedAssessmentExport['preflight'] = {
    ...preflight,
    overallOutcome: preflight.overallOutcome,
  };
  return {
    _tag: 'Authorized',
    value: {
      // SAFETY: Only this gate can establish the private authorization brand.
      [authorizedAssessmentExportBrand]: 'AuthorizedAssessmentExport',
      artifact: input.candidate.artifact,
      fidelityReceipt: input.candidate.fidelityReceipt,
      preflight: authorizedPreflight,
      authorizedBy: input.authorizedBy,
      acknowledgementToken: input.acknowledgementToken,
    },
  };
}

async function evidenceIsLinked(
  candidate: AssessmentExportAuthorizationCandidate,
): Promise<boolean> {
  const { artifact, fidelityReceipt, preflight } = candidate;
  const artifactSha256 = await sha256Hex(artifact.bytes);
  return (
    preflight.fidelityReceiptId === fidelityReceipt.receiptId &&
    preflight.assessmentId === fidelityReceipt.assessment.id &&
    preflight.canonicalPackageSha256 ===
      fidelityReceipt.assessment.canonicalPackageSha256 &&
    preflight.destinationId === fidelityReceipt.target.destinationId &&
    preflight.targetContractId === fidelityReceipt.target.targetContractId &&
    JSON.stringify(preflight.qti3Packages) ===
      JSON.stringify(fidelityReceipt.target.qti3Packages) &&
    preflight.artifact.filename === fidelityReceipt.artifact.filename &&
    preflight.artifact.mediaType === fidelityReceipt.artifact.mediaType &&
    preflight.artifact.byteLength === fidelityReceipt.artifact.byteLength &&
    preflight.artifact.sha256 === fidelityReceipt.artifact.sha256 &&
    artifact.filename === fidelityReceipt.artifact.filename &&
    artifact.mediaType === fidelityReceipt.artifact.mediaType &&
    artifact.bytes.byteLength === fidelityReceipt.artifact.byteLength &&
    artifactSha256 === fidelityReceipt.artifact.sha256 &&
    !preflight.items.some((item) => item._tag === 'Blocked')
  );
}

function requirementsBelongToActor(
  preflight: AssessmentExportPreflight,
  actor: ExportActorId,
): boolean {
  const scoring = preflight.requirements.scoring;
  const interaction = preflight.requirements.interaction;
  return (
    (scoring._tag === 'AutomaticScoringRequired' || scoring.approvedBy === actor) &&
    (interaction._tag === 'BehaviorMustBePreserved' || interaction.approvedBy === actor)
  );
}

function evidenceMismatch(): AssessmentExportAuthorizationDecision {
  return {
    _tag: 'EvidenceMismatch',
    message: 'QFlowLearn export evidence is internally inconsistent.',
  };
}
