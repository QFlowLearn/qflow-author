import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { LoginPageData } from '../../lib/services/browser_login.ts';
import GoogleSignInButton from '../ui/GoogleSignInButton.tsx';
export default function LoginPage(
  { data, i18n }: {
    readonly data: LoginPageData;
    readonly i18n: I18n;
  },
) {
  const error = loginErrorText(i18n, data.error);
  const oidcProviders = data.oidcProviders;
  const hasExternalLogin = oidcProviders.length > 0;
  const nextParam = data.next ? encodeURIComponent(data.next) : '';
  const signupHref = data.next ? `/signup?next=${nextParam}` : '/signup';
  const loginPolicy = data.loginPolicy;
  const passwordAllowed = loginPolicy !== 'require_sso';
  const useDomainRouting = loginPolicy === 'prefer_sso' || loginPolicy === 'require_sso';
  const signInUnavailable = data.signInUnavailable;
  const emailInvalid = data.errorField === 'email' || data.errorField === 'credentials';
  const passwordInvalid = data.errorField === 'credentials';

  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('login.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('login.subtitle')}</p>
      </div>
      <form class='ds-card ds-card-border max-w-xl' method='post'>
        <div class='ds-card-body space-y-4'>
          {error && (
            <div id='login-error' class='ds-alert ds-alert-error text-sm' role='alert'>
              {error}
            </div>
          )}
          {signInUnavailable && (
            <div class='text-sm text-base-content/70'>
              {i18n.t('login.retry')}
            </div>
          )}
          {!signInUnavailable && hasExternalLogin && useDomainRouting && (
            <div class='space-y-2'>
              <div class='text-sm text-base-content/70'>{i18n.t('login.ssoDomainHelp')}</div>
              <Button variant='primary' type='submit' name='action' value='sso'>
                {i18n.t('login.sso')}
              </Button>
              {passwordAllowed && <div class='ds-divider'>{i18n.t('login.or')}</div>}
            </div>
          )}
          {!signInUnavailable && hasExternalLogin && !useDomainRouting && (
            <div class='space-y-3'>
              <div class='text-sm text-base-content/70'>{i18n.t('login.providersLabel')}</div>
              <div class='flex flex-wrap gap-2'>
                {oidcProviders.map((provider) => (
                  provider.id === 'google'
                    ? (
                      <GoogleSignInButton
                        key={provider.id}
                        href={`/auth/oidc/${provider.id}${nextParam ? `?next=${nextParam}` : ''}`}
                        text={i18n.t('login.google')}
                      />
                    )
                    : (
                      <Button
                        key={provider.id}
                        variant='primary'
                        type='button'
                        href={`/auth/oidc/${provider.id}${nextParam ? `?next=${nextParam}` : ''}`}
                      >
                        {i18n.t('login.sso')} ({provider.label})
                      </Button>
                    )
                ))}
              </div>
              {passwordAllowed && <div class='ds-divider'>{i18n.t('login.or')}</div>}
            </div>
          )}
          {!signInUnavailable && <input type='hidden' name='next' value={data.next ?? ''} />}
          {!signInUnavailable && (
            <label class='flex flex-col' for='login-email'>
              <span>{i18n.t('login.email')}</span>
              <Input
                id='login-email'
                name='email'
                type='email'
                autoComplete='username'
                aria-invalid={emailInvalid ? 'true' : undefined}
                aria-describedby={emailInvalid ? 'login-error' : undefined}
                value={data.email}
                required
              />
            </label>
          )}
          {!signInUnavailable && passwordAllowed && (
            <label class='flex flex-col' for='current-password'>
              <span>{i18n.t('login.password')}</span>
              <Input
                id='current-password'
                name='password'
                type='password'
                autoComplete='current-password'
                aria-invalid={passwordInvalid ? 'true' : undefined}
                aria-describedby={passwordInvalid ? 'login-error' : undefined}
                required
              />
            </label>
          )}
          {!signInUnavailable && !passwordAllowed && (
            <div class='text-sm text-base-content/70'>
              {i18n.t('login.passwordDisabled')}
            </div>
          )}
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          {signInUnavailable
            ? <span class='text-sm text-base-content/70'>{i18n.t('login.unavailable')}</span>
            : passwordAllowed
            ? (
              <Button variant='primary' type='submit' name='action' value='password'>
                {i18n.t('login.submit')}
              </Button>
            )
            : <span class='text-sm text-base-content/70'>{i18n.t('login.ssoContinue')}</span>}
          <div class='flex flex-wrap gap-2'>
            {!signInUnavailable && passwordAllowed && (
              <Button variant='ghost' href='/password/forgot'>{i18n.t('login.forgot')}</Button>
            )}
            {!signInUnavailable && passwordAllowed && (
              <Button variant='ghost' href={signupHref}>{i18n.t('login.createAccount')}</Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

export function loginErrorText(i18n: I18n, code: LoginPageData['error']): string | null {
  switch (code) {
    case null:
      return null;
    case 'email_invalid':
      return i18n.t('signup.invalidEmail');
    case 'credentials_invalid':
      return i18n.t('login.invalidCredentials');
    case 'email_required':
      return i18n.t('login.error.emailRequired');
    case 'too_many_attempts':
      return i18n.t('login.error.tooManyAttempts');
    case 'workspace_unassigned':
      return i18n.t('login.error.workspaceUnassigned');
    case 'workspace_mismatch':
    case 'account_workspace_mismatch':
      return i18n.t('login.error.workspaceMismatch');
    case 'workspace_address_required':
      return i18n.t('login.error.workspaceAddressRequired');
    case 'password_disabled':
      return i18n.t('login.passwordDisabled');
    case 'provider_not_configured':
      return i18n.t('login.error.providerNotConfigured');
    case 'authorization_failed':
    case 'missing_authorization_response':
      return i18n.t('login.error.providerDeniedOrIncomplete');
    case 'login_state_expired':
      return i18n.t('login.error.stateExpired');
    case 'identity_conflict':
      return i18n.t('login.error.identityConflict');
    case 'identity_verification_failed':
      return i18n.t('login.error.identityVerificationFailed');
    case 'token_exchange_failed':
      return i18n.t('login.error.tokenExchangeFailed');
    case 'account_creation_failed':
      return i18n.t('login.error.accountCreationFailed');
    case 'sign_in_unavailable':
      return i18n.t('login.error.unavailable');
  }
}
