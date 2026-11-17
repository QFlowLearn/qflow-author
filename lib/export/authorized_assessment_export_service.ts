import type { AssessmentRecord } from '../services/assessment_records.ts';
import type { RequestContext } from '../tenants.ts';
import type { StoredUpload } from '../uploads.ts';
import type { ObjectWriter } from '../storage_contract.ts';
import {
  type AssessmentExportArtifactFailure,
  materializeAssessmentExportArtifact,
  type MaterializedAssessmentExport,
} from './assessment_export_artifact.ts';
import { authorizeAssessmentExport } from './assessment_export_authorization.ts';
import { createAssessmentExportReceipt } from './assessment_export_final_receipt.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportPreflightId,
} from './assessment_export_preflight.ts';
import type {
  AssessmentExportRequirements,
  ExportActorId,
} from './assessment_export_requirements.ts';
import { buildAssessmentPackage } from './assessment_package.ts';

type BuildFailure = Extract<
  Awaited<ReturnType<typeof buildAssessmentPackage>>,
  { readonly ok: false }
>;

type AuthorizationFailure = Exclude<
  Awaited<ReturnType<typeof authorizeAssessmentExport>>,
  { readonly _tag: 'Authorized' }
>;

/** Typed outcome of the shared package build and authorization service. */
export type CreateMaterializedAssessmentExportResult =
  | { readonly ok: true; readonly value: MaterializedAssessmentExport }
  | { readonly ok: false; readonly _tag: 'BuildFailed'; readonly failure: BuildFailure }
  | {
    readonly ok: false;
    readonly _tag: 'ArtifactFailed';
    readonly error: AssessmentExportArtifactFailure;
  }
  | {
    readonly ok: false;
    readonly _tag: 'AuthorizationFailed';
    readonly decision: AuthorizationFailure;
  };

/** Builds, authorizes, and materializes one exact package through the canonical export gate. */
export async function createMaterializedAssessmentExport(input: {
  readonly assessment: AssessmentRecord;
  readonly auth: RequestContext;
  readonly storage: ObjectWriter;
  readonly readUploadBytes: (upload: StoredUpload) => Promise<Uint8Array>;
  readonly targetId: string | null;
  readonly requirements: AssessmentExportRequirements;
  readonly authorizedBy: ExportActorId;
  readonly approvedPreflightId: AssessmentExportPreflightId | null;
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
  readonly createdAt: Date;
}): Promise<CreateMaterializedAssessmentExportResult> {
  const built = await buildAssessmentPackage({
    assessment: input.assessment,
    auth: input.auth,
    readUploadBytes: input.readUploadBytes,
    targetId: input.targetId,
    requirements: input.requirements,
  });
  if (!built.ok) return { ok: false, _tag: 'BuildFailed', failure: built };

  const authorization = await authorizeAssessmentExport({
    candidate: {
      artifact: built.artifact,
      fidelityReceipt: built.receipt,
      preflight: built.preflight,
    },
    authorizedBy: input.authorizedBy,
    approvedPreflightId: input.approvedPreflightId,
    acknowledgementToken: input.acknowledgementToken,
  });
  if (authorization._tag !== 'Authorized') {
    return { ok: false, _tag: 'AuthorizationFailed', decision: authorization };
  }
  const receipt = await createAssessmentExportReceipt({
    authorizedExport: authorization.value,
    createdAt: input.createdAt,
  });
  const materialized = await materializeAssessmentExportArtifact(input.storage, {
    tenantId: input.auth.tenantId,
    assessmentId: input.assessment.id,
    filename: authorization.value.artifact.filename,
    mediaType: authorization.value.artifact.mediaType,
    bytes: authorization.value.artifact.bytes,
    expectedSha256: receipt.package.sha256,
  });
  if (!materialized.ok) {
    return { ok: false, _tag: 'ArtifactFailed', error: materialized.error };
  }
  return {
    ok: true,
    value: {
      artifact: materialized.value,
      receipt,
    },
  };
}
