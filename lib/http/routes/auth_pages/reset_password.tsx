import ResetPasswordPage, {
  type ResetPasswordPageData,
} from '../../../../components/auth/ResetPasswordPage.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { privateResponse } from '../../private_response.ts';
import { createPasswordServices } from '../../../services/password_services_runtime.ts';

const methods = {
  GET(ctx: HttpRequest) {
    const token = ctx.url.searchParams.get('token')?.trim() ?? '';
    const data: ResetPasswordPageData = token
      ? { state: 'form', token }
      : { state: 'invalid_link' };
    return privateResponse(
      ctx.render(
        <ResetPasswordPage data={data} i18n={ctx.state.i18n} />,
      ),
    );
  },
  async POST(ctx: HttpRequest) {
    const form = await ctx.req.formData();
    const token = String(form.get('token') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!token) {
      return privateResponse(
        ctx.render(
          <ResetPasswordPage
            data={{ state: 'invalid_link' }}
            i18n={ctx.state.i18n}
          />,
        ),
      );
    }
    const result = await createPasswordServices(ctx.runtime).confirmReset({
      token,
      password,
      ipAddress: ctx.clientIp,
      userAgent: ctx.req.headers.get('user-agent'),
    });
    if (!result.ok) {
      const error = result.code;
      return privateResponse(ctx.render(
        <ResetPasswordPage
          i18n={ctx.state.i18n}
          data={{
            state: 'form',
            token,
            error,
            passwordInvalid: result.code === 'invalid_password',
          }}
        />,
      ));
    }
    return privateResponse(
      ctx.render(
        <ResetPasswordPage
          data={{ state: 'success' }}
          i18n={ctx.state.i18n}
        />,
      ),
    );
  },
};

export const resetPasswordRoute = defineHttpRoute('/password/reset', {
  GET: methods.GET,
  HEAD: methods.GET,
  POST: methods.POST,
});
