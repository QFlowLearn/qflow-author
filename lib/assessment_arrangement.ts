import { parseAssessmentBlueprintId } from './assessment_blueprint.ts';
import type { PartOptions } from './test_export.ts';
import { parseCanonicalUuid } from './uuid.ts';
import type { AssessmentCanvasMove } from './assessment_canvas_move.ts';
import {
  type AssessmentContentPlacement,
  parseAssessmentStandaloneContent,
} from './assessment_standalone_content.ts';

const MAX_PARTS = 100;
const MAX_PLACEMENTS = 500;
const MAX_FEEDBACK_BLOCKS = 20;
const MAX_TITLE_LENGTH = 500;
const MAX_HTML_LENGTH = 100_000;
const MAX_OUTCOME_IDENTIFIER_LENGTH = 128;
const MAX_TIME_LIMIT_SECONDS = 31_536_000;

/** Strict assessment-arrangement command accepted by the HTTP boundary. */
export type AssessmentArrangeRequest = {
  readonly expectedVersion: string;
  readonly parts: readonly ParsedAssessmentPart[];
  readonly canvasMove?: AssessmentCanvasMove;
};

/** User-correctable assessment-arrangement request failure. */
export type InvalidAssessmentArrangeRequest = {
  readonly _tag: 'InvalidAssessmentArrangeRequest';
  readonly message: string;
};

/** Typed outcome of decoding and parsing one arrangement request. */
export type AssessmentArrangeRequestParseResult =
  | { readonly ok: true; readonly request: AssessmentArrangeRequest }
  | { readonly ok: false; readonly error: InvalidAssessmentArrangeRequest };

type ParsedAssessmentPart = {
  readonly id: string;
  readonly title: string;
  readonly options?: PartOptions;
  readonly placements: readonly ParsedAssessmentPlacement[];
};

type ParsedAssessmentPlacement = AssessmentContentPlacement | {
  readonly id: string;
  readonly itemId: string;
  readonly snapshotRev: number | null;
  readonly blueprintTargetId: string | null;
  readonly fixed: boolean;
};

/** Parse one complete arrangement command without coupling its contract to HTTP. */
export function parseAssessmentArrangeRequest(value: unknown): AssessmentArrangeRequestParseResult {
  try {
    return { ok: true, request: parseArrangeRequest(value) };
  } catch (cause: unknown) {
    if (cause instanceof ArrangeRequestParseFailure) return invalid(cause.message);
    throw cause;
  }
}

/** Parse saved part settings through the same schema used when saving arrangements. */
export function parseAssessmentPartOptions(value: unknown):
  | { readonly ok: true; readonly options: PartOptions }
  | { readonly ok: false; readonly error: InvalidAssessmentArrangeRequest } {
  try {
    return { ok: true, options: parsePartOptions(value, 0, new Set<string>()) };
  } catch (cause: unknown) {
    if (cause instanceof ArrangeRequestParseFailure) return invalid(cause.message);
    throw cause;
  }
}

function parseArrangeRequest(value: unknown): AssessmentArrangeRequest {
  const record = parseRecord(value, 'Request body must be an object.');
  assertExactKeys(
    record,
    ['parts', 'expectedVersion', 'canvasMove'],
    ['parts', 'expectedVersion'],
    'request body',
  );
  if (
    typeof record.expectedVersion !== 'string' || !/^[0-9a-f]{64}$/.test(record.expectedVersion)
  ) {
    parseFailure('Expected arrangement version must be a SHA-256 digest.');
  }
  if (!Array.isArray(record.parts) || record.parts.length === 0) {
    parseFailure('At least one assessment part is required.');
  }
  if (record.parts.length > MAX_PARTS) {
    parseFailure(`Assessment cannot contain more than ${MAX_PARTS} parts.`);
  }

  const partIds = new Set<string>();
  const placementIds = new Set<string>();
  const feedbackIds = new Set<string>();
  let placementCount = 0;
  const parts = record.parts.map((part, index) => {
    const parsed = parsePart(part, index, placementIds, feedbackIds);
    if (partIds.has(parsed.id)) parseFailure('Assessment part IDs must be unique.');
    partIds.add(parsed.id);
    placementCount += parsed.placements?.length ?? 0;
    if (placementCount > MAX_PLACEMENTS) {
      parseFailure(`Assessment cannot contain more than ${MAX_PLACEMENTS} placements.`);
    }
    return parsed;
  });
  const canvasMove = Object.hasOwn(record, 'canvasMove')
    ? parseCanvasMove(record.canvasMove)
    : undefined;
  return { expectedVersion: record.expectedVersion, parts, ...(canvasMove ? { canvasMove } : {}) };
}

