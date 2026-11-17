import { isCanonicalUuid } from './uuid.ts';
import { parseAuthoringSettingsPatch } from './authoring_preferences.ts';
import type { SaveAssessmentQuestionCommand } from './services/assessment_question_authoring.ts';
import type { Draft } from './types/draft.ts';
import { isQuestionTypeId } from './types/registry.ts';

type ParseCommandResult =
  | { readonly ok: true; readonly command: SaveAssessmentQuestionCommand }
  | { readonly ok: false; readonly message: string };

/** Parse the single HTTP contract for assessment question creation, revision and adjacent copies. */
export function parseAssessmentQuestionCommand(input: unknown): ParseCommandResult {
  if (!isRecord(input)) return { ok: false, message: 'Request body must be an object.' };
  if (
    input.operation !== 'create' && input.operation !== 'revise' && input.operation !== 'variant'
  ) {
    return { ok: false, message: 'operation must be create, revise, or variant.' };
  }
  const rememberedSettings = input.rememberedSettings === undefined
    ? undefined
    : isRecord(input.draft) && isQuestionTypeId(input.draft.type)
    ? parseAuthoringSettingsPatch(input.draft.type, input.rememberedSettings)
    : null;
  if (rememberedSettings === null) return { ok: false, message: 'Invalid remembered settings.' };
  if (input.operation === 'create') {
    if (
      !hasOnlyKeys(input, [
        'operation',
        'partId',
        'draft',
        'blueprintTargetId',
        'beforePlacementId',
        'rememberedSettings',
      ])
    ) {
      return { ok: false, message: 'Create request contains unsupported fields.' };
    }
    const beforePlacementId = parseOptionalNonEmptyString(input.beforePlacementId);
    if (
      beforePlacementId === null ||
      (beforePlacementId !== undefined && !isCanonicalUuid(beforePlacementId))
    ) return { ok: false, message: 'beforePlacementId must be a canonical UUID.' };
    const draft = parseDraft(input.draft);
    if (!draft) return { ok: false, message: 'draft must contain a supported question type.' };
    if (!isCanonicalUuid(input.partId)) {
      return { ok: false, message: 'partId must be a canonical UUID when creating a question.' };
    }
    const blueprintTargetId = parseOptionalNonEmptyString(input.blueprintTargetId);
    if (blueprintTargetId === null) {
      return { ok: false, message: 'blueprintTargetId must be a non-empty string.' };
    }
    return {
      ok: true,
      command: {
        _tag: 'Create',
        beforePlacementId,
        partId: input.partId,
        draft,
        rememberedSettings,
        ...(blueprintTargetId === undefined ? {} : { blueprintTargetId }),
      },
    };
  }
  if (input.operation === 'variant') {
    if (
      !hasOnlyKeys(input, [
        'operation',
        'requestId',
        'partId',
        'sourcePlacementId',
        'sourceItemId',
        'sourceRevision',
        'targetType',
        'blueprintTargetId',
      ])
    ) {
      return { ok: false, message: 'Variant request contains unsupported fields.' };
    }
    const targetType = input.targetType;
    const blueprintTargetId = parseOptionalNonEmptyString(input.blueprintTargetId);
    if (
      !isCanonicalUuid(input.requestId) || !isCanonicalUuid(input.partId) ||
      !isCanonicalUuid(input.sourceItemId) ||
      !isCanonicalUuid(input.sourcePlacementId) ||
      typeof input.sourceRevision !== 'number' || !Number.isInteger(input.sourceRevision) ||
      input.sourceRevision < 1 || !isQuestionTypeId(targetType) || blueprintTargetId === null
    ) {
      return {
        ok: false,
        message:
          'requestId, partId, sourcePlacementId, sourceItemId, a positive sourceRevision, and a supported targetType are required for a variant.',
      };
    }
    return {
      ok: true,
      command: {
        _tag: 'Variant',
        requestId: input.requestId,
        partId: input.partId,
        sourcePlacementId: input.sourcePlacementId,
        sourceItemId: input.sourceItemId,
        sourceRevision: input.sourceRevision,
        targetType,
        ...(blueprintTargetId === undefined ? {} : { blueprintTargetId }),
      },
    };
  }
  if (
    !hasOnlyKeys(input, [
      'operation',
      'placementId',
      'itemId',
      'expectedParentRevision',
      'draft',
      'blueprintTargetId',
      'rememberedSettings',
    ])
  ) {
    return { ok: false, message: 'Revise request contains unsupported fields.' };
  }
  if (!isCanonicalUuid(input.placementId) || !isCanonicalUuid(input.itemId)) {
    return { ok: false, message: 'placementId and itemId must be canonical UUIDs when revising.' };
  }
  if (
    typeof input.expectedParentRevision !== 'number' ||
    !Number.isSafeInteger(input.expectedParentRevision) || input.expectedParentRevision < 1
  ) return { ok: false, message: 'expectedParentRevision must be a positive safe integer.' };
  const draft = parseDraft(input.draft);
  if (!draft) return { ok: false, message: 'draft must contain a supported question type.' };
  const blueprintTargetId = parseOptionalNonEmptyString(input.blueprintTargetId);
  if (blueprintTargetId === null) {
    return { ok: false, message: 'blueprintTargetId must be a non-empty string.' };
  }
  return {
    ok: true,
    command: {
      _tag: 'Revise',
      expectedParentRevision: input.expectedParentRevision,
      placementId: input.placementId,
      itemId: input.itemId,
      draft,
      rememberedSettings,
      ...(blueprintTargetId === undefined ? {} : { blueprintTargetId }),
    },
  };
}

function parseOptionalNonEmptyString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function parseDraft(input: unknown): Draft | null {
  if (!isRecord(input) || !isQuestionTypeId(input.type)) {
    return null;
  }
  // SAFETY: Draft is the permissive authoring DTO; the selected driver hydrates and validates
  // every type-specific field before the service persists it.
  return input as Draft;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(input).every((key) => allowedKeys.has(key));
}
