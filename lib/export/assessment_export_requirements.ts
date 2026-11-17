declare const exportActorIdBrand: unique symbol;

/** Authenticated actor identity recorded when an author permits an export consequence. */
export type ExportActorId = string & {
  readonly [exportActorIdBrand]: 'ExportActorId';
};

/** Scoring semantics that the selected export must preserve or explicitly disclose. */
export type AssessmentExportScoringRequirement =
  | { readonly _tag: 'AutomaticScoringRequired' }
  | {
    readonly _tag: 'ManualScoringAccepted';
    readonly approvedBy: ExportActorId;
  };

/** Interaction semantics that the selected export must preserve or explicitly disclose. */
export type AssessmentExportInteractionRequirement =
  | { readonly _tag: 'BehaviorMustBePreserved' }
  | {
    readonly _tag: 'DiagnosedFallbackAccepted';
    readonly approvedBy: ExportActorId;
  };

/** Author-owned semantic requirements applied to one destination preflight. */
export type AssessmentExportRequirements = {
  readonly scoring: AssessmentExportScoringRequirement;
  readonly interaction: AssessmentExportInteractionRequirement;
  readonly assets: 'AllRequired';
};

/** Establishes an export actor from the authenticated request context. */
export function exportActorIdFromAuthenticatedUser(userId: string): ExportActorId {
  if (userId.trim().length === 0) {
    throw new Error('Authenticated export actor ID is required.');
  }
  // SAFETY: Authentication established a non-empty user identity before export evaluation.
  return userId as ExportActorId;
}

/** Creates the strict requirements used before an author accepts any target consequence. */
export function strictAssessmentExportRequirements(): AssessmentExportRequirements {
  return {
    scoring: { _tag: 'AutomaticScoringRequired' },
    interaction: { _tag: 'BehaviorMustBePreserved' },
    assets: 'AllRequired',
  };
}

/** Records the authenticated author's explicit acceptance of manual target scoring. */
export function acceptManualAssessmentExportScoring(
  requirements: AssessmentExportRequirements,
  approvedBy: ExportActorId,
): AssessmentExportRequirements {
  return {
    scoring: { _tag: 'ManualScoringAccepted', approvedBy },
    interaction: requirements.interaction,
    assets: requirements.assets,
  };
}

/** Records the authenticated author's explicit acceptance of diagnosed interaction fallbacks. */
export function acceptDiagnosedAssessmentExportFallbacks(
  requirements: AssessmentExportRequirements,
  approvedBy: ExportActorId,
): AssessmentExportRequirements {
  return {
    scoring: requirements.scoring,
    interaction: { _tag: 'DiagnosedFallbackAccepted', approvedBy },
    assets: requirements.assets,
  };
}
