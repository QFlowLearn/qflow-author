import { type InspectedImportAdapter, inspectImportAdapters } from '../import/registry.ts';
import { ImportArchivePolicyError } from '../import/archive_policy.ts';
import type { ImportSource } from '../import/types.ts';
import { findRecoverySourceAdvisory, GENERATION_SOURCE_FORMATS } from './source_catalog.ts';

/** The two author intents supported by the source-intake workflow. */
export type SourcePurpose = 'recover_existing' | 'generate_new';
type SourceUnsupportedReasonCode =
  | 'examview_native'
  | 'empty_source'
  | 'unsupported_format'
  | 'archive_compressed_size'
  | 'archive_entry_count'
  | 'archive_invalid'
  | 'archive_uncompressed_size';
type SourceSelectionErrorCode =
  | 'missing_source'
  | 'missing_selection'
  | 'invalid_selection'
  | 'selection_mismatch'
  | 'unsupported_source'
  | 'invalid_confidence';
function archiveReason(code: string): SourceUnsupportedReasonCode {
  return code === 'compressed_size'
    ? 'archive_compressed_size'
    : code === 'entry_count'
    ? 'archive_entry_count'
    : code === 'invalid_archive'
    ? 'archive_invalid'
    : 'archive_uncompressed_size';
}

/** Stable identity for a source adapter implementation. */
export type SourceAdapterRef = {
  readonly id: string;
  readonly version: string;
};

/** A source adapter match shown to an author. */
export type SourceCandidate = {
  readonly adapter: SourceAdapterRef;
  readonly label: string;
  readonly confidence: number;
  readonly reason: string;
};

export type SourceInspection =
  | {
    readonly _tag: 'resolved';
    readonly sourceName: string;
    readonly candidate: SourceCandidate;
  }
  | {
    readonly _tag: 'confirmation_required';
    readonly sourceName: string;
    readonly candidates: readonly SourceCandidate[];
    readonly message: string;
    readonly code: 'confirmation_required';
  }
  | {
    readonly _tag: 'unsupported';
    readonly sourceName: string;
    readonly message: string;
    readonly code: SourceUnsupportedReasonCode;
    readonly suggestedPurpose?: SourcePurpose;
  };

export type SourceInput =
  | {
    readonly _tag: 'file';
    readonly source: ImportSource;
  }
  | {
    readonly _tag: 'paste';
    readonly text: string;
  };

export class SourceSelectionError extends Error {
  readonly code: SourceSelectionErrorCode;
  constructor(message: string, code: SourceSelectionErrorCode = 'invalid_selection') {
    super(message);
    this.name = 'SourceSelectionError';
    this.code = code;
  }
}

const AUTO_CONFIDENCE = 0.75;
const AUTO_LEAD = 0.15;
const EXACT_CONFIDENCE = 0.9;

/** Inspect a source for one explicit purpose and return all plausible matches. */
export async function inspectSource(
  purpose: SourcePurpose,
  input: SourceInput,
): Promise<SourceInspection> {
  if (input._tag === 'paste') {
    const text = input.text.trim();
    if (!text) {
      return {
        _tag: 'unsupported',
        sourceName: 'Pasted text',
        message: 'Paste source text before checking the format.',
        code: 'empty_source',
      };
    }
    if (purpose === 'generate_new') {
      return {
        _tag: 'resolved',
        sourceName: 'Pasted text',
        candidate: {
          adapter: { id: 'pasted-text', version: '1' },
          label: 'Pasted text',
          confidence: 1,
          reason: 'explicit-paste',
        },
      };
    }
    return await inspectRecoverySource({
      filename: 'pasted-text.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode(text),
    }, 'Pasted text');
  }

  const sourceName = input.source.filename?.trim();
  if (!sourceName) throw new SourceSelectionError('Source filename is required.', 'missing_source');
  if (purpose === 'recover_existing') {
    const result = await inspectRecoverySource(input.source, sourceName);
    if (result._tag === 'unsupported' && isGenerationDocument(input.source)) {
      return {
        ...result,
        message: 'This is source material, not a supported question package.',
        suggestedPurpose: 'generate_new',
      };
    }
    return result;
  }
  return inspectGenerationSource(input.source, sourceName);
}

/** Return the selected candidate after enforcing the inspection result. */
export function selectSourceCandidate(
  inspection: SourceInspection,
  selected?: SourceAdapterRef,
): SourceCandidate {
  if (inspection._tag === 'unsupported') {
    throw new SourceSelectionError(inspection.message, 'unsupported_source');
  }
  if (inspection._tag === 'resolved') {
    if (selected && !sameAdapter(selected, inspection.candidate.adapter)) {
      throw new SourceSelectionError(
        'The selected source adapter does not match the detected format.',
        'selection_mismatch',
      );
    }
    return inspection.candidate;
  }
  if (!selected) {
    throw new SourceSelectionError(
      'Confirm the source format before continuing.',
      'missing_selection',
    );
  }
  const candidate = inspection.candidates.find((entry) => sameAdapter(entry.adapter, selected));
  if (!candidate) {
    throw new SourceSelectionError(
      'The selected source adapter is not a detected candidate.',
      'selection_mismatch',
    );
  }
  return candidate;
}

