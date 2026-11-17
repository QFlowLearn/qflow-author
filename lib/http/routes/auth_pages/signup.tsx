import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { parseAuthReturnPath } from '../../auth_return_path.ts';

import { buildSessionCookie, readCookieValue, SESSION_COOKIE_NAME } from '../../cookies.ts';
import { PASSWORD_MIN_LENGTH } from '../../../services/auth_crypto.ts';
import { createSession } from '../../../services/auth_sessions.ts';
import { createTransactionalEmailSender } from '../../../services/email.ts';
import { completePasswordSignup } from '../../../services/password_signup.ts';
import { resolveTenantIdForHost } from '../../../services/tenants.ts';
import LocaleChooser from '../../../../components/LocaleChooser.tsx';
import type { I18n } from '../../../i18n/messages.ts';
import type { InterfaceLocale } from '../../../i18n/locale.ts';

type Data = {
  resultCode?: 'account_created_session_failed';
  error?:
    | 'invite_required'
    | 'invalid_email'
    | 'email_exists'
    | 'unavailable'
    | 'invalid_password'
    | null;
  errorField?: 'email' | 'form' | 'password';
  email?: string | null;
  name?: string | null;
  next?: string | null;
};

/** Shared route contract preserving the existing server-rendered page behavior. */
export const signupPageRoute = defineHttpRoute('/signup', {
  GET: handleGET,
  HEAD: handleGET,
  POST: handlePOST,
});

export default function SignupPage(
  { data, i18n, locale }: { data: Data; i18n: I18n; locale: InterfaceLocale },
) {
  const error = data.error === 'invite_required'
    ? i18n.t('signup.inviteRequired')
    : data.error === 'invalid_email'
    ? i18n.t('signup.invalidEmail')
    : data.error === 'email_exists'
    ? i18n.t('signup.emailExists')
    : data.error === 'invalid_password'
    ? i18n.t('signup.invalidPassword', { count: PASSWORD_MIN_LENGTH })
    : data.error === 'unavailable'
    ? i18n.t('signup.failed')
    : null;
  const emailInvalid = data.errorField === 'email';
  const passwordInvalid = data.errorField === 'password';
  const loginHref = data.next ? `/login?next=${encodeURIComponent(data.next)}` : '/login';
  if (data.resultCode === 'account_created_session_failed') {
    return (
      <section class='space-y-6'>
        <LocaleChooser i18n={i18n} value={locale} next={data.next} />
        <div class='space-y-2'>
          <h1 class='text-3xl font-medium'>{i18n.t('signup.createdTitle')}</h1>
          <p class='text-sm text-base-content/70'>{i18n.t('signup.createdBody')}</p>
        </div>
        <div class='ds-alert max-w-xl text-sm' role='status'>
          {i18n.t('signup.createdWarning')}
          <div class='mt-3'>
            <Button variant='primary' href={loginHref}>{i18n.t('login.submit')}</Button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section class='space-y-6'>
      <LocaleChooser i18n={i18n} value={locale} next={data.next} />
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('signup.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('signup.subtitle')}</p>
      </div>
      <form class='ds-card ds-card-bordered max-w-xl' method='post'>
        <div class='ds-card-body space-y-4'>
          <input type='hidden' name='next' value={data.next ?? ''} />
          {error && (
            <div id='signup-error' class='ds-alert ds-alert-error text-sm' role='alert'>
              {error}
            </div>
          )}
          <label class='ds-form-control' for='signup-name'>
            <span>{i18n.t('signup.name')}</span>
            <Input id='signup-name' name='name' autoComplete='name' value={data.name ?? ''} />
          </label>
          <label class='ds-form-control' for='signup-email'>
            <span>{i18n.t('signup.email')}</span>
            <Input
              id='signup-email'
              name='email'
              type='email'
              autoComplete='username'
              aria-invalid={emailInvalid ? 'true' : undefined}
              aria-describedby={emailInvalid ? 'signup-error' : undefined}
              value={data.email ?? ''}
              required
            />
          </label>
          <label class='ds-form-control' for='new-password'>
            <span>{i18n.t('signup.password')}</span>
            <Input
              id='new-password'
              name='password'
              type='password'
              autoComplete='new-password'
              minLength={PASSWORD_MIN_LENGTH}
              aria-invalid={passwordInvalid ? 'true' : undefined}
              aria-describedby={passwordInvalid
                ? 'signup-error password-requirements'
                : 'password-requirements'}
              required
            />
            <span id='password-requirements' class='text-sm text-base-content/70'>
              {i18n.t('signup.passwordHelp', { count: PASSWORD_MIN_LENGTH })}
            </span>
          </label>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button variant='primary' type='submit'>{i18n.t('signup.submit')}</Button>
          <Button variant='ghost' href={loginHref}>{i18n.t('signup.existingAccount')}</Button>
        </div>
      </form>
    </section>
  );
}

function handleGET(ctx: HttpRequest) {
  const url = ctx.url;
  const next = parseAuthReturnPath(url.searchParams.get('next'));
  return ctx.render(
    <SignupPage data={{ next }} i18n={ctx.state.i18n} locale={ctx.state.interfaceLocale} />,
  );
}

async function handlePOST(ctx: HttpRequest) {
  const form = await ctx.req.formData();
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = parseAuthReturnPath(form.get('next'));

  const hostTenantId = await resolveTenantIdForHost(ctx.url.hostname);
  const existingToken = readCookieValue(
    ctx.req.headers.get('cookie') || '',
    SESSION_COOKIE_NAME,
  ).value;
  const result = await completePasswordSignup({
    email,
    password,
    displayName: name || null,
    hostTenantId,
    userAgent: ctx.req.headers.get('user-agent'),
    clientIp: ctx.clientIp,
    replaceToken: existingToken,
    welcomeSource: 'password_web',
    interfaceLocale: ctx.state.interfaceLocale,
  }, {
    createSession,
    sendWelcomeEmail: (input) =>
      createTransactionalEmailSender(ctx.runtime).sendSignupWelcomeEmail(input),
  });
  if (!result.ok) {
    if (result.code === 'invalid_password') {
      return ctx.render(
        <SignupPage
          i18n={ctx.state.i18n}
          locale={ctx.state.interfaceLocale}
          data={{
            error: 'invalid_password',
            errorField: 'password',
            email,
            name,
            next,
          }}
        />,
      );
    }
    const error = result.code;
    return ctx.render(
      <SignupPage
        i18n={ctx.state.i18n}
        locale={ctx.state.interfaceLocale}
        data={{
          error,
          errorField: result.code === 'invalid_email' || result.code === 'email_exists'
            ? 'email'
            : 'form',
          email,
          name,
          next,
        }}
      />,
    );
  }

  if (result.code === 'account_created_session_failed') {
    return ctx.render(
      <SignupPage
        data={{ resultCode: result.code, next }}
        i18n={ctx.state.i18n}
        locale={ctx.state.interfaceLocale}
      />,
      201,
    );
  }

  const res = new Response(null, {
    status: 302,
    headers: { location: next ?? '/onboarding' },
  });
  res.headers.append(
    'set-cookie',
    buildSessionCookie(ctx.url, result.session.token, result.session.expiresAt),
  );
  return res;
}
