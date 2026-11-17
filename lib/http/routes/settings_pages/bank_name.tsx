import TenantSettingsPage from './tenant.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { hasCapability } from '../../../roles.ts';
import { getTenantSettings, updateBankDisplayName } from '../../../services/tenants.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** One explicit POST boundary for the owner-managed bank label. */
const methods = {
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!hasCapability(auth.role, 'manage_workspace')) {
      return requestErrorResponse(ctx.state.i18n, 'forbidden', 403);
    }
    const form = await ctx.req.formData();
    const exactField = [...form.keys()].every((key) => key === 'bankDisplayName') &&
      form.getAll('bankDisplayName').length === 1;
    const result = await updateBankDisplayName(
      auth,
      exactField ? form.get('bankDisplayName') : null,
    );
    if (result.ok) {
      return new Response(null, {
        status: 303,
        headers: { location: '/settings/tenant?success=1' },
      });
    }
    if (result.code === 'forbidden') {
      return requestErrorResponse(ctx.state.i18n, 'forbidden', 403);
    }
    const tenant = await getTenantSettings(auth);
    if (!tenant) return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
    return ctx.render(
      <TenantSettingsPage
        i18n={ctx.state.i18n}
        data={{ tenant, canManageBankName: true, error: 'invalid_bank_name' }}
      />,
      400,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsBankNamePageRoute = defineHttpRoute('/settings/tenant/bank-name', {
  ...methods,
});
