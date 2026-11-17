import { parsePersistedDraft, type PersistedDraft } from './persisted_draft.ts';
import { isQuestionTypeId } from './types/registry.ts';
import { isCanonicalUuid } from './uuid.ts';

export type DraftRequestErrorCode =
  | 'invalid_request'
  | 'invalid_draft'
  | 'invalid_revision'
  | 'invalid_session';

export type DraftRequestError = {
  readonly code: DraftRequestErrorCode;
  readonly message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Parses one draft object from a persistence boundary. */
export function parseDraftBody(record: unknown): PersistedDraft | DraftRequestError {
  if (!isRecord(record)) {
    return { code: 'invalid_draft', message: 'The draft is invalid.' };
  }
  const type = record.type;
  if (!isQuestionTypeId(type)) {
    return { code: 'invalid_draft', message: 'The draft type is not supported.' };
  }
  try {
    return parsePersistedDraft(record, type);
  } catch (cause: unknown) {
    return {
      code: 'invalid_draft',
      message: cause instanceof Error ? cause.message : 'The draft is invalid.',
    };
  }
}

export type RevisionPublishRequest = {
  readonly sourceRevisionId: string;
  readonly draft: PersistedDraft;
};

/** Parses POST /api/drafts/:id/publish. */
export function parseRevisionPublishRequest(
  input: unknown,
): RevisionPublishRequest | DraftRequestError {
  if (!isRecord(input) || !hasExactKeys(input, ['sourceRevisionId', 'draft'])) {
    return { code: 'invalid_request', message: 'The publication request is invalid.' };
  }
  if (typeof input.sourceRevisionId !== 'string' || !isCanonicalUuid(input.sourceRevisionId)) {
    return { code: 'invalid_revision', message: 'The source revision is invalid.' };
  }
  const draft = parseDraftBody(input.draft);
  if (!('type' in draft)) return draft;
  return { sourceRevisionId: input.sourceRevisionId, draft };
}

export function draftRequestJson(
  error: DraftRequestError,
  status = 400,
  issues: readonly { field: string; message: string }[] = [],
): Response {
  return Response.json({
    error: error.code,
    message: error.message,
    issues,
  }, { status });
}

/** Parse publication of a new bank draft; its destination and identity come from the session. */
export function parseBankDraftPublishRequest(
  input: unknown,
): { readonly draft: PersistedDraft } | DraftRequestError {
  if (!isRecord(input) || !hasExactKeys(input, ['draft'])) {
    return { code: 'invalid_request', message: 'The publication request is invalid.' };
  }
  const draft = parseDraftBody(input.draft);
  return 'type' in draft ? { draft } : draft;
}
