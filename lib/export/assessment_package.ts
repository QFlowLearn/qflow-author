import { requireAssessmentAnswerFeedbackRelease } from './assessment.ts';
import { AssessmentExportError } from './assessment_export_error.ts';
import type { QtiTranscodeDiagnostic } from '@longsightgroup/qti3-transcoder';

import { db } from '../db.ts';
import { collectPackageAssets } from '../package_export.ts';
import type { QtiValidationResult } from '../qti_validate.ts';
import type { AssessmentRecord } from '../services/assessment_records.ts';
import type { RequestContext } from '../tenants.ts';
import { getUpload, type StoredUpload, uploadIdFromUrl } from '../uploads.ts';
import type { FieldIssue } from '../validation_fields.ts';
import { toFieldIssues } from '../validation_fields.ts';
import {
  type AssessmentExportDocument,
  type AssessmentExportPackageInput,
  type AssessmentPackageConversionResult,
  buildValidatedQti3Assessment,
  convertQti3AssessmentPackage,
  toAssessmentExportSelectionDocument,
  validateAssessmentItemExports,
} from './assessment.ts';
import {
  type AssessmentExportFidelityReceipt,
  createAssessmentExportFidelityReceipt,
} from './assessment_export_receipt.ts';
import {
  type AssessmentCanonicalRevisionId,
  type AssessmentExportPreflight,
  createAssessmentCanonicalRevisionId,
  createAssessmentExportPreflight,
  createBuildBlockedAssessmentExportPreflight,
} from './assessment_export_preflight.ts';
import type { AssessmentExportRequirements } from './assessment_export_requirements.ts';
import {
  resolveAssessmentExportTarget,
  type SelectableAssessmentExportTarget,
} from './assessment_export_targets.ts';
import {
  type AssessmentItemExportMapResult,
  loadAssessmentItemExports,
} from './assessment_loader.ts';
import { validateQti3Accessibility } from '../qti3_accessibility.ts';

type AssessmentPackageFailureBody =
  | {
    readonly error: 'DestinationNotRegistered';
    readonly message: string;
    readonly requestedTargetId: string | null;
  }
  | {
    readonly error: 'CanonicalSourceUnavailable';
    readonly message: string;
  }
  | {
    readonly error: 'PackageAssetResolutionFailed';
    readonly message: string;
  }
  | {
    readonly error: 'CanonicalValidationFailed';
    readonly message: string;
    readonly issues: readonly FieldIssue[];
  }
  | {
    readonly error: 'TargetConversionFailed';
    readonly code: Extract<
      AssessmentPackageConversionResult,
      { readonly ok: false }
    >['code'];
    readonly message: string;
    readonly diagnostics: readonly QtiTranscodeDiagnostic[];
  };

type AssessmentPackageBuildResult =
  | {
    readonly ok: true;
    readonly artifact: {
      readonly bytes: Uint8Array;
      readonly filename: string;
      readonly mediaType: string;
    };
    readonly receipt: AssessmentExportFidelityReceipt;
    readonly preflight: AssessmentExportPreflight;
  }
  | {
    readonly ok: false;
    readonly status: 400 | 422;
    readonly body: AssessmentPackageFailureBody;
    readonly preflight: AssessmentExportPreflight | null;
  };

type PreparedAssessmentExport = {
  readonly document: AssessmentExportDocument;
  readonly itemExports: AssessmentItemExportMapResult;
  readonly assessmentXml: string;
  readonly assessmentValidation: QtiValidationResult;
};

type BuildAssessmentPackageInput = {
  readonly assessment: AssessmentRecord;
  readonly auth: RequestContext;
  readonly readUploadBytes: (upload: StoredUpload) => Promise<Uint8Array>;
  readonly targetId: string | null;
  readonly requirements: AssessmentExportRequirements;
};

