import type { HttpHandler, HttpRequest, HttpRoute } from '../../lib/http/route.ts';
import type { AppState } from '../../lib/http/app_state.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import type { ObjectStorage } from '../../lib/storage_contract.ts';
export type { HttpRequest } from '../../lib/http/route.ts';

export const DEFAULT_ROUTE_AUTH: RequestContext = {
  tenantId: '00000000-0000-0000-0000-000000000000',
  userId: '00000000-0000-0000-0000-000000000000',
  role: 'owner',
};
export type HttpEndpoint = HttpRoute | HttpHandler;
export type HttpFixtureOptions = {
  readonly params?: Readonly<Record<string, string>>;
  readonly auth?: RequestContext;
  readonly omitAuth?: boolean;
  readonly state?: Omit<Partial<AppState>, 'storage'> & {
    readonly storage?: Partial<ObjectStorage>;
  };
  readonly url?: URL;
  readonly peerIp?: string;
  readonly render?: HttpRequest['render'];
};

/** Use the URL supplied at the real HTTP boundary; forwarded headers cannot rewrite it. */
export function requestUrl(req: Request): URL {
  return new URL(req.url);
}
export function defaultTestRender(): HttpRequest['render'] {
  return () => new Response('render', { status: 200 });
}

/** Explicit canonical request fixture for retained HTTP-port tests, independent of framework contexts. */
export function makeHttpRequest(req: Request, options: HttpFixtureOptions = {}): HttpRequest {
  const locale = options.state?.interfaceLocale ?? 'en-US';
  const catalog = options.state?.catalog ?? catalogForLocale(locale);
  const runtime = { ...options.state?.runtime };
  const { storage: capabilities, ...givenState } = options.state ?? {};
  const unexpectedStorageOperation = (): never => {
    throw new Error('Unexpected storage operation in HTTP fixture.');
  };
  const state: AppState = {
    ...givenState,
    ...(capabilities
      ? {
        storage: {
          putObject: unexpectedStorageOperation,
          deleteObject: unexpectedStorageOperation,
          readObject: unexpectedStorageOperation,
          readObjectRange: unexpectedStorageOperation,
          readObjectStream: unexpectedStorageOperation,
          ...capabilities,
        },
      }
      : {}),
    runtime,
    auth: options.omitAuth ? undefined : options.auth ?? DEFAULT_ROUTE_AUTH,
    interfaceLocale: locale,
    catalog,
    i18n: options.state?.i18n ?? createI18n(locale, catalog),
  };
  runtime.state = state;
  return {
    req,
    url: options.url ?? new URL(req.url),
    params: options.params ?? {},
    state,
    runtime,
    clientIp: options.peerIp ?? '127.0.0.1',
    render: options.render ?? defaultTestRender(),
  };
}

/** Invoke the actual shared HTTP owner without a Fresh or Hono context substitute. */
export async function invokeHttpRoute(
  handler: HttpEndpoint,
  request: HttpRequest,
): Promise<Response> {
  return await (typeof handler === 'function' ? handler(request) : handler.handle(request));
}
export async function invokeHttpMethod(
  handler: HttpEndpoint,
  method: string,
  request: HttpRequest,
): Promise<Response> {
  if (request.req.method !== method) {
    throw new Error('Fixture HTTP method differs from its request.');
  }
  return await invokeHttpRoute(handler, request);
}
