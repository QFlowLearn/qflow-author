import ForgotPasswordPage from '../../../../components/auth/ForgotPasswordPage.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { privateResponse } from '../../private_response.ts';
import { parseEmailAddress } from '../../../services/email_address.ts';
import { createPasswordServices } from '../../../services/password_services_runtime.ts';
import { resolveTenantIdForHost } from '../../../services/tenants.ts';

const methods = {
  GET(ctx: HttpRequest) {
    return privateResponse(
      ctx.render(
        <ForgotPasswordPage data={{}} i18n={ctx.state.i18n} />,
      ),
    );
  },
  async POST(ctx: HttpRequest) {
    const form = await ctx.req.formData();
    const rawEmail = String(form.get('email') ?? '').trim();
    const email = parseEmailAddress(rawEmail);

    if (!email) {
      return privateResponse(ctx.render(
        <ForgotPasswordPage
          data={{ error: 'invalid_email', email: rawEmail }}
          i18n={ctx.state.i18n}
        />,
      ));
    }

    const result = await createPasswordServices(ctx.runtime).requestReset({
      email,
      hostTenantId: await resolveTenantIdForHost(ctx.url.hostname),
      clientIp: ctx.clientIp,
      userAgent: ctx.req.headers.get('user-agent'),
    });
    if (!result.ok) {
      console.error(JSON.stringify({
        event: 'password_reset_request_not_sent',
        reason: result.code,
      }));
    }
    return privateResponse(
      ctx.render(
        <ForgotPasswordPage
          data={{ email, submitted: true }}
          i18n={ctx.state.i18n}
        />,
      ),
    );
  },
};

export const forgotPasswordRoute = defineHttpRoute('/password/forgot', {
  GET: methods.GET,
  HEAD: methods.GET,
  POST: methods.POST,
});
