import { hasCapability } from '../../../roles.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import { roleAtLeast } from '../../../roles.ts';
import { getTenantSettings, updateTenantName } from '../../../services/tenants.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type TenantErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_name'
  | 'invalid_bank_name'
  | 'update_failed';
const ERROR_MESSAGE_IDS: Record<TenantErrorCode, string> = {
  forbidden: 'settings.tenant.error.forbidden',
  not_found: 'settings.tenant.error.notFound',
  invalid_name: 'settings.tenant.error.invalidName',
  invalid_bank_name: 'settings.tenant.error.invalidBankName',
  update_failed: 'settings.tenant.error.updateFailed',
};

type Data = {
  tenant: { name: string; slug: string; bankDisplayName: string | null };
  canManageBankName: boolean;
  success?: boolean;
  error?: TenantErrorCode | null;
};

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!roleAtLeast(auth.role, 'admin')) {
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.forbidden), { status: 403 });
    }

    const url = ctx.url;
    const success = url.searchParams.get('success') === '1';
    const tenant = await getTenantSettings(auth);
    if (!tenant) {
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.not_found), { status: 404 });
    }

    return ctx.render(
      <TenantSettingsPage
        i18n={ctx.state.i18n}
        data={{ canManageBankName: hasCapability(auth.role, 'manage_workspace'), tenant, success }}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!roleAtLeast(auth.role, 'admin')) {
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.forbidden), { status: 403 });
    }

    const form = await ctx.req.formData();
    const name = String(form.get('name') ?? '').trim();

    const tenant = await getTenantSettings(auth);
    if (!tenant) {
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.not_found), { status: 404 });
    }
    if (!name) {
      return ctx.render(
        <TenantSettingsPage
          i18n={ctx.state.i18n}
          data={{
            canManageBankName: hasCapability(auth.role, 'manage_workspace'),
            tenant,
            success: false,
            error: 'invalid_name',
          }}
        />,
      );
    }
    try {
      await updateTenantName(auth, name);
    } catch (_cause: unknown) {
      return ctx.render(
        <TenantSettingsPage
          i18n={ctx.state.i18n}
          data={{
            canManageBankName: hasCapability(auth.role, 'manage_workspace'),
            tenant,
            success: false,
            error: 'update_failed',
          }}
        />,
      );
    }

    const url = ctx.url;
    const redirect = new URL('/settings/tenant', url.origin);
    redirect.searchParams.set('success', '1');
    return new Response(null, {
      status: 303,
      headers: { location: redirect.pathname + redirect.search },
    });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsTenantPageRoute = defineHttpRoute('/settings/tenant', {
  ...methods,
  HEAD: methods.GET,
});

export default function TenantSettingsPage({ data, i18n }: { data: Data; i18n: I18n }) {
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.tenant.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('settings.tenant.subtitle')}</p>
      </div>
      <form class='ds-card ds-card-bordered max-w-xl' method='post'>
        <div class='ds-card-body space-y-4'>
          {data.success && (
            <div class='ds-alert text-sm' role='status'>{i18n.t('settings.tenant.saved')}</div>
          )}
          {data.error && (
            <div class='ds-alert ds-alert-error text-sm' role='alert'>
              {i18n.t(ERROR_MESSAGE_IDS[data.error])}
            </div>
          )}
          <label class='ds-form-control'>
            <span>{i18n.t('settings.tenant.name')}</span>
            <Input name='name' defaultValue={data.tenant.name} required />
          </label>
          <label class='ds-form-control'>
            <span>{i18n.t('settings.tenant.slug')}</span>
            <Input value={data.tenant.slug} disabled />
          </label>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button variant='primary' type='submit'>{i18n.t('settings.tenant.save')}</Button>
          <Button variant='ghost' href='/settings'>{i18n.t('settings.tenant.back')}</Button>
        </div>
      </form>
      {data.canManageBankName && (
        <form method='post' action='/settings/tenant/bank-name' class='max-w-xl space-y-3'>
          <h2 class='text-xl font-medium'>{i18n.t('settings.tenant.bankTitle')}</h2>
          <label class='ds-form-control gap-1' htmlFor='bank-display-name'>
            <span>{i18n.t('settings.tenant.bankName')}</span>
            <Input
              id='bank-display-name'
              name='bankDisplayName'
              value={data.tenant.bankDisplayName ?? ''}
              maxLength={160}
              aria-describedby='bank-display-name-hint'
            />
          </label>
          <p id='bank-display-name-hint' class='text-sm'>{i18n.t('settings.tenant.bankHint')}</p>
          <Button type='submit' variant='primary'>{i18n.t('settings.tenant.bankSave')}</Button>
        </form>
      )}
    </section>
  );
}