function parseCanvasMove(value: unknown): AssessmentCanvasMove {
  const record = parseRecord(value, 'Canvas move must be an object.');
  assertExactKeys(record, ['partId', 'placementId', 'position'], [
    'partId',
    'placementId',
    'position',
  ], 'canvas move');
  const partId = parseUuid(record.partId, 'Canvas move part ID must be a UUID.');
  const placementId = parseUuid(record.placementId, 'Canvas move placement ID must be a UUID.');
  if (
    typeof record.position !== 'number' || !Number.isSafeInteger(record.position) ||
    record.position < 0 || record.position >= MAX_PLACEMENTS
  ) {
    parseFailure('Canvas move position is invalid.');
  }
  return { partId, placementId, position: record.position };
}

function parsePart(
  value: unknown,
  index: number,
  placementIds: Set<string>,
  feedbackIds: Set<string>,
): ParsedAssessmentPart {
  const label = `assessment part ${index + 1}`;
  const record = parseRecord(value, `${capitalize(label)} must be an object.`);
  assertExactKeys(record, ['id', 'title', 'placements', 'options'], [
    'id',
    'title',
    'placements',
  ], label);
  const id = parseUuid(record.id, `${capitalize(label)} ID must be a UUID.`);
  const title = parseBoundedString(
    record.title,
    1,
    MAX_TITLE_LENGTH,
    `${capitalize(label)} title is required and cannot exceed ${MAX_TITLE_LENGTH} characters.`,
  );
  if (!Array.isArray(record.placements)) {
    parseFailure(`${capitalize(label)} placements must be an array.`);
  }
  if (record.placements.length > MAX_PLACEMENTS) {
    parseFailure(`Assessment cannot contain more than ${MAX_PLACEMENTS} placements.`);
  }
  const placements = record.placements.map((placement, placementIndex) => {
    const parsed = parsePlacement(placement, index, placementIndex);
    if (placementIds.has(parsed.id)) {
      parseFailure('Assessment placement IDs must be unique.');
    }
    placementIds.add(parsed.id);
    return parsed;
  });
  const options = Object.hasOwn(record, 'options')
    ? parsePartOptions(record.options, index, feedbackIds)
    : undefined;
  if (options?.shuffleQuestions && placements.some((placement) => 'content' in placement)) {
    parseFailure('Standalone content blocks require authored question order.');
  }
  return {
    id,
    title,
    placements,
    ...(options === undefined ? {} : { options }),
  };
}

function parsePlacement(
  value: unknown,
  partIndex: number,
  placementIndex: number,
): ParsedAssessmentPlacement {
  const label = `placement ${placementIndex + 1} in assessment part ${partIndex + 1}`;
  const record = parseRecord(value, `${capitalize(label)} must be an object.`);
  if (Object.hasOwn(record, 'content')) {
    assertExactKeys(record, ['id', 'content', 'fixed'], ['id', 'content', 'fixed'], label);
    const id = parseUuid(record.id, `${capitalize(label)} ID must be a UUID.`);
    const parsed = parseAssessmentStandaloneContent(record.content);
    if (!parsed.ok || record.fixed !== true) {
      parseFailure(
        `${capitalize(label)} must contain valid content and retain its authored position.`,
      );
    }
    return { id, content: parsed.content, fixed: true };
  }
  assertExactKeys(
    record,
    ['id', 'itemId', 'snapshotRev', 'blueprintTargetId', 'fixed'],
    ['id', 'itemId'],
    label,
  );
  const id = parseUuid(record.id, `${capitalize(label)} ID must be a UUID.`);
  const itemId = parseUuid(
    record.itemId,
    `${capitalize(label)} question ID must be a UUID.`,
  );
  let snapshotRev: number | null = null;
  if (Object.hasOwn(record, 'snapshotRev')) {
    if (
      typeof record.snapshotRev !== 'number' || !Number.isSafeInteger(record.snapshotRev) ||
      record.snapshotRev < 1
    ) {
      parseFailure(`${capitalize(label)} revision must be a positive integer.`);
    }
    snapshotRev = record.snapshotRev;
  }
  let blueprintTargetId: string | null = null;
  if (Object.hasOwn(record, 'blueprintTargetId')) {
    const parsed = parseAssessmentBlueprintId(record.blueprintTargetId);
    if (!parsed) {
      parseFailure(`${capitalize(label)} blueprint target ID is invalid.`);
    }
    blueprintTargetId = parsed;
  }
  if (Object.hasOwn(record, 'fixed') && typeof record.fixed !== 'boolean') {
    parseFailure(`${capitalize(label)} fixed-position setting must be a boolean.`);
  }
  // An omitted flag explicitly requests an ordinary, unfixed placement in this full replacement.
  return { id, itemId, snapshotRev, blueprintTargetId, fixed: record.fixed === true };
}

