import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import { PASSWORD_MIN_LENGTH } from '../../lib/services/auth_crypto.ts';
export type ResetPasswordPageData =
  | {
    readonly state: 'form';
    readonly token: string;
    readonly error?: 'invalid_password' | 'invalid_or_expired';
    readonly passwordInvalid?: boolean;
  }
  | { readonly state: 'invalid_link' }
  | { readonly state: 'success' };

export default function ResetPasswordPage(
  { data, i18n }: { data: ResetPasswordPageData; i18n: I18n },
) {
  const error = data.state === 'form' && data.error
    ? data.error === 'invalid_password'
      ? i18n.t('signup.passwordHelp', { count: PASSWORD_MIN_LENGTH })
      : i18n.t('reset.invalidLink')
    : null;
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('reset.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('reset.subtitle')}</p>
      </div>
      {data.state === 'form' && (
        <form class='ds-card ds-card-border max-w-xl' action='/password/reset' method='post'>
          <div class='ds-card-body space-y-4'>
            <Input name='token' type='hidden' value={data.token} />
            {error && (
              <div id='reset-error' class='ds-alert ds-alert-error text-sm' role='alert'>
                {error}
              </div>
            )}
            <label class='flex flex-col' for='new-password'>
              <span>{i18n.t('reset.newPassword')}</span>
              <Input
                id='new-password'
                name='password'
                type='password'
                autoComplete='new-password'
                minLength={PASSWORD_MIN_LENGTH}
                aria-invalid={data.passwordInvalid ? 'true' : undefined}
                aria-describedby={data.passwordInvalid
                  ? 'reset-error password-requirements'
                  : 'password-requirements'}
                required
              />
              <span id='password-requirements' class='text-sm text-base-content/70'>
                {i18n.t('signup.passwordHelp', { count: PASSWORD_MIN_LENGTH })}
              </span>
            </label>
          </div>
          <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
            <Button variant='primary' type='submit'>{i18n.t('reset.submit')}</Button>
            <Button variant='ghost' href='/login'>{i18n.t('reset.back')}</Button>
          </div>
        </form>
      )}
      {data.state === 'invalid_link' && (
        <div class='ds-alert ds-alert-error max-w-xl text-sm' role='alert'>
          {i18n.t('reset.invalidLink')}
          <div class='mt-3'>
            <Button variant='ghost' href='/password/forgot'>{i18n.t('reset.requestLink')}</Button>
          </div>
        </div>
      )}
      {data.state === 'success' && (
        <div class='ds-alert max-w-xl text-sm' role='status'>
          {i18n.t('reset.success')}
          <div class='mt-3'>
            <Button variant='ghost' href='/login'>{i18n.t('login.submit')}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
