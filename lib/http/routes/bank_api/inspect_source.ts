import { safeErrorSummary } from '../../../error_summary.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { parseSourceIntakeRequest, SourceIntakeRequestError } from '../../../source_intake/http.ts';
import { inspectSource } from '../../../source_intake/registry.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared bank API endpoint contract and implementation. */
export const inspectSourceBankRoute = defineHttpRoute('/api/source-intake/inspect', {
  'POST': handle,
});

async function handle(ctx: HttpRequest) {
  requireAuthContext(ctx.state);

  try {
    const request = await parseSourceIntakeRequest(ctx.req);
    const inspections = await Promise.all(
      request.entries.map((entry) => inspectSource(request.purpose, entry.input)),
    );
    return Response.json({ purpose: request.purpose, inspections });
  } catch (error: unknown) {
    if (error instanceof SourceIntakeRequestError) {
      return Response.json(
        {
          error: error.message,
          code: error.code,
          ...(error.params ? { params: error.params } : {}),
        },
        { status: error.status },
      );
    }
    console.error(
      JSON.stringify({ event: 'source_intake_inspection_failed', cause: safeErrorSummary(error) }),
    );
    return Response.json(
      { error: 'Unable to inspect the source.', code: 'unexpected' },
      { status: 500 },
    );
  }
}
