import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { buildSessionCookie } from '../../cookies.ts';
import { PASSWORD_MIN_LENGTH } from '../../../services/auth_crypto.ts';
import { createPasswordServices } from '../../../services/password_services_runtime.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type Data = {
  error?: 'invalid_password' | 'current_password_invalid' | null;
  success?: boolean;
  force?: boolean;
};

const methods = {
  GET(ctx) {
    const url = ctx.url;
    const success = url.searchParams.get('success') === '1';
    const force = url.searchParams.get('force') === '1';
    return ctx.render(<PasswordSettingsPage data={{ success, force }} i18n={ctx.state.i18n} />);
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');

    const auth = requireAuthContext(ctx.state);
    const userId = auth.userId;
    const tenantId = auth.tenantId;
    const result = await createPasswordServices(ctx).changePassword({
      userId,
      tenantId,
      currentPassword,
      newPassword,
      userAgent: ctx.req.headers.get('user-agent'),
      ipAddress: ctx.clientIp,
    });
    if (!result.ok) {
      return ctx.render(
        <PasswordSettingsPage
          data={{
            error: result.code === 'invalid_new_password'
              ? 'invalid_password'
              : 'current_password_invalid',
          }}
          i18n={ctx.state.i18n}
        />,
      );
    }

    const url = ctx.url;
    const redirect = new URL('/settings/password', url.origin);
    redirect.searchParams.set('success', '1');
    const res = new Response(null, {
      status: 302,
      headers: { location: redirect.pathname + redirect.search },
    });
    res.headers.append('set-cookie', buildSessionCookie(ctx.url, result.token, result.expiresAt));
    return res;
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsPasswordPageRoute = defineHttpRoute('/settings/password', {
  ...methods,
  HEAD: methods.GET,
});

export default function PasswordSettingsPage({ data, i18n }: { data: Data; i18n: I18n }) {
  const error = data.error === 'invalid_password'
    ? i18n.t('settings.password.error.invalidNew', { count: PASSWORD_MIN_LENGTH })
    : data.error === 'current_password_invalid'
    ? i18n.t('settings.password.error.currentIncorrect')
    : null;
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.password.title')}</h1>
        <p class='text-sm text-base-content/70'>
          {i18n.t('settings.password.subtitle')}
        </p>
      </div>
      <form class='ds-card ds-card-border max-w-xl' method='post'>
        <div class='ds-card-body space-y-4'>
          {data.force && !data.success && (
            <div class='ds-alert text-sm'>
              {i18n.t('settings.password.forcedNotice')}
            </div>
          )}
          {error && (
            <div class='ds-alert ds-alert-error text-sm'>
              {error}
            </div>
          )}
          {data.success && (
            <div class='ds-alert text-sm'>
              {i18n.t('settings.password.updated')}
            </div>
          )}
          <label class='flex flex-col'>
            <span>{i18n.t('settings.password.current')}</span>
            <Input
              name='currentPassword'
              type='password'
              autoComplete='current-password'
              required
            />
          </label>
          <label class='flex flex-col'>
            <span>{i18n.t('settings.password.new')}</span>
            <Input
              id='new-password'
              name='newPassword'
              type='password'
              autoComplete='new-password'
              minLength={PASSWORD_MIN_LENGTH}
              aria-describedby='password-requirements'
              required
            />
            <span id='password-requirements' class='text-sm text-base-content/70'>
              {i18n.t('settings.password.requirements', { count: PASSWORD_MIN_LENGTH })}
            </span>
          </label>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button variant='primary' type='submit'>{i18n.t('settings.password.submit')}</Button>
          <Button variant='ghost' href='/assessments'>
            {i18n.t('settings.password.backToWorkspace')}
          </Button>
        </div>
      </form>
    </section>
  );
}