function parsePartOptions(
  value: unknown,
  partIndex: number,
  feedbackIds: Set<string>,
): PartOptions {
  const label = `assessment part ${partIndex + 1} options`;
  const record = parseRecord(value, `${capitalize(label)} must be an object.`);
  assertExactKeys(
    record,
    [
      'navigationMode',
      'submissionMode',
      'timeLimits',
      'instructionsHtml',
      'feedback',
      'shuffleQuestions',
      'answerFeedbackRelease',
    ],
    [],
    label,
  );
  const options: PartOptions = {};
  if (Object.hasOwn(record, 'answerFeedbackRelease')) {
    if (
      record.answerFeedbackRelease !== 'after-submit' && record.answerFeedbackRelease !== 'never'
    ) parseFailure('Answer feedback release is invalid.');
    options.answerFeedbackRelease = record.answerFeedbackRelease;
  }
  if (Object.hasOwn(record, 'shuffleQuestions')) {
    if (typeof record.shuffleQuestions !== 'boolean') {
      parseFailure(`${capitalize(label)} question-shuffle setting must be a boolean.`);
    }
    options.shuffleQuestions = record.shuffleQuestions;
  }
  if (Object.hasOwn(record, 'navigationMode')) {
    if (record.navigationMode !== 'linear' && record.navigationMode !== 'nonlinear') {
      parseFailure(`${capitalize(label)} navigation mode is invalid.`);
    }
    options.navigationMode = record.navigationMode;
  }
  if (Object.hasOwn(record, 'submissionMode')) {
    if (record.submissionMode !== 'individual' && record.submissionMode !== 'simultaneous') {
      parseFailure(`${capitalize(label)} submission mode is invalid.`);
    }
    options.submissionMode = record.submissionMode;
  }
  if (Object.hasOwn(record, 'timeLimits')) {
    options.timeLimits = parseTimeLimits(record.timeLimits, partIndex);
  }
  if (Object.hasOwn(record, 'instructionsHtml')) {
    options.instructionsHtml = parseBoundedString(
      record.instructionsHtml,
      0,
      MAX_HTML_LENGTH,
      `${
        capitalize(label)
      } instructions must be a string no longer than ${MAX_HTML_LENGTH} characters.`,
      false,
    );
  }
  if (Object.hasOwn(record, 'feedback')) {
    if (!Array.isArray(record.feedback)) {
      parseFailure(`${capitalize(label)} feedback must be an array.`);
    }
    if (record.feedback.length > MAX_FEEDBACK_BLOCKS) {
      parseFailure(
        `${capitalize(label)} cannot contain more than ${MAX_FEEDBACK_BLOCKS} feedback blocks.`,
      );
    }
    options.feedback = record.feedback.map((feedback, feedbackIndex) => {
      const parsed = parseFeedback(feedback, partIndex, feedbackIndex);
      if (feedbackIds.has(parsed.id)) parseFailure('Feedback IDs must be unique.');
      feedbackIds.add(parsed.id);
      return parsed;
    });
  }
  return options;
}

