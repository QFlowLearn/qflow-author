import {
  restoreQuestionRevision,
  type RestoreQuestionRevisionResult,
} from './question_revision_restoration.ts';
import {
  applyQuestionBankBulkCommand,
  type QuestionBankBulkCommand,
} from './question_bank_bulk.ts';
import {
  addQuestionReviewComment,
  decideQuestionReview,
  requestQuestionReview,
} from './question_reviews.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';

export type QuestionBankItemActionResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly message: string;
    readonly code?:
      | 'invalid_input'
      | 'command_rejected'
      | `restore:${Extract<RestoreQuestionRevisionResult, { ok: false }>['code']}`;
  };

declare const QUESTION_BANK_ITEM_ID: unique symbol;

/** UUID refined for one item-bank route or command boundary. */
export type QuestionBankItemId = string & { readonly [QUESTION_BANK_ITEM_ID]: true };

/** Parses one item-bank route identifier without allowing database UUID errors. */
export function parseQuestionBankItemId(value: unknown): QuestionBankItemId | null {
  if (!isCanonicalUuid(value)) return null;
  // SAFETY: isCanonicalUuid established the route identifier invariant before branding.
  return value as QuestionBankItemId;
}

/** Dispatches one item detail POST action to the matching bank or review command. */
export async function dispatchQuestionBankItemAction(
  auth: RequestContext,
  questionId: string,
  form: FormData,
): Promise<QuestionBankItemActionResult> {
  const itemId = parseQuestionBankItemId(questionId);
  if (!itemId) return { ok: false, message: 'Item not found.', code: 'invalid_input' };
  const parsed = parseQuestionBankItemActionForm(form);
  if (!parsed.ok) return { ...parsed, code: 'invalid_input' };
  const command = parsed.command;
  switch (command._tag) {
    case 'RequestReview': {
      const result = await requestQuestionReview(
        auth,
        itemId,
        command.reviewerUserId,
        command.changeReason,
      );
      return result.ok
        ? { ok: true }
        : { ok: false, message: result.message, code: 'command_rejected' };
    }
    case 'Comment': {
      const result = await addQuestionReviewComment(
        auth,
        itemId,
        command.requestId,
        command.comment,
      );
      return result.ok
        ? { ok: true }
        : { ok: false, message: result.message, code: 'command_rejected' };
    }
    case 'Decide': {
      const result = await decideQuestionReview(
        auth,
        itemId,
        command.requestId,
        command.decision,
        command.decisionNote,
      );
      return result.ok
        ? { ok: true }
        : { ok: false, message: result.message, code: 'command_rejected' };
    }
    case 'RestoreRevision': {
      const result = await restoreQuestionRevision(
        auth,
        itemId,
        command.sourceRevision,
        command.expectedLatestRevisionId,
      );
      return result.ok ? { ok: true } : {
        ok: false,
        code: `restore:${result.code}`,
        message: result.code,
      };
    }
    case 'SetLifecycle': {
      const result = await applyQuestionBankBulkCommand(auth, {
        _tag: command.lifecycle === 'archived' ? 'Archive' : 'Restore',
        questionIds: [itemId],
      });
      return result.ok
        ? { ok: true }
        : { ok: false, message: result.message, code: 'command_rejected' };
    }
    case 'TransferOwnership': {
      const result = await applyQuestionBankBulkCommand(auth, {
        _tag: 'TransferOwnership',
        questionIds: [itemId],
        ownerUserId: command.ownerUserId,
      });
      return result.ok
        ? { ok: true }
        : { ok: false, message: result.message, code: 'command_rejected' };
    }
  }
}

type QuestionBankItemActionCommand =
  | {
    readonly _tag: 'RestoreRevision';
    readonly sourceRevision: number;
    readonly expectedLatestRevisionId: string;
  }
  | {
    readonly _tag: 'RequestReview';
    readonly reviewerUserId: string;
    readonly changeReason: string;
  }
  | { readonly _tag: 'Comment'; readonly requestId: string; readonly comment: string }
  | {
    readonly _tag: 'Decide';
    readonly requestId: string;
    readonly decision: 'approved' | 'changes_requested';
    readonly decisionNote: string;
  }
  | { readonly _tag: 'SetLifecycle'; readonly lifecycle: 'active' | 'archived' }
  | { readonly _tag: 'TransferOwnership'; readonly ownerUserId: string };

