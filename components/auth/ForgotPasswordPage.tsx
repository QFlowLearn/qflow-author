import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
export type ForgotPasswordPageData = {
  error?: 'invalid_email' | null;
  email?: string | null;
  submitted?: boolean;
};

export default function ForgotPasswordPage(
  { data, i18n }: { data: ForgotPasswordPageData; i18n: I18n },
) {
  const error = data.error ? i18n.t('forgot.invalidEmail') : null;
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('forgot.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('forgot.subtitle')}</p>
      </div>
      <form class='ds-card ds-card-bordered max-w-xl' action='/password/forgot' method='post'>
        <div class='ds-card-body space-y-4'>
          {error && (
            <div id='forgot-error' class='ds-alert ds-alert-error text-sm' role='alert'>
              {error}
            </div>
          )}
          {data.submitted && (
            <div class='ds-alert text-sm' role='status'>
              {i18n.t('forgot.success')}
            </div>
          )}
          <label class='ds-form-control' for='password-reset-email'>
            <span>{i18n.t('login.email')}</span>
            <Input
              name='email'
              id='password-reset-email'
              type='email'
              autoComplete='username'
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'forgot-error' : undefined}
              value={data.email ?? ''}
              required
            />
          </label>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button variant='primary' type='submit'>{i18n.t('forgot.submit')}</Button>
          <Button variant='ghost' href='/login'>{i18n.t('forgot.back')}</Button>
        </div>
      </form>
    </section>
  );
}