function inspectGenerationSource(source: ImportSource, sourceName: string): SourceInspection {
  const filename = sourceName.toLowerCase();
  const mime = source.mime?.split(';', 1)[0].trim().toLowerCase() ?? '';
  const candidates = GENERATION_SOURCE_FORMATS.filter((adapter) =>
    adapter.extensions.some((extension) => filename.endsWith(extension)) ||
    adapter.mimeTypes.some((mimeType) => mime === mimeType)
  ).map((adapter): SourceCandidate => ({
    adapter: { id: adapter.id, version: '1' },
    label: `${adapter.label} document`,
    confidence: 1,
    reason: 'file-type',
  }));

  if (candidates.length === 1) {
    return { _tag: 'resolved', sourceName, candidate: candidates[0] };
  }
  if (candidates.length > 1) {
    return {
      _tag: 'confirmation_required',
      sourceName,
      candidates,
      message: 'Confirm the source format before continuing.',
      code: 'confirmation_required',
    };
  }
  return {
    _tag: 'unsupported',
    sourceName,
    message: 'Generate from source supports PDF, DOCX, Markdown, and plain-text files.',
    suggestedPurpose: 'recover_existing',
    code: 'unsupported_format',
  };
}

async function inspectRecoverySource(
  source: ImportSource,
  sourceName: string,
): Promise<SourceInspection> {
  const advisory = findRecoverySourceAdvisory(sourceName);
  if (advisory) {
    return {
      _tag: 'unsupported',
      sourceName,
      message: advisory,
      code: sourceName.toLowerCase().endsWith('.tst') || sourceName.toLowerCase().endsWith('.bnk')
        ? 'examview_native'
        : 'unsupported_format',
    };
  }
  let inspected: InspectedImportAdapter[];
  try {
    inspected = await inspectImportAdapters(source);
  } catch (cause: unknown) {
    if (cause instanceof ImportArchivePolicyError) {
      return {
        _tag: 'unsupported',
        sourceName,
        message: cause.message,
        code: archiveReason(cause.code),
      };
    }
    throw cause;
  }
  const candidates = inspected
    .filter((entry) => entry.sniff.supported)
    .sort(compareImportMatches)
    .map((entry): SourceCandidate => ({
      adapter: { id: entry.adapter.id, version: entry.adapter.version },
      label: entry.adapter.label,
      confidence: normalizeConfidence(entry.sniff.confidence),
      reason: entry.sniff.reason ?? 'content-match',
    }));

  if (!candidates.length) {
    return {
      _tag: 'unsupported',
      sourceName,
      message: 'No question-package adapter recognized this source.',
      code: 'unsupported_format',
    };
  }

  const top = candidates[0];
  const runnerUp = candidates[1];
  const lead = runnerUp ? top.confidence - runnerUp.confidence : 1;
  if (
    (top.confidence >= EXACT_CONFIDENCE && (!runnerUp || runnerUp.confidence < EXACT_CONFIDENCE)) ||
    (top.confidence >= AUTO_CONFIDENCE && lead >= AUTO_LEAD)
  ) {
    return { _tag: 'resolved', sourceName, candidate: top };
  }

  return {
    _tag: 'confirmation_required',
    sourceName,
    candidates,
    message: 'QFlowLearn found a possible format, but needs your confirmation.',
    code: 'confirmation_required',
  };
}

function compareImportMatches(a: InspectedImportAdapter, b: InspectedImportAdapter): number {
  if (b.sniff.confidence !== a.sniff.confidence) return b.sniff.confidence - a.sniff.confidence;
  if (b.adapter.priority !== a.adapter.priority) return b.adapter.priority - a.adapter.priority;
  return a.index - b.index;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new SourceSelectionError(
      'Source adapter confidence must be between 0 and 1.',
      'invalid_confidence',
    );
  }
  return Math.round(value * 100) / 100;
}

function sameAdapter(a: SourceAdapterRef, b: SourceAdapterRef): boolean {
  return a.id === b.id && a.version === b.version;
}

function isGenerationDocument(source: ImportSource): boolean {
  const filename = source.filename?.trim().toLowerCase() ?? '';
  const mime = source.mime?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return GENERATION_SOURCE_FORMATS.some((adapter) =>
    adapter.extensions.some((extension) => filename.endsWith(extension)) ||
    adapter.mimeTypes.some((mimeType) => mime === mimeType)
  );
}
