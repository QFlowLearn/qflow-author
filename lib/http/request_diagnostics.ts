import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { safeErrorSummary } from '../error_summary.ts';

/** Server-owned correlation available to HTTP adapters; it is never copied from a request header. */
export type RequestDiagnosticVariables = { readonly requestId: string };

/** Only bounded, non-content fields cross the request logging boundary. */
export type RequestDiagnostic = {
  readonly event: 'http_request' | 'http_request_error';
  readonly requestId: string;
  readonly method: string;
  readonly route: string | null;
  readonly status: number;
  readonly durationMs: number;
  readonly cause?: string;
};

/** Observe the final response (including early rejection/errors) without reading request content. */
export function requestDiagnostics(dependencies: {
  readonly nextId: () => string;
  readonly now: () => number;
  readonly emit: (event: RequestDiagnostic) => void;
}): MiddlewareHandler<{ Variables: RequestDiagnosticVariables }> {
  return async (c, next) => {
    const requestId = dependencies.nextId();
    const startedAt = dependencies.now();
    c.set('requestId', requestId);
    await next();
    c.header('x-request-id', requestId);
    const pattern = routePath(c, -1);
    dependencies.emit({
      event: c.error ? 'http_request_error' : 'http_request',
      requestId,
      method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(c.req.method)
        ? c.req.method
        : 'OTHER',
      route: pattern === '*' || pattern === '/*' || pattern === '' ? null : pattern,
      status: c.res.status,
      // This measures time to the response, excluding stream consumption and background jobs.
      durationMs: Math.max(0, Math.round((dependencies.now() - startedAt) * 100) / 100),
      ...(c.error ? { cause: safeErrorSummary(c.error) } : {}),
    });
  };
}