function parseTimeLimits(
  value: unknown,
  partIndex: number,
): NonNullable<PartOptions['timeLimits']> {
  const label = `assessment part ${partIndex + 1} time limits`;
  const record = parseRecord(value, `${capitalize(label)} must be an object.`);
  assertExactKeys(record, ['minTime', 'maxTime'], [], label);
  const minTime = Object.hasOwn(record, 'minTime')
    ? parseTimeLimit(record.minTime, `${capitalize(label)} minimum`)
    : undefined;
  const maxTime = Object.hasOwn(record, 'maxTime')
    ? parseTimeLimit(record.maxTime, `${capitalize(label)} maximum`)
    : undefined;
  if (minTime !== undefined && maxTime !== undefined && minTime > maxTime) {
    parseFailure(`${capitalize(label)} minimum cannot exceed the maximum.`);
  }
  return {
    ...(minTime === undefined ? {} : { minTime }),
    ...(maxTime === undefined ? {} : { maxTime }),
  };
}

function parseFeedback(
  value: unknown,
  partIndex: number,
  feedbackIndex: number,
): NonNullable<PartOptions['feedback']>[number] {
  const label = `feedback ${feedbackIndex + 1} in assessment part ${partIndex + 1}`;
  const record = parseRecord(value, `${capitalize(label)} must be an object.`);
  assertExactKeys(
    record,
    ['id', 'access', 'showHide', 'outcomeIdentifier', 'html'],
    ['id', 'access', 'showHide', 'outcomeIdentifier', 'html'],
    label,
  );
  const id = parseUuid(record.id, `${capitalize(label)} ID must be a UUID.`);
  if (record.access !== 'during' && record.access !== 'atEnd') {
    parseFailure(`${capitalize(label)} access is invalid.`);
  }
  if (record.showHide !== 'show' && record.showHide !== 'hide') {
    parseFailure(`${capitalize(label)} visibility is invalid.`);
  }
  const outcomeIdentifier = parseBoundedString(
    record.outcomeIdentifier,
    0,
    MAX_OUTCOME_IDENTIFIER_LENGTH,
    `${
      capitalize(label)
    } outcome identifier must be a string no longer than ${MAX_OUTCOME_IDENTIFIER_LENGTH} characters.`,
    false,
  );
  const html = parseBoundedString(
    record.html,
    0,
    MAX_HTML_LENGTH,
    `${capitalize(label)} HTML must be a string no longer than ${MAX_HTML_LENGTH} characters.`,
    false,
  );
  return { id, access: record.access, showHide: record.showHide, outcomeIdentifier, html };
}

function parseTimeLimit(value: unknown, label: string): number {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 ||
    value > MAX_TIME_LIMIT_SECONDS
  ) {
    parseFailure(
      `${label} must be a whole number from 0 to ${MAX_TIME_LIMIT_SECONDS} seconds.`,
    );
  }
  return value;
}

function parseBoundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
  message: string,
  trim = true,
): string {
  if (typeof value !== 'string') parseFailure(message);
  const parsed = trim ? value.trim() : value;
  if (parsed.length < minLength || parsed.length > maxLength) parseFailure(message);
  return parsed;
}

function parseUuid(value: unknown, message: string): string {
  const parsed = parseCanonicalUuid(value);
  if (!parsed) parseFailure(message);
  return parsed;
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) parseFailure(message);
  // SAFETY: the object shape is established above; every owned field is parsed below.
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  const missing = requiredKeys.filter((key) => !Object.hasOwn(record, key));
  if (unknown.length === 0 && missing.length === 0) return;
  parseFailure(
    `Invalid ${label}. Missing: ${missing.join(', ') || 'none'}; unknown: ${
      unknown.join(', ') || 'none'
    }.`,
  );
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function invalid(message: string): {
  readonly ok: false;
  readonly error: InvalidAssessmentArrangeRequest;
} {
  return { ok: false, error: { _tag: 'InvalidAssessmentArrangeRequest', message } };
}

function parseFailure(message: string): never {
  throw new ArrangeRequestParseFailure(message);
}

class ArrangeRequestParseFailure extends Error {}
