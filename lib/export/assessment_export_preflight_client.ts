import type { AssessmentExportRequirementSelection } from './assessment_export_http.ts';
import { setAssessmentExportRequirementQuery } from './assessment_export_http.ts';
import type {
  AssessmentExportAcknowledgementToken,
  AssessmentExportOutcome,
  AssessmentExportPreflightId,
  AssessmentExportSourceScoring,
} from './assessment_export_preflight.ts';
import type { SelectableAssessmentExportTargetId } from './assessment_export_targets.ts';
import { resolveAssessmentExportTarget } from './assessment_export_targets.ts';

/** Mapping evidence rendered by the destination preflight workspace. */
export type AssessmentExportPreflightMappingView = {
  readonly index: number;
  readonly sourceInteraction: string;
  readonly emittedInteraction: string;
  readonly fidelity: 'exact' | 'normalized' | 'lossy';
  readonly scoring: 'automatic' | 'manual' | 'unscored';
  readonly sourceScoring: AssessmentExportSourceScoring;
  readonly fallback: string | null;
  readonly affectedPaths: readonly string[];
  readonly diagnosticCodes: readonly string[];
};

/** Item evidence rendered by the destination preflight workspace. */
export type AssessmentExportPreflightItemView = {
  readonly _tag: 'Preserved' | 'Transformed' | 'Warning' | 'Blocked';
  readonly itemId: string;
  readonly itemIdentifier: string;
  readonly title: string;
  readonly fidelity: 'exact' | 'normalized' | 'lossy' | 'canonical' | 'unresolved';
  readonly mappings: readonly AssessmentExportPreflightMappingView[];
  readonly affectedPaths: readonly string[];
  readonly diagnosticCodes: readonly string[];
};

/** Safe requirement change rendered by the destination preflight workspace. */
export type AssessmentExportRepairView = {
  readonly _tag: 'AcceptManualScoring' | 'AcceptDiagnosedFallbacks';
  readonly id: 'accept-manual-scoring' | 'accept-diagnosed-fallbacks';
  readonly affectedItemIds: readonly string[];
};

type AssessmentExportPreflightViewBase = {
  readonly preflightId: AssessmentExportPreflightId;
  readonly destinationId: SelectableAssessmentExportTargetId;
  readonly targetContractId: string;
  readonly overallOutcome: AssessmentExportOutcome;
  readonly items: readonly AssessmentExportPreflightItemView[];
  readonly packageDiagnosticCodes: readonly string[];
  readonly warningCodes: readonly string[];
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
  readonly repairs: readonly AssessmentExportRepairView[];
};

/** Parsed protocol projection consumed by the destination preflight workspace. */
export type AssessmentExportPreflightView =
  | (AssessmentExportPreflightViewBase & {
    readonly _tag: 'Evaluated';
    readonly artifact: {
      readonly filename: string;
      readonly mediaType: string;
      readonly byteLength: number;
    };
  })
  | (AssessmentExportPreflightViewBase & {
    readonly _tag: 'BuildBlocked';
    readonly overallOutcome: 'blocked';
    readonly artifact: null;
  });

/** Typed result of loading current destination preflight from the HTTP boundary. */
export type LoadAssessmentExportPreflightResult =
  | { readonly ok: true; readonly preflight: AssessmentExportPreflightView }
  | {
    readonly ok: false;
    readonly error: AssessmentExportPreflightFailure;
  };

export type AssessmentExportPreflightFailure = {
  readonly code: AssessmentExportPreflightErrorCode;
  readonly diagnosticCode?: string;
};

export type AssessmentExportPreflightErrorCode =
  | 'PreflightRequestFailed'
  | 'PreflightFailed'
  | 'InvalidPreflightResponse';

/** Executes and parses destination preflight for one explicit target and requirement selection. */
export async function loadAssessmentExportPreflight(
  assessmentId: string,
  targetId: SelectableAssessmentExportTargetId,
  selection: AssessmentExportRequirementSelection,
  options: { readonly signal?: AbortSignal } = {},
): Promise<LoadAssessmentExportPreflightResult> {
  const url = new URL(`/api/assessments/${assessmentId}/validate`, globalThis.location.origin);
  url.searchParams.set('target', targetId);
  setAssessmentExportRequirementQuery(url, selection);
  let response: Response;
  try {
    response = await fetch(url, { signal: options.signal });
  } catch (cause: unknown) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    return {
      ok: false,
      error: {
        code: 'PreflightRequestFailed',
      },
    };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return parsePreflightFailure(payload);
  return parsePreflightSuccess(payload);
}