type ParseItemActionResult =
  | { readonly ok: true; readonly command: QuestionBankItemActionCommand }
  | { readonly ok: false; readonly message: string };

function parseQuestionBankItemActionForm(form: FormData): ParseItemActionResult {
  try {
    const action = requireSingleString(form, 'action');
    if (action === 'request_review') {
      requireExactFormKeys(form, ['action', 'reviewerUserId', 'changeReason']);
      return {
        ok: true,
        command: {
          _tag: 'RequestReview',
          changeReason: requireSingleString(form, 'changeReason'),
          reviewerUserId: requireUuid(form, 'reviewerUserId', 'Choose a workspace member.'),
        },
      };
    }
    if (action === 'comment') {
      requireExactFormKeys(form, ['action', 'requestId', 'comment']);
      return {
        ok: true,
        command: {
          _tag: 'Comment',
          requestId: requireUuid(form, 'requestId', 'Review request not found.'),
          comment: requireSingleString(form, 'comment'),
        },
      };
    }
    if (action === 'approve' || action === 'changes_requested') {
      requireExactFormKeys(form, ['action', 'requestId', 'decisionNote']);
      return {
        ok: true,
        command: {
          _tag: 'Decide',
          requestId: requireUuid(form, 'requestId', 'Review request not found.'),
          decision: action === 'approve' ? 'approved' : 'changes_requested',
          decisionNote: requireSingleString(form, 'decisionNote'),
        },
      };
    }
    if (action === 'archive' || action === 'restore') {
      requireExactFormKeys(form, ['action']);
      return {
        ok: true,
        command: {
          _tag: 'SetLifecycle',
          lifecycle: action === 'archive' ? 'archived' : 'active',
        },
      };
    }
    if (action === 'restore_revision') {
      requireExactFormKeys(form, ['action', 'sourceRevision', 'expectedLatestRevisionId']);
      const value = requireSingleString(form, 'sourceRevision');
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        return { ok: false, message: 'Choose a valid source revision.' };
      }
      return {
        ok: true,
        command: {
          _tag: 'RestoreRevision',
          sourceRevision: Number(value),
          expectedLatestRevisionId: requireUuid(
            form,
            'expectedLatestRevisionId',
            'Choose a current revision.',
          ),
        },
      };
    }
    if (action === 'transfer') {
      requireExactFormKeys(form, ['action', 'ownerUserId']);
      return {
        ok: true,
        command: {
          _tag: 'TransferOwnership',
          ownerUserId: requireUuid(form, 'ownerUserId', 'Choose a current workspace member.'),
        },
      };
    }
    return { ok: false, message: 'Choose an item action.' };
  } catch (cause: unknown) {
    if (cause instanceof QuestionBankBulkFormError) {
      return { ok: false, message: cause.message };
    }
    throw cause;
  }
}

