import type { I18n } from '../i18n/messages.ts';

export type HumanErrorCode =
  | 'workspace_mismatch'
  | 'membership_required'
  | 'forbidden'
  | 'not_found'
  | 'restore_before_editing'
  | 'invalid_authoring_data'
  | 'internal_server_error'
  | 'gone';

const MESSAGE_IDS: Readonly<Record<HumanErrorCode, string>> = {
  workspace_mismatch: 'core.errors.workspaceMismatch',
  membership_required: 'core.errors.membershipRequired',
  forbidden: 'core.errors.forbidden',
  not_found: 'core.errors.notFound',
  restore_before_editing: 'core.errors.restoreBeforeEditing',
  invalid_authoring_data: 'core.errors.invalidAuthoringData',
  internal_server_error: 'core.errors.internalServerError',
  gone: 'core.errors.gone',
};

/** Return a localized human response using the request-scoped translator. */
export function requestErrorResponse(
  i18n: I18n,
  code: HumanErrorCode,
  status: number,
): Response {
  return new Response(i18n.t(MESSAGE_IDS[code]), {
    status,
  });
}
