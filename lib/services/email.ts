import { getEnv } from '../config.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { getRuntimeBinding, type RuntimeSource } from '../runtime.ts';
import type { InterfaceLocale } from '../i18n/locale.ts';
import { catalogForLocale } from '../i18n/catalogs.ts';
import { createI18n } from '../i18n/messages.ts';

type EmailRecipient = {
  readonly email: string;
  readonly name?: string;
};

type EmailMessageBuilder = {
  readonly to: string | EmailRecipient | ReadonlyArray<string | EmailRecipient>;
  readonly from: string | EmailRecipient;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly cc?: string | EmailRecipient | ReadonlyArray<string | EmailRecipient>;
  readonly bcc?: string | EmailRecipient | ReadonlyArray<string | EmailRecipient>;
  readonly replyTo?: string | EmailRecipient;
  readonly headers?: Record<string, string>;
};

type SendEmailBinding = {
  send(message: EmailMessageBuilder): Promise<{ messageId: string }>;
};

export type SignupWelcomeEmailSource = 'password_web' | 'password_api' | 'public_oidc';

export type SignupWelcomeEmailInput = {
  readonly email: string;
  readonly displayName: string | null;
  readonly userId: string;
  readonly tenantId: string;
  readonly source: SignupWelcomeEmailSource;
  readonly interfaceLocale: InterfaceLocale;
};

export type PasswordResetEmailInput = {
  readonly email: string;
  readonly resetUrl: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly interfaceLocale: InterfaceLocale;
};

/** Result returned by the configured transactional-email capability. */
export type TransactionalEmailDeliveryResult =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly code: 'send_failed' | 'disabled_local' };

/** Service-facing capability for QFlow transactional email. */
export type TransactionalEmailSender = {
  sendSignupWelcomeEmail(
    input: SignupWelcomeEmailInput,
  ): Promise<TransactionalEmailDeliveryResult>;
  sendPasswordResetEmail(
    input: PasswordResetEmailInput,
  ): Promise<TransactionalEmailDeliveryResult>;
};

/** Build the required Cloudflare Email Service adapter from one runtime boundary. */
export function createCloudflareTransactionalEmailSender(
  runtime: RuntimeSource,
): TransactionalEmailSender {
  const binding = requireTransactionalEmailBinding(runtime);
  const from = getEnv('QFLOW_EMAIL_FROM', runtime);
  if (!from) throw new Error('Missing required env var QFLOW_EMAIL_FROM');
  const bcc = getEnv('QFLOW_SIGNUP_NOTIFY_BCC', runtime);

  return {
    sendSignupWelcomeEmail(input) {
      return sendSignupWelcomeEmail(binding, from, bcc, input);
    },
    sendPasswordResetEmail(input) {
      return sendPasswordResetEmail(binding, from, input);
    },
  };
}

/** Resolve the configured sender, permitting only the explicitly named local-disabled adapter. */
export function createTransactionalEmailSender(runtime: RuntimeSource): TransactionalEmailSender {
  return isLocalTransactionalEmailDisabled(runtime)
    ? createLocalDisabledTransactionalEmailSender()
    : createCloudflareTransactionalEmailSender(runtime);
}

/** Return whether the explicitly named local-only disabled email adapter is configured. */
export function isLocalTransactionalEmailDisabled(runtime: RuntimeSource): boolean {
  return getRuntimeBinding(runtime, 'QFLOW_EMAIL') === undefined &&
    getEnv('QFLOW_LOCAL_TRANSACTIONAL_EMAIL_DISABLED', runtime) === 'true';
}

/** Build the explicit local-only adapter that never sends transactional email. */
export function createLocalDisabledTransactionalEmailSender(): TransactionalEmailSender {
  const disabled = (): Promise<TransactionalEmailDeliveryResult> =>
    Promise.resolve({ ok: false, code: 'disabled_local' });
  return {
    sendSignupWelcomeEmail: disabled,
    sendPasswordResetEmail: disabled,
  };
}

async function sendSignupWelcomeEmail(
  binding: SendEmailBinding,
  from: string,
  bcc: string | undefined,
  input: SignupWelcomeEmailInput,
): Promise<TransactionalEmailDeliveryResult> {
  const message = buildSignupWelcomeEmail({ ...input, from, bcc });

  try {
    const result = await binding.send(message);
    return { ok: true, messageId: result.messageId };
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'signup_welcome_email_failed',
      reason: 'send_failed',
      userId: input.userId,
      tenantId: input.tenantId,
      source: input.source,
      cause: safeErrorSummary(cause),
    }));
    return { ok: false, code: 'send_failed' };
  }
}

