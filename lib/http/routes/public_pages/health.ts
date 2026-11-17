import { defineHttpRoute, type HttpRequest, type HttpRoute } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { checkDatabaseHealth } from '../../../services/health.ts';

export function createHealthRoute(deps: {
  checkDatabase?: () => Promise<void>;
  now?: () => Date;
} = {}): HttpRoute {
  const checkDatabase = deps.checkDatabase ?? checkDatabaseHealth;
  const now = deps.now ?? (() => new Date());

  const handle = async (_ctx: HttpRequest) => {
    const timestamp = now().toISOString();
    const baseHeaders = {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
    };

    try {
      await checkDatabase();
      return new Response(
        JSON.stringify({
          status: 'ok',
          timestamp,
          checks: {
            database: 'ok',
          },
        }),
        {
          status: 200,
          headers: baseHeaders,
        },
      );
    } catch (cause: unknown) {
      console.error(JSON.stringify({
        event: 'healthcheck_database_error',
        cause: safeErrorSummary(cause),
      }));
      return new Response(
        JSON.stringify({
          status: 'degraded',
          timestamp,
          checks: {
            database: 'error',
          },
        }),
        {
          status: 503,
          headers: baseHeaders,
        },
      );
    }
  };
  return defineHttpRoute('/health', { GET: handle, HEAD: handle });
}

export const healthRoute = createHealthRoute();
