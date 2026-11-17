import type { SourceCandidate, SourceInspection } from '../../lib/source_intake/registry.ts';

export type SourceIntakeFailureCodeClient =
  | 'invalid_idempotency_key'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'invalid_request'
  | 'missing_source'
  | 'too_many_files'
  | 'invalid_purpose'
  | 'invalid_adapter'
  | 'invalid_file'
  | 'source_too_large'
  | 'text_too_long'
  | 'invalid_selection'
  | 'conflict'
  | 'method_not_allowed'
  | 'configuration_unavailable'
  | 'missing_selection'
  | 'selection_mismatch'
  | 'unsupported_source'
  | 'invalid_confidence'
  | 'unexpected';
export type SourceIntakeFailure = {
  readonly code: SourceIntakeFailureCodeClient;
  readonly params?: Readonly<{ limit: number }>;
};
export class LocalizedIntakeFailure extends Error {
  readonly localized: string;
  constructor(message: string) {
    super('localized_failure');
    this.localized = message;
    this.name = 'LocalizedIntakeFailure';
  }
}
export function parseSourceIntakeFailureEnvelope(value: unknown): SourceIntakeFailure | null {
  if (!isRecord(value) || !isFailureCode(value.code)) return null;
  const isLimitCode = value.code === 'payload_too_large' || value.code === 'too_many_files' ||
    value.code === 'source_too_large' || value.code === 'text_too_long';
  if (!Object.prototype.hasOwnProperty.call(value, 'params')) {
    return isLimitCode ? null : { code: value.code };
  }
  if (!isLimitCode) return { code: value.code };
  if (
    !isRecord(value.params) || typeof value.params.limit !== 'number' ||
    !Number.isSafeInteger(value.params.limit) || value.params.limit <= 0
  ) return null;
  return { code: value.code, params: { limit: value.params.limit } };
}
export function parseSourceInspectionResponse(value: unknown): SourceInspection[] | null {
  if (!isRecord(value) || !Array.isArray(value.inspections)) return null;
  const parsed = parseInspections(value.inspections);
  return parsed.length ? parsed : null;
}
export function sourceIntakeFailureMessage(
  i18n: import('../../lib/i18n/messages.ts').I18n,
  failure: SourceIntakeFailure,
): string {
  switch (failure.code) {
    case 'invalid_idempotency_key':
      return i18n.t('imports.intake.error.invalidIdempotencyKey');
    case 'payload_too_large':
      return failure.params
        ? i18n.t('imports.intake.error.payloadTooLarge', {
          limit: formatLimit(i18n, failure.params.limit),
        })
        : i18n.t('imports.intake.error.unexpected');
    case 'unsupported_media_type':
      return i18n.t('imports.intake.error.unsupportedMediaType');
    case 'invalid_request':
      return i18n.t('imports.intake.error.invalidRequest');
    case 'missing_source':
      return i18n.t('imports.intake.error.missingSource');
    case 'too_many_files':
      return failure.params
        ? i18n.t('imports.intake.error.tooManyFiles', {
          limit: i18n.formatNumber(failure.params.limit),
        })
        : i18n.t('imports.intake.error.unexpected');
    case 'source_too_large':
      return failure.params
        ? i18n.t('imports.intake.error.sourceTooLarge', {
          limit: formatLimit(i18n, failure.params.limit),
        })
        : i18n.t('imports.intake.error.unexpected');
    case 'text_too_long':
      return failure.params
        ? i18n.t('imports.intake.error.textTooLong', {
          limit: i18n.formatNumber(failure.params.limit),
        })
        : i18n.t('imports.intake.error.unexpected');
    case 'invalid_purpose':
      return i18n.t('imports.intake.error.invalidPurpose');
    case 'invalid_adapter':
      return i18n.t('imports.intake.error.invalidAdapter');
    case 'invalid_file':
      return i18n.t('imports.intake.error.invalidFile');
    case 'invalid_selection':
      return i18n.t('imports.intake.error.invalidSelection');
    case 'conflict':
      return i18n.t('imports.intake.error.conflict');
    case 'method_not_allowed':
      return i18n.t('imports.intake.error.methodNotAllowed');
    case 'configuration_unavailable':
      return i18n.t('imports.intake.error.configurationUnavailable');
    case 'missing_selection':
      return i18n.t('imports.intake.error.missingSelection');
    case 'selection_mismatch':
      return i18n.t('imports.intake.error.selectionMismatch');
    case 'unsupported_source':
      return i18n.t('imports.intake.error.unsupportedSource');
    case 'invalid_confidence':
      return i18n.t('imports.intake.error.invalidConfidence');
    case 'unexpected':
      return i18n.t('imports.intake.error.unexpected');
  }
}
function formatLimit(i18n: import('../../lib/i18n/messages.ts').I18n, bytes: number): string {
  return bytes % (1024 * 1024) === 0
    ? i18n.t('imports.intake.sizeMiB', { value: bytes / (1024 * 1024) })
    : i18n.t('imports.intake.sizeBytes', { value: bytes });
}
function parseInspections(value: unknown): SourceInspection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = parseInspection(entry);
    return parsed ? [parsed] : [];
  });
}
function parseInspection(value: unknown): SourceInspection | null {
  if (!isRecord(value) || typeof value.sourceName !== 'string') return null;
  if (value._tag === 'resolved') {
    const candidate = parseCandidate(value.candidate);
    return candidate ? { _tag: 'resolved', sourceName: value.sourceName, candidate } : null;
  }
  if (value._tag === 'confirmation_required') {
    if (!Array.isArray(value.candidates) || typeof value.message !== 'string') return null;
    const candidates = value.candidates.flatMap((entry) => {
      const candidate = parseCandidate(entry);
      return candidate ? [candidate] : [];
    });
    return candidates.length
      ? {
        _tag: 'confirmation_required',
        sourceName: value.sourceName,
        candidates,
        message: value.message,
        code: 'confirmation_required',
      }
      : null;
  }
  if (value._tag !== 'unsupported' || typeof value.message !== 'string') return null;
  const suggestedPurpose =
    value.suggestedPurpose === 'recover_existing' || value.suggestedPurpose === 'generate_new'
      ? value.suggestedPurpose
      : undefined;
  return {
    _tag: 'unsupported',
    sourceName: value.sourceName,
    message: value.message,
    code: isUnsupportedCode(value.code) ? value.code : 'unsupported_format',
    suggestedPurpose,
  };
}
function parseCandidate(value: unknown): SourceCandidate | null {
  if (
    !isRecord(value) || !isRecord(value.adapter) || typeof value.adapter.id !== 'string' ||
    typeof value.adapter.version !== 'string' || typeof value.label !== 'string' ||
    typeof value.confidence !== 'number' || typeof value.reason !== 'string'
  ) return null;
  return {
    adapter: { id: value.adapter.id, version: value.adapter.version },
    label: value.label,
    confidence: value.confidence,
    reason: value.reason,
  };
}
export function adapterLabel(
  i18n: import('../../lib/i18n/messages.ts').I18n,
  id: string,
  legacyLabel: string,
): string {
  const known = [
    'qti3',
    'imscc',
    'qti21',
    'qti12',
    'blackboard',
    'examview_xml',
    'moodle_xml',
    'respondus_standard',
    'gift',
    'aiken',
    'pdf',
    'docx',
    'markdown',
    'text',
    'pasted-text',
  ];
  return known.includes(id)
    ? i18n.t('imports.intake.adapterLabel', { id: id.replaceAll('-', '_') })
    : legacyLabel;
}
export function inspectionReasonMessage(
  i18n: import('../../lib/i18n/messages.ts').I18n,
  code: string,
): string {
  const keys: Record<string, string> = {
    examview_native: 'examviewNative',
    empty_source: 'emptySource',
    unsupported_format: 'unsupportedFormat',
    archive_compressed_size: 'archiveCompressedSize',
    archive_entry_count: 'archiveEntryCount',
    archive_invalid: 'archiveInvalid',
    archive_uncompressed_size: 'archiveUncompressedSize',
    confirmation_required: 'confirmationRequired',
  };
  return i18n.t(`imports.intake.reason.${keys[code] ?? 'unsupportedFormat'}`);
}
function isFailureCode(value: unknown): value is SourceIntakeFailureCodeClient {
  return typeof value === 'string' &&
    [
      'invalid_idempotency_key',
      'payload_too_large',
      'unsupported_media_type',
      'invalid_request',
      'missing_source',
      'too_many_files',
      'invalid_purpose',
      'invalid_adapter',
      'invalid_file',
      'source_too_large',
      'text_too_long',
      'invalid_selection',
      'conflict',
      'method_not_allowed',
      'configuration_unavailable',
      'missing_selection',
      'selection_mismatch',
      'unsupported_source',
      'invalid_confidence',
      'unexpected',
    ].includes(value);
}
type SourceUnsupportedCode =
  | 'examview_native'
  | 'empty_source'
  | 'unsupported_format'
  | 'archive_compressed_size'
  | 'archive_entry_count'
  | 'archive_invalid'
  | 'archive_uncompressed_size';
function isUnsupportedCode(value: unknown): value is SourceUnsupportedCode {
  return typeof value === 'string' &&
    [
      'examview_native',
      'empty_source',
      'unsupported_format',
      'archive_compressed_size',
      'archive_entry_count',
      'archive_invalid',
      'archive_uncompressed_size',
    ].includes(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
