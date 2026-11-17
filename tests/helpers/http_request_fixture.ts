import type { HttpRequest } from '../../lib/http/route.ts';
import type { QflowRuntime } from '../../lib/runtime.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';

/** Explicit request fixture for shared API handlers; page rendering is outside this seam. */
export function apiRequest(req: Request, options: {
  readonly runtime?: QflowRuntime;
  readonly auth?: RequestContext;
  readonly clientIp?: string;
  readonly params?: Readonly<Record<string, string>>;
} = {}): HttpRequest {
  const catalog = catalogForLocale('en-US');
  const runtime = options.runtime ?? {};
  return {
    req,
    url: new URL(req.url),
    params: options.params ?? {},
    state: {
      runtime,
      auth: options.auth,
      interfaceLocale: 'en-US' as const,
      catalog,
      i18n: createI18n('en-US', catalog),
    },
    runtime,
    clientIp: options.clientIp ?? null,
    render() {
      throw new Error('API fixture cannot render a page.');
    },
  };
}