/** Builds one explicit target artifact and its deterministic fidelity receipt. */
export async function buildAssessmentPackage(
  input: BuildAssessmentPackageInput,
): Promise<AssessmentPackageBuildResult> {
  const resolvedTarget = resolveAssessmentExportTarget(input.targetId);
  if (!resolvedTarget.ok) {
    return {
      ok: false,
      status: 400,
      preflight: null,
      body: {
        error: 'DestinationNotRegistered',
        message: `Assessment export target "${
          resolvedTarget.error.requestedTargetId ?? ''
        }" is not registered.`,
        requestedTargetId: resolvedTarget.error.requestedTargetId,
      },
    };
  }
  const target = resolvedTarget.target;

  let prepared: PreparedAssessmentExport;
  try {
    prepared = await prepareAssessmentExport(input.auth, input.assessment);
  } catch (cause: unknown) {
    if (cause instanceof AssessmentExportError) {
      return {
        ok: false,
        status: 422,
        preflight: null,
        body: {
          error: 'CanonicalSourceUnavailable',
          message: cause.message,
        },
      };
    }
    throw cause;
  }
  const canonicalRevisionId = await createAssessmentCanonicalRevisionId({
    assessmentId: input.assessment.id,
    assessmentXml: prepared.assessmentXml,
    itemsXml: prepared.itemExports.itemsXml,
  });
  const validation = await validateAssessmentItemExports(
    prepared.assessmentValidation,
    prepared.itemExports.itemsXml,
  );
  if (!validation.ok) {
    return {
      ok: false,
      status: 422,
      preflight: await createBlockedPreflight(
        input,
        target,
        prepared,
        canonicalRevisionId,
        ['qflow.preflight.canonical_validation_failed'],
      ),
      body: {
        error: 'CanonicalValidationFailed',
        message:
          'Assessment failed internal validation. Fix the issues before exporting a package.',
        issues: toFieldIssues(validation.errors),
      },
    };
  }

  const collected = await collectPackageAssets(
    {
      _tag: 'Assessment',
      assessmentXml: prepared.assessmentXml,
      itemsXml: prepared.itemExports.itemsXml,
    },
    {
      getUploadId: uploadIdFromUrl,
      getUpload: async (uploadId) => {
        const result = await getUpload(input.auth, uploadId);
        return result.status === 'ok' ? result.upload : null;
      },
      readUploadFile: input.readUploadBytes,
    },
  );
  if (!collected.ok) {
    return assetResolutionFailure(
      input,
      target,
      prepared,
      canonicalRevisionId,
      collected.error.message,
    );
  }
  const { assets, rewrittenXml, assetIdsByItem, assessmentXml, assessmentAssetIds } =
    collected.value;

  const converted = await convertQti3AssessmentPackage(
    buildPackageInput(
      prepared,
      rewrittenXml,
      assets,
      assetIdsByItem,
      prepared.itemExports.standardsByItem,
      assessmentXml,
      assessmentAssetIds,
    ),
    target,
  );
  if (!converted.ok) {
    return {
      ok: false,
      status: 422,
      preflight: await createBlockedPreflight(
        input,
        target,
        prepared,
        canonicalRevisionId,
        [
          'qflow.preflight.target_conversion_failed',
          converted.code,
          ...converted.diagnostics.map((diagnostic) => diagnostic.code),
        ],
      ),
      body: {
        error: 'TargetConversionFailed',
        code: converted.code,
        message: `Assessment could not be exported as ${target.label}.`,
        diagnostics: converted.diagnostics,
      },
    };
  }

  const artifact = {
    bytes: converted.artifact,
    filename: buildArtifactFilename(input.assessment.id, target),
    mediaType: target.artifact.mediaType,
  };
  const receipt = await createAssessmentExportFidelityReceipt({
    assessmentId: input.assessment.id,
    target,
    canonicalPackage: converted.canonicalPackage,
    artifact,
    transcodeEvidence: converted.transcodeEvidence,
    accessibility: validateQti3Accessibility(rewrittenXml),
    additionalPackageDiagnosticCodes: prepared.itemExports.omittedOrganizationItemIds.length
      ? ['qflow.export.stale_organization_omitted']
      : [],
  });
  const preflight = await createAssessmentExportPreflight({
    target,
    requirements: input.requirements,
    receipt,
    canonicalRevisionId,
    itemsXml: prepared.itemExports.itemsXml,
    transcodeEvidence: converted.transcodeEvidence,
    omittedOrganizationItemIds: prepared.itemExports.omittedOrganizationItemIds,
  });
  return {
    ok: true,
    artifact,
    receipt,
    preflight,
  };
}

async function assetResolutionFailure(
  input: BuildAssessmentPackageInput,
  target: SelectableAssessmentExportTarget,
  prepared: PreparedAssessmentExport,
  canonicalRevisionId: AssessmentCanonicalRevisionId,
  message: string,
): Promise<Extract<AssessmentPackageBuildResult, { readonly ok: false }>> {
  return {
    ok: false,
    status: 422,
    preflight: await createBlockedPreflight(
      input,
      target,
      prepared,
      canonicalRevisionId,
      ['qflow.preflight.asset_resolution_failed'],
    ),
    body: { error: 'PackageAssetResolutionFailed', message },
  };
}

function createBlockedPreflight(
  input: BuildAssessmentPackageInput,
  target: SelectableAssessmentExportTarget,
  prepared: PreparedAssessmentExport,
  canonicalRevisionId: AssessmentCanonicalRevisionId,
  diagnosticCodes: readonly string[],
): Promise<AssessmentExportPreflight> {
  return createBuildBlockedAssessmentExportPreflight({
    assessmentId: input.assessment.id,
    target,
    requirements: input.requirements,
    canonicalRevisionId,
    itemsXml: prepared.itemExports.itemsXml,
    diagnosticCodes,
  });
}

function buildArtifactFilename(
  assessmentId: string,
  target: SelectableAssessmentExportTarget,
): string {
  const safeAssessmentId = assessmentId.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  return `assessment-${safeAssessmentId}-${target.artifact.filenameSuffix}`;
}

async function prepareAssessmentExport(
  auth: RequestContext,
  assessment: AssessmentRecord,
): Promise<PreparedAssessmentExport> {
  const selectionDocument = toAssessmentExportSelectionDocument(assessment);
  const itemExports = await loadAssessmentItemExports(db, auth, selectionDocument);
  requireAssessmentAnswerFeedbackRelease(itemExports.document, itemExports.itemsXml);
  const assessmentTest = await buildValidatedQti3Assessment(itemExports.document);
  return {
    document: itemExports.document,
    itemExports,
    assessmentXml: assessmentTest.xml,
    assessmentValidation: assessmentTest.validation,
  };
}

function buildPackageInput(
  prepared: PreparedAssessmentExport,
  itemsXml: Readonly<Record<string, string>>,
  assets: AssessmentExportPackageInput['assets'],
  assetIdsByItem: AssessmentExportPackageInput['assetIdsByItem'],
  standardsByItem: AssessmentExportPackageInput['standardsByItem'],
  assessmentXml: string,
  assessmentAssetIds: readonly string[],
): AssessmentExportPackageInput {
  return {
    document: prepared.document,
    assessmentXml,
    itemsXml,
    assets,
    assetIdsByItem,
    assessmentAssetIds,
    standardsByItem,
    tagsByItem: prepared.itemExports.tagsByItem,
    organizationByItem: prepared.itemExports.organizationByItem,
  };
}