/** Parses one item bank index bulk POST into a typed command. */
export function parseQuestionBankBulkForm(form: FormData): QuestionBankBulkCommand {
  requireAllowedFormKeys(form, [
    'bulkAction',
    'bulkTags',
    'ownerUserId',
    'questionId',
    'collectionId',
    'operationId',
  ]);
  const questionIds = form.getAll('questionId').map((value) => {
    if (!isCanonicalUuid(value)) {
      throw new QuestionBankBulkFormError('Select valid items.', 'invalid_selection');
    }
    return value;
  });
  const tagsInput = optionalSingleString(form, 'bulkTags');
  const ownerInput = optionalSingleString(form, 'ownerUserId');
  const action = requireSingleString(form, 'bulkAction');
  const collectionId = optionalSingleString(form, 'collectionId');
  const operationId = optionalSingleString(form, 'operationId');
  const tags = parseBulkTags(tagsInput);
  if (action !== 'add_tags' && action !== 'remove_tags' && tags.length > 0) {
    throw new QuestionBankBulkFormError('Tags apply only to tag actions.', 'tags_action_mismatch');
  }
  if (action !== 'transfer' && ownerInput) {
    throw new QuestionBankBulkFormError(
      'A new owner applies only to ownership transfer.',
      'owner_action_mismatch',
    );
  }
  if (action === 'add_to_collection' || action === 'remove_from_collection') {
    if (!isCanonicalUuid(collectionId) || !isCanonicalUuid(operationId)) {
      throw new QuestionBankBulkFormError(
        'Choose a collection and reload the form.',
        'invalid_action',
      );
    }
    return {
      _tag: action === 'add_to_collection' ? 'AddToCollection' : 'RemoveFromCollection',
      questionIds,
      collectionId,
      operationId,
    };
  }
  if (collectionId) {
    throw new QuestionBankBulkFormError(
      'Choose a filing action for a collection.',
      'invalid_action',
    );
  }
  if (action === 'add_tags') return { _tag: 'AddTags', questionIds, tags };
  if (action === 'remove_tags') return { _tag: 'RemoveTags', questionIds, tags };
  if (action === 'archive') return { _tag: 'Archive', questionIds };
  if (action === 'restore') return { _tag: 'Restore', questionIds };
  if (action === 'transfer') {
    if (!isCanonicalUuid(ownerInput)) {
      throw new QuestionBankBulkFormError('Choose a current workspace member.', 'invalid_owner');
    }
    return {
      _tag: 'TransferOwnership',
      questionIds,
      ownerUserId: ownerInput,
    };
  }
  throw new QuestionBankBulkFormError('Choose a bulk action.', 'invalid_action');
}

function parseBulkTags(value: string): string[] {
  if (!value.trim()) return [];
  const tags = [...new Set(value.split(',').map((tag) => tag.trim().toLowerCase()))];
  if (tags.some((tag) => tag.length < 1 || tag.length > 80)) {
    throw new QuestionBankBulkFormError(
      'Each tag must contain between 1 and 80 characters.',
      'invalid_tags',
    );
  }
  if (tags.length > 20) {
    throw new QuestionBankBulkFormError('Enter no more than 20 tags.', 'invalid_tags');
  }
  return tags.sort();
}

function requireUuid(form: FormData, name: string, message: string): string {
  const value = requireSingleString(form, name);
  if (!isCanonicalUuid(value)) throw new QuestionBankBulkFormError(message, 'invalid_owner');
  return value;
}

function requireSingleString(form: FormData, name: string): string {
  const values = form.getAll(name);
  if (values.length === 0) {
    throw new QuestionBankBulkFormError(
      'Complete all fields for this item action.',
      'missing_field',
    );
  }
  if (values.length !== 1 || typeof values[0] !== 'string') {
    throw new QuestionBankBulkFormError(
      'Enter each item-bank field once. File uploads are not supported.',
      'invalid_field_shape',
    );
  }
  return values[0];
}

function optionalSingleString(form: FormData, name: string): string {
  const values = form.getAll(name);
  if (values.length === 0) return '';
  if (values.length !== 1 || typeof values[0] !== 'string') {
    throw new QuestionBankBulkFormError(
      'Enter each item-bank field once. File uploads are not supported.',
      'invalid_field_shape',
    );
  }
  return values[0];
}

function requireExactFormKeys(form: FormData, expected: readonly string[]): void {
  requireAllowedFormKeys(form, expected);
  const actual = new Set(form.keys());
  if (expected.some((key) => !actual.has(key))) {
    throw new QuestionBankBulkFormError(
      'Complete all fields for this item action.',
      'missing_field',
    );
  }
}

function requireAllowedFormKeys(form: FormData, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of form.keys()) {
    if (!allowed.has(key)) {
      throw new QuestionBankBulkFormError(
        'Item-bank form contains unsupported fields.',
        'unsupported_fields',
      );
    }
  }
}

export type QuestionBankBulkFormErrorCode =
  | 'invalid_selection'
  | 'invalid_tags'
  | 'tags_action_mismatch'
  | 'owner_action_mismatch'
  | 'invalid_owner'
  | 'invalid_field_shape'
  | 'invalid_action'
  | 'unsupported_fields'
  | 'missing_field';

export class QuestionBankBulkFormError extends Error {
  constructor(
    message: string,
    readonly code: QuestionBankBulkFormErrorCode,
  ) {
    super(message);
    this.name = 'QuestionBankBulkFormError';
  }
}
