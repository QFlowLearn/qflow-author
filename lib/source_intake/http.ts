import { migrationPurposeError } from '../import/migration_destination.ts';
import type { SourceIntakeDestination } from './entry_context.ts';
import type { ImportSource } from '../import/types.ts';
import { BoundedMultipartError, parseBoundedMultipartFormData } from '../http/bounded_multipart.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { SourceAdapterRef, SourceInput, SourcePurpose } from './registry.ts';
import {
  formatSourceByteLimit,
  MAX_GENERATION_FILE_BYTES,
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  MAX_SOURCE_REQUEST_BYTES,
  MAX_SOURCE_TEXT_CHARS,
} from './policy.ts';
export {
  MAX_GENERATION_FILE_BYTES,
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  MAX_SOURCE_MULTIPART_OVERHEAD_BYTES,
  MAX_SOURCE_REQUEST_BYTES,
  MAX_SOURCE_TEXT_CHARS,
} from './policy.ts';

export class SourceIntakeRequestError extends Error {
  readonly status: number;
  readonly code: SourceIntakeFailureCode;
  readonly params?: Readonly<{ limit: number }>;

  constructor(
    message: string,
    status = 400,
    code: SourceIntakeFailureCode = 'invalid_request',
    params?: Readonly<{ limit: number }>,
  ) {
    super(message);
    this.name = 'SourceIntakeRequestError';
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

export type SourceIntakeFailureCode =
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
  | 'text_too_long';

export type ParsedSourceEntry = {
  readonly input: SourceInput;
};

export type ParsedSourceIntake = {
  readonly destination: SourceIntakeDestination;
  readonly purpose: SourcePurpose;
  readonly entries: readonly ParsedSourceEntry[];
  readonly selections: readonly (SourceAdapterRef | undefined)[];
};

/** Parse the stable command identity required by source-intake execution. */
export function parseSourceIntakeIdempotencyKey(req: Request): string {
  const value = req.headers.get('idempotency-key')?.trim() ?? '';
  if (!isCanonicalUuid(value)) {
    throw new SourceIntakeRequestError(
      'A valid Idempotency-Key header is required.',
      400,
      'invalid_idempotency_key',
    );
  }
  return value;
}

/** Parse and bound one source-intake multipart request. */
export async function parseSourceIntakeRequest(req: Request): Promise<ParsedSourceIntake> {
  let form: FormData;
  try {
    form = await parseBoundedMultipartFormData(req, {
      maxBytes: MAX_SOURCE_REQUEST_BYTES,
    });
  } catch (cause: unknown) {
    if (cause instanceof BoundedMultipartError) {
      if (cause.code === 'payload_too_large') {
        throw new SourceIntakeRequestError(
          `The complete source request must be ${
            formatSourceByteLimit(MAX_SOURCE_REQUEST_BYTES)
          } or smaller.`,
          413,
          'payload_too_large',
          { limit: MAX_SOURCE_REQUEST_BYTES },
        );
      }
      if (cause.code === 'unsupported_media_type') {
        throw new SourceIntakeRequestError(
          'Expected a multipart source-intake request.',
          415,
          'unsupported_media_type',
        );
      }
    }
    throw new SourceIntakeRequestError(
      'Unable to read the source payload.',
      400,
      'invalid_request',
    );
  }

  const purpose = parsePurpose(form.get('purpose'));
  const destination = parseDestination(form);
  const purposeError = migrationPurposeError(destination, purpose);
  if (purposeError) throw new SourceIntakeRequestError(purposeError);
  const files = parseFiles(form.getAll('files'));
  const pastedText = parsePastedText(form.get('text'));

  if (files.length && pastedText) {
    throw new SourceIntakeRequestError(
      'Choose files or pasted text, not both.',
      400,
      'invalid_request',
    );
  }
  if (!files.length && !pastedText) {
    throw new SourceIntakeRequestError(
      'Add at least one file or paste source text.',
      400,
      'missing_source',
    );
  }
  if (files.length > MAX_SOURCE_FILES) {
    throw new SourceIntakeRequestError(
      `Add no more than ${MAX_SOURCE_FILES} files at a time.`,
      400,
      'too_many_files',
      { limit: MAX_SOURCE_FILES },
    );
  }
  if (purpose === 'generate_new' && files.length > 1) {
    throw new SourceIntakeRequestError(
      'Generate from source accepts one file at a time.',
      400,
      'invalid_request',
    );
  }
  const totalFileBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalFileBytes > MAX_SOURCE_BATCH_BYTES) {
    throw new SourceIntakeRequestError(
      `The files in one recovery batch must total ${
        formatSourceByteLimit(MAX_SOURCE_BATCH_BYTES)
      } or less.`,
      413,
      'source_too_large',
      { limit: MAX_SOURCE_BATCH_BYTES },
    );
  }
  if (pastedText.length > MAX_SOURCE_TEXT_CHARS) {
    throw new SourceIntakeRequestError(
      `Pasted text must be ${MAX_SOURCE_TEXT_CHARS.toLocaleString()} characters or fewer.`,
      413,
      'text_too_long',
      { limit: MAX_SOURCE_TEXT_CHARS },
    );
  }

  const entries: ParsedSourceEntry[] = [];
  for (const file of files) {
    const maxBytes = purpose === 'generate_new' ? MAX_GENERATION_FILE_BYTES : MAX_SOURCE_FILE_BYTES;
    if (file.size > maxBytes) {
      throw new SourceIntakeRequestError(
        `${file.name} must be ${formatSourceByteLimit(maxBytes)} or smaller.`,
        413,
        'source_too_large',
        { limit: maxBytes },
      );
    }
    const source: ImportSource = {
      filename: file.name,
      mime: file.type || undefined,
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
    entries.push({ input: { _tag: 'file', source } });
  }
  if (pastedText) entries.push({ input: { _tag: 'paste', text: pastedText } });

  return {
    destination,
    purpose,
    entries,
    selections: entries.map((_, index) => parseAdapterRef(form.get(`adapter-${index}`))),
  };
}

/** Convert an inspected source back to the migration import boundary. */
export function toImportSource(entry: ParsedSourceEntry): ImportSource {
  if (entry.input._tag === 'file') return entry.input.source;
  return {
    filename: 'pasted-text.txt',
    mime: 'text/plain',
    bytes: new TextEncoder().encode(entry.input.text),
  };
}

function parsePurpose(value: FormDataEntryValue | null): SourcePurpose {
  if (value === 'recover_existing' || value === 'generate_new') return value;
  throw new SourceIntakeRequestError(
    'Choose Recover existing questions or Generate from source.',
    400,
    'invalid_purpose',
  );
}

function parseAdapterRef(value: FormDataEntryValue | null): SourceAdapterRef | undefined {
  if (value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new SourceIntakeRequestError('Invalid source adapter selection.', 400, 'invalid_adapter');
  }
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator === value.length - 1) {
    throw new SourceIntakeRequestError('Invalid source adapter selection.', 400, 'invalid_adapter');
  }
  return {
    id: value.slice(0, separator),
    version: value.slice(separator + 1),
  };
}

function parseFiles(values: FormDataEntryValue[]): File[] {
  const files: File[] = [];
  for (const value of values) {
    if (!(value instanceof File)) {
      throw new SourceIntakeRequestError(
        'Every source file entry must be a file.',
        400,
        'invalid_file',
      );
    }
    if (!value.name && value.size === 0) continue;
    if (!value.name.trim() || value.size === 0) {
      throw new SourceIntakeRequestError(
        'Source files must have a name and contain data.',
        400,
        'invalid_file',
      );
    }
    files.push(value);
  }
  return files;
}

function parsePastedText(value: FormDataEntryValue | null): string {
  if (value === null) return '';
  if (typeof value !== 'string') {
    throw new SourceIntakeRequestError('Pasted source text must be text.', 400, 'invalid_request');
  }
  return value.trim();
}

function parseDestination(form: FormData): SourceIntakeDestination {
  if (form.getAll('destination').length !== 1 || form.getAll('collectionId').length > 1) {
    throw new SourceIntakeRequestError('Choose one explicit import destination.');
  }
  const value = form.get('destination');
  const collectionId = form.get('collectionId');
  if (value === 'Assessment' && collectionId === null) return { _tag: 'Assessment' };
  if (value === 'WorkspaceBank' && (collectionId === null || isCanonicalUuid(collectionId))) {
    return { _tag: 'WorkspaceBank', collectionId };
  }
  throw new SourceIntakeRequestError('Invalid import destination.');
}