async function sendPasswordResetEmail(
  binding: SendEmailBinding,
  from: string,
  input: PasswordResetEmailInput,
): Promise<TransactionalEmailDeliveryResult> {
  const message = buildPasswordResetEmail(input, from);

  try {
    const result = await binding.send({
      to: input.email,
      from,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        'X-QFlow-Email': 'password-reset',
      },
    });
    return { ok: true, messageId: result.messageId };
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'password_reset_email_failed',
      reason: 'send_failed',
      userId: input.userId,
      tenantId: input.tenantId,
      cause: safeErrorSummary(cause),
    }));
    return { ok: false, code: 'send_failed' };
  }
}

/** Build a locale-stable, escaped password-reset email without sending it. */
export function buildPasswordResetEmail(
  input: PasswordResetEmailInput,
  from: string,
): EmailMessageBuilder & { readonly subject: string } {
  const i18n = createI18n(input.interfaceLocale, {
    email: catalogForLocale(input.interfaceLocale).email,
  });
  const text = [
    i18n.t('email.reset.requested'),
    '',
    i18n.t('email.reset.linkInstruction'),
    input.resetUrl,
    '',
    i18n.t('email.reset.expiry'),
    i18n.t('email.reset.ignore'),
  ].join('\n');
  const html = `<!doctype html><html lang="${
    escapeHtml(input.interfaceLocale)
  }"><head><meta charset="utf-8"></head><body><p>${
    escapeHtml(i18n.t('email.reset.requested'))
  }</p><p><a href="${escapeHtml(input.resetUrl)}">${
    escapeHtml(i18n.t('email.reset.linkText'))
  }</a></p><p>${escapeHtml(i18n.t('email.reset.expiry'))}</p><p>${
    escapeHtml(i18n.t('email.reset.ignore'))
  }</p></body></html>`;
  return { to: input.email, from, subject: i18n.t('email.reset.subject'), text, html };
}

export function buildSignupWelcomeEmail(
  input: SignupWelcomeEmailInput & { readonly from: string; readonly bcc: string | undefined },
): EmailMessageBuilder {
  const i18n = createI18n(input.interfaceLocale, {
    email: catalogForLocale(input.interfaceLocale).email,
  });
  const greeting = input.displayName
    ? i18n.t('email.welcome.greeting', { displayName: input.displayName })
    : i18n.t('email.welcome.greetingNoName');
  const text = [
    greeting,
    '',
    i18n.t('email.welcome.ready'),
    '',
    i18n.t('email.welcome.platform'),
    '',
    i18n.t('email.welcome.beta'),
    '',
    i18n.t('email.welcome.feedback'),
    '',
    i18n.t('email.welcome.signoff'),
  ].join('\n');
  const html = [
    `<!doctype html><html lang="${
      escapeHtml(input.interfaceLocale)
    }"><head><meta charset="utf-8"></head><body><p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(i18n.t('email.welcome.ready'))}</p>`,
    `<p>${escapeHtml(i18n.t('email.welcome.platform'))}</p>`,
    `<p>${escapeHtml(i18n.t('email.welcome.beta'))}</p>`,
    `<p>${escapeHtml(i18n.t('email.welcome.feedback'))}</p>`,
    `<p>${escapeHtml(i18n.t('email.welcome.signoff')).replaceAll('\n', '<br>')}</p></body></html>`,
  ].join('');

  return {
    to: input.email,
    from: input.from,
    ...(input.bcc ? { bcc: input.bcc } : {}),
    subject: i18n.t('email.welcome.subject'),
    text,
    html,
    headers: {
      'X-QFlow-Email': 'signup-welcome',
      'X-QFlow-Signup-Source': input.source,
      'X-QFlow-Tenant-Id': input.tenantId,
      'X-QFlow-User-Id': input.userId,
    },
  };
}

function requireTransactionalEmailBinding(runtime: RuntimeSource): SendEmailBinding {
  const binding = getRuntimeBinding(runtime, 'QFLOW_EMAIL');
  if (!binding || typeof binding !== 'object') {
    throw new Error('Missing required Cloudflare binding QFLOW_EMAIL');
  }
  const send = Reflect.get(binding, 'send');
  if (typeof send !== 'function') {
    throw new Error('Missing required Cloudflare binding QFLOW_EMAIL');
  }
  // SAFETY: the Cloudflare boundary was refined to an object with a callable send capability.
  return binding as SendEmailBinding;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
