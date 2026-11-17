import { sha256Hex } from '../sha256.ts';
import type {
  ObjectReader,
  ObjectStreamReader,
  ObjectWriter,
  StorageObjectStream,
} from '../storage_contract.ts';
import type { AssessmentExportReceipt } from './assessment_export_final_receipt.ts';

/** Content-addressed storage reference for one exact authorized export artifact. */
export type MaterializedAssessmentExportArtifact = {
  readonly storageKey: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly byteLength: number;
};

/** One immutable receipt and the exact content-addressed object it authorizes. */
export type MaterializedAssessmentExport = {
  readonly receipt: AssessmentExportReceipt;
  readonly artifact: MaterializedAssessmentExportArtifact;
};

/** Expected artifact-storage failure that leaves canonical assessment state unchanged. */
export type AssessmentExportArtifactFailure = {
  readonly _tag: 'AssessmentExportArtifactUnavailable';
  readonly message: 'QFlowLearn could not access the approved export package.';
  readonly cause: unknown;
};

type AssessmentExportArtifactResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AssessmentExportArtifactFailure };

/** Writes the exact authorized bytes once under their tenant-scoped content address. */
export async function materializeAssessmentExportArtifact(
  storage: ObjectWriter,
  input: {
    readonly tenantId: string;
    readonly assessmentId: string;
    readonly filename: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
    readonly expectedSha256: string;
  },
): Promise<AssessmentExportArtifactResult<MaterializedAssessmentExportArtifact>> {
  try {
    const sha256 = await sha256Hex(input.bytes);
    if (sha256 !== input.expectedSha256) {
      throw new Error('Approved export artifact hash mismatch.');
    }
    const artifact: MaterializedAssessmentExportArtifact = {
      storageKey: assessmentExportArtifactStorageKey({
        tenantId: input.tenantId,
        assessmentId: input.assessmentId,
        artifactSha256: sha256,
      }),
      filename: input.filename,
      mediaType: input.mediaType,
      sha256,
      byteLength: input.bytes.byteLength,
    };
    await storage.putObject({
      key: artifact.storageKey,
      data: input.bytes,
      contentType: artifact.mediaType,
      immutableIdentity: { sha256: artifact.sha256 },
    });
    return { ok: true, value: artifact };
  } catch (cause: unknown) {
    return artifactFailure(cause);
  }
}

/** Reads and hashes approved bytes for connectors that require a materialized request body. */
export async function readMaterializedAssessmentExportArtifact(
  storage: ObjectReader,
  artifact: MaterializedAssessmentExportArtifact,
): Promise<AssessmentExportArtifactResult<Uint8Array>> {
  try {
    const bytes = await storage.readObject(artifact.storageKey);
    const sha256 = await sha256Hex(bytes);
    if (bytes.byteLength !== artifact.byteLength || sha256 !== artifact.sha256) {
      throw new Error('Approved export artifact identity mismatch.');
    }
    return { ok: true, value: bytes };
  } catch (cause: unknown) {
    return artifactFailure(cause);
  }
}

/** Opens the approved storage object as a bounded HTTP stream without another byte copy. */
export async function streamMaterializedAssessmentExportArtifact(
  storage: ObjectStreamReader,
  artifact: MaterializedAssessmentExportArtifact,
): Promise<AssessmentExportArtifactResult<StorageObjectStream>> {
  try {
    const stream = await storage.readObjectStream(artifact.storageKey);
    if (
      stream.contentLength !== artifact.byteLength ||
      stream.contentType !== artifact.mediaType ||
      stream.contentSha256 !== artifact.sha256
    ) {
      await stream.body.cancel().catch(() => {});
      throw new Error('Approved export artifact streaming metadata mismatch.');
    }
    return { ok: true, value: stream };
  } catch (cause: unknown) {
    return artifactFailure(cause);
  }
}

/** Returns the deterministic tenant/assessment/content address for one export artifact. */
export function assessmentExportArtifactStorageKey(input: {
  readonly tenantId: string;
  readonly assessmentId: string;
  readonly artifactSha256: string;
}): string {
  return [
    'assessment-export-artifacts',
    input.tenantId,
    input.assessmentId,
    `${input.artifactSha256}.package`,
  ].join('/');
}

function artifactFailure(
  cause: unknown,
): { readonly ok: false; readonly error: AssessmentExportArtifactFailure } {
  return {
    ok: false,
    error: {
      _tag: 'AssessmentExportArtifactUnavailable',
      message: 'QFlowLearn could not access the approved export package.',
      cause,
    },
  };
}
