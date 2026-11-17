import NotFound from '../../components/NotFound.tsx';
import { Hono } from 'hono';
import { type AppEnv, errorPage, type HttpContext, i18nFor, page } from './hono.tsx';
import { httpRoutes } from './routes.ts';
import { finalizeResponse, requestLocale, resolveRequest } from './request_policy.ts';
import { parseLocaleCookie } from '../i18n/locale.ts';
import { requestDiagnostics } from './request_diagnostics.ts';

/** One router, with shared policy and endpoint owners. */
export function createApp() {
  const app = new Hono<AppEnv>({ strict: false });
  app.use(
    '*',
    requestDiagnostics({
      nextId: () => crypto.randomUUID(),
      now: () => performance.now(),
      emit: (event) => {
        if (event.status >= 500) console.error(JSON.stringify(event));
        else console.info(JSON.stringify(event));
      },
    }),
  );
  app.use('*', async (c, next) => {
    c.set('locale', requestLocale(c.req.raw));
    await next();
    c.res = finalizeResponse(
      new URL(c.req.url),
      c.res,
      parseLocaleCookie(c.req.raw.headers.get('cookie')),
      c.get('locale'),
    );
  });
  app.use('*', async (c, next) => {
    const result = await resolveRequest({
      req: c.req.raw,
      url: new URL(c.req.url),
      runtime: { bindings: c.env.runtime },
    });
    c.set('locale', result.locale);
    if (result.kind === 'respond') return result.response;
    c.set('state', result.state);
    await next();
  });
  for (const route of httpRoutes) {
    const handle = (c: HttpContext) =>
      route.handle({
        req: c.req.raw,
        url: new URL(c.req.url),
        params: c.req.param(),
        state: c.get('state'),
        runtime: c.get('state').runtime,
        clientIp: c.env.clientAddress,
        render: (node, status) => page(c, node, status),
      });
    if (route.methods.includes('*')) app.all(route.path, handle);
    else app.on([...route.methods], route.path, handle);
    if (!route.methods.includes('*')) app.all(route.path, () => route.methodNotAllowed());
  }
  app.notFound((c) => page(c, <NotFound state={{ i18n: i18nFor(c) }} />, 404));
  app.onError((_cause, c) => {
    return finalizeResponse(
      new URL(c.req.url),
      errorPage(c),
      parseLocaleCookie(c.req.raw.headers.get('cookie')),
      c.get('locale'),
    );
  });
  return app;
}