function parsePreflightSuccess(input: unknown): LoadAssessmentExportPreflightResult {
  const root = parseRecord(input);
  const raw = root?.preflight;
  const preflight = parseRecord(raw);
  if (!preflight) return invalidPreflightResponse();
  const tag = preflight._tag;
  const preflightId = parseContentId(preflight.preflightId);
  const destinationId = parseDestinationId(preflight.destinationId);
  const overallOutcome = parseOutcome(preflight.overallOutcome);
  const items = parseArray(preflight.items, parseItem);
  const repairs = parseArray(preflight.repairs, parseRepair);
  const packageDiagnosticCodes = parseStringArray(preflight.packageDiagnosticCodes);
  const warningCodes = parseStringArray(preflight.warningCodes);
  const artifact = preflight.artifact === null ? null : parseArtifact(preflight.artifact);
  const acknowledgementToken = preflight.acknowledgementToken === null
    ? null
    : parseAcknowledgementToken(preflight.acknowledgementToken);
  if (
    !preflightId ||
    !destinationId ||
    !overallOutcome ||
    !items ||
    !repairs ||
    !packageDiagnosticCodes ||
    !warningCodes ||
    (preflight.acknowledgementToken !== null && !acknowledgementToken) ||
    typeof preflight.targetContractId !== 'string' ||
    (tag !== 'Evaluated' && tag !== 'BuildBlocked') ||
    (tag === 'Evaluated' && artifact === null) ||
    (tag === 'BuildBlocked' && (overallOutcome !== 'blocked' || artifact !== null)) ||
    (overallOutcome === 'warning' && acknowledgementToken === null) ||
    (overallOutcome !== 'warning' && acknowledgementToken !== null)
  ) {
    return invalidPreflightResponse();
  }
  return {
    ok: true,
    preflight: {
      _tag: tag,
      preflightId,
      destinationId,
      targetContractId: preflight.targetContractId,
      overallOutcome,
      items,
      packageDiagnosticCodes,
      warningCodes,
      acknowledgementToken,
      repairs,
      artifact,
    } as AssessmentExportPreflightView,
  };
}

function parsePreflightFailure(input: unknown): LoadAssessmentExportPreflightResult {
  const record = parseRecord(input);
  const diagnosticCode = record && isStableAssessmentExportDiagnosticCode(record.error)
    ? record.error
    : undefined;
  const error: AssessmentExportPreflightFailure = diagnosticCode
    ? { code: 'PreflightFailed', diagnosticCode }
    : { code: 'PreflightFailed' };
  return {
    ok: false,
    error,
  };
}

function parseItem(input: unknown): AssessmentExportPreflightItemView | null {
  const record = parseRecord(input);
  if (!record) return null;
  const tag = record._tag;
  const fidelity = record.fidelity;
  const mappings = parseArray(record.mappings, parseMapping);
  const affectedPaths = parseStringArray(record.affectedPaths);
  const diagnosticCodes = parseStringArray(record.diagnosticCodes);
  if (
    (tag !== 'Preserved' && tag !== 'Transformed' && tag !== 'Warning' && tag !== 'Blocked') ||
    typeof record.itemId !== 'string' ||
    typeof record.itemIdentifier !== 'string' ||
    typeof record.title !== 'string' ||
    (fidelity !== 'exact' && fidelity !== 'normalized' && fidelity !== 'lossy' &&
      fidelity !== 'canonical' && fidelity !== 'unresolved') ||
    !mappings ||
    !affectedPaths ||
    !diagnosticCodes
  ) return null;
  return {
    _tag: tag,
    itemId: record.itemId,
    itemIdentifier: record.itemIdentifier,
    title: record.title,
    fidelity,
    mappings,
    affectedPaths,
    diagnosticCodes,
  };
}

