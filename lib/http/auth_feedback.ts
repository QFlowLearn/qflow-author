/** Closed error codes accepted by the public sign-in page. */
export type LoginErrorCode =
  | 'account_creation_failed'
  | 'account_workspace_mismatch'
  | 'authorization_failed'
  | 'email_invalid'
  | 'email_required'
  | 'identity_conflict'
  | 'identity_verification_failed'
  | 'login_state_expired'
  | 'missing_authorization_response'
  | 'provider_not_configured'
  | 'sign_in_unavailable'
  | 'token_exchange_failed'
  | 'workspace_mismatch';

/** Map a client-controlled query value to fixed first-party sign-in copy. */
export function loginErrorMessage(input: string | null): LoginErrorCode | null {
  switch (input) {
    case 'account_creation_failed':
      return 'account_creation_failed';
    case 'account_workspace_mismatch':
      return 'account_workspace_mismatch';
    case 'authorization_failed':
      return 'authorization_failed';
    case 'email_invalid':
      return 'email_invalid';
    case 'email_required':
      return 'email_required';
    case 'identity_conflict':
      return 'identity_conflict';
    case 'identity_verification_failed':
      return 'identity_verification_failed';
    case 'login_state_expired':
      return 'login_state_expired';
    case 'missing_authorization_response':
      return 'missing_authorization_response';
    case 'provider_not_configured':
      return 'provider_not_configured';
    case 'sign_in_unavailable':
      return 'sign_in_unavailable';
    case 'token_exchange_failed':
      return 'token_exchange_failed';
    case 'workspace_mismatch':
      return 'workspace_mismatch';
    default:
      return null;
  }
}
