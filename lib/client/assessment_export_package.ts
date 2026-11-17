import type { AssessmentExportSelection } from './assessment_export_workflow.ts';
import { setAssessmentExportRequirementQuery } from '../export/assessment_export_http.ts';
import type { AssessmentExportPreflightView } from '../export/assessment_export_preflight_client.ts';

export type AssessmentExportPackageDownload =
  | {
    readonly ok: true;
    readonly blob: Blob;
    readonly filename: string;
    readonly receiptUrl: string | null;
  }
  | { readonly ok: false; readonly failure: AssessmentExportPackageFailure };

export type AssessmentExportPackageFailure = {
  readonly code: AssessmentExportPackageErrorCode;
  readonly diagnosticCode?: string;
};

export type AssessmentExportPackageErrorCode = 'PackageRequestFailed' | 'PackageRejected';

/** Fetches and validates the browser package response for one exact ready preflight. */
export async function downloadAssessmentExportPackage(input: {
  readonly assessmentId: string;
  readonly selection: AssessmentExportSelection;
  readonly preflight: Extract<AssessmentExportPreflightView, { readonly _tag: 'Evaluated' }>;
}): Promise<AssessmentExportPackageDownload> {
  try {
    const url = new URL(
      `/api/assessments/${input.assessmentId}/package`,
      globalThis.location.origin,
    );
    url.searchParams.set('target', input.selection.targetId);
    url.searchParams.set('preflightId', input.preflight.preflightId);
    setAssessmentExportRequirementQuery(url, input.selection.requirements);
    if (input.preflight.acknowledgementToken) {
      url.searchParams.set('acknowledgement', input.preflight.acknowledgementToken);
    }
    const response = await fetch(url);
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const record = parseRecord(payload);
      const candidate = record?.error;
      const diagnosticCode = isStableAssessmentExportDiagnosticCode(candidate)
        ? candidate
        : undefined;
      const failure: AssessmentExportPackageFailure = diagnosticCode
        ? { code: 'PackageRejected', diagnosticCode }
        : { code: 'PackageRejected' };
      return { ok: false, failure };
    }
    return {
      ok: true,
      blob: await response.blob(),
      filename: packageFilename(response, input.preflight.artifact.filename),
      receiptUrl: receiptLink(response),
    };
  } catch (_cause: unknown) {
    return { ok: false, failure: { code: 'PackageRequestFailed' } };
  }
}

function parseRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function isStableAssessmentExportDiagnosticCode(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0;
}

/** Hands an already validated package blob to the browser download surface. */
export function saveAssessmentExportPackage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function packageFilename(response: Response, defaultFilename: string): string {
  const disposition = response.headers.get('content-disposition');
  const match = disposition ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? defaultFilename;
}

function receiptLink(response: Response): string | null {
  const link = response.headers.get('link');
  const match = link ? /^<([^>]+)>;/.exec(link) : null;
  return match?.[1] ?? null;
}
