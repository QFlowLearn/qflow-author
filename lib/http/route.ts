import type { VNode } from 'preact';
import type { QflowRuntime } from '../runtime.ts';
import type { AppState } from './app_state.ts';

/** Framework-independent inputs owned by the HTTP adapter. */
export type HttpRequest = {
  readonly req: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly state: AppState;
  readonly runtime: QflowRuntime;
  readonly clientIp: string | null;
  render(node: VNode | null, status?: number): Response | Promise<Response>;
};

export type HttpHandler = (request: HttpRequest) => Response | Promise<Response>;

/** One endpoint's method contract and implementation, owned by the HTTP adapter. */
export type HttpRoute = {
  readonly path: string;
  readonly methods: readonly string[];
  readonly handle: HttpHandler;
  methodNotAllowed(): Response;
};

export function defineHttpRoute(
  path: string,
  handlers: Readonly<Record<string, HttpHandler>>,
  options: {
    readonly methodNotAllowedBody?: string;
    readonly methodNotAllowedHeaders?: Readonly<Record<string, string>>;
  } = {},
): HttpRoute {
  const methods = Object.freeze(Object.keys(handlers));
  const methodNotAllowed = () =>
    new Response(options.methodNotAllowedBody ?? 'Method Not Allowed', {
      status: 405,
      headers: {
        ...options.methodNotAllowedHeaders,
        allow: methods.join(', '),
      },
    });
  return Object.freeze({
    path,
    methods,
    methodNotAllowed,
    handle(request: HttpRequest) {
      const handler = Object.hasOwn(handlers, request.req.method)
        ? handlers[request.req.method]
        : handlers['*'];
      return handler ? handler(request) : methodNotAllowed();
    },
  });
}