function parseMapping(input: unknown): AssessmentExportPreflightMappingView | null {
  const record = parseRecord(input);
  if (!record) return null;
  const fidelity = record.fidelity;
  const scoring = record.scoring;
  const sourceScoring = record.sourceScoring;
  const affectedPaths = parseStringArray(record.affectedPaths);
  const diagnosticCodes = parseStringArray(record.diagnosticCodes);
  if (
    typeof record.index !== 'number' ||
    !Number.isInteger(record.index) ||
    typeof record.sourceInteraction !== 'string' ||
    typeof record.emittedInteraction !== 'string' ||
    (fidelity !== 'exact' && fidelity !== 'normalized' && fidelity !== 'lossy') ||
    (scoring !== 'automatic' && scoring !== 'manual' && scoring !== 'unscored') ||
    (sourceScoring !== 'automatic' && sourceScoring !== 'manual-or-unscored') ||
    (record.fallback !== undefined && typeof record.fallback !== 'string') ||
    !affectedPaths ||
    !diagnosticCodes
  ) return null;
  return {
    index: record.index,
    sourceInteraction: record.sourceInteraction,
    emittedInteraction: record.emittedInteraction,
    fidelity,
    scoring,
    sourceScoring,
    fallback: typeof record.fallback === 'string' ? record.fallback : null,
    affectedPaths,
    diagnosticCodes,
  };
}

function parseRepair(input: unknown): AssessmentExportRepairView | null {
  const record = parseRecord(input);
  const affectedItemIds = parseStringArray(record?.affectedItemIds);
  if (
    !record || !affectedItemIds || typeof record.label !== 'string' ||
    typeof record.consequence !== 'string'
  ) return null;
  switch (record._tag) {
    case 'AcceptManualScoring':
      if (record.id !== 'accept-manual-scoring') return null;
      return {
        _tag: record._tag,
        id: record.id,
        affectedItemIds,
      };
    case 'AcceptDiagnosedFallbacks':
      if (record.id !== 'accept-diagnosed-fallbacks') return null;
      return {
        _tag: record._tag,
        id: record.id,
        affectedItemIds,
      };
    default:
      return null;
  }
}

function parseArtifact(input: unknown): AssessmentExportPreflightView['artifact'] | null {
  const record = parseRecord(input);
  if (
    !record ||
    typeof record.filename !== 'string' ||
    typeof record.mediaType !== 'string' ||
    typeof record.byteLength !== 'number' ||
    !Number.isSafeInteger(record.byteLength) ||
    record.byteLength < 0
  ) return null;
  return {
    filename: record.filename,
    mediaType: record.mediaType,
    byteLength: record.byteLength,
  };
}

function parseDestinationId(input: unknown): SelectableAssessmentExportTargetId | null {
  if (typeof input !== 'string') return null;
  const resolved = resolveAssessmentExportTarget(input);
  return resolved.ok ? resolved.target.id : null;
}

function parseOutcome(input: unknown): AssessmentExportOutcome | null {
  if (
    input === 'preserved' ||
    input === 'transformed' ||
    input === 'warning' ||
    input === 'blocked'
  ) return input;
  return null;
}

function parseContentId(input: unknown): AssessmentExportPreflightId | null {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) return null;
  // SAFETY: The content-addressed identifier pattern was established above.
  return input as AssessmentExportPreflightId;
}

function parseAcknowledgementToken(
  input: unknown,
): AssessmentExportAcknowledgementToken | null {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) return null;
  // SAFETY: Acknowledgement tokens use the same SHA-256 content identifier invariant.
  return input as AssessmentExportAcknowledgementToken;
}

function parseStringArray(input: unknown): readonly string[] | null {
  if (!Array.isArray(input) || !input.every((entry) => typeof entry === 'string')) return null;
  return input;
}

function parseArray<T>(
  input: unknown,
  parseEntry: (entry: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(input)) return null;
  const parsed: T[] = [];
  for (const entry of input) {
    const value = parseEntry(entry);
    if (value === null) return null;
    parsed.push(value);
  }
  return parsed;
}

function parseRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: The value is now known to be a non-null, non-array object with unknown properties.
  return input as Record<string, unknown>;
}

export function isStableAssessmentExportDiagnosticCode(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0;
}

function invalidPreflightResponse(): LoadAssessmentExportPreflightResult {
  return {
    ok: false,
    error: {
      code: 'InvalidPreflightResponse',
    },
  };
}
