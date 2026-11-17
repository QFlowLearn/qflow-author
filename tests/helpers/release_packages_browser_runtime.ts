import { startFetchServer } from './fetch_server.ts';
import { releasePackagesPageRoute as handlerEndpoint } from '../../lib/http/routes/release_pages/packages.ts';
import { invokeHttpRoute, makeHttpRequest } from './http_route.ts';
import { runReleaseBuildWorkflow } from '../../lib/workflows/release_build_workflow.ts';
import { db } from '../../lib/db.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import type { ObjectStorage } from '../../lib/storage_contract.ts';

const handler = handlerEndpoint.handle;

/** Browser composition root runs the real package handler and runner against the shared S3 fixture. */
export async function releasePackagesBrowserRuntime(
  appUrl: string,
  auth: RequestContext,
  storage: ObjectStorage,
) {
  const completed = new Set<string>();
  const instance = (id: string) => ({
    status: () => Promise.resolve({ status: completed.has(id) ? 'complete' : 'queued' }),
    restart: () => Promise.reject(new Error('Unexpected browser workflow restart.')),
  });
  const workflow = {
    async createBatch(inputs: readonly { id: string; params: { jobId: string } }[]) {
      for (const input of inputs) {
        if (completed.has(input.id)) continue;
        await runReleaseBuildWorkflow(
          { jobId: input.params.jobId, workflowExecutionId: input.id },
          {
            do: (_name, _config, operation) => operation(),
            sleep: () => Promise.resolve(),
          },
          { database: db, storage },
        );
        completed.add(input.id);
      }
      return inputs.map((input) => instance(input.id));
    },
    get: (id: string) => instance(id),
  };
  const catalog = catalogForLocale('en-US');
  const state = {
    storage,
    interfaceLocale: 'en-US' as const,
    catalog,
    i18n: createI18n('en-US', catalog),
    runtime: {
      bindings: {
        QFLOW_SOURCE_MIGRATION_WORKFLOW: workflow,
        QFLOW_AI_GENERATION_WORKFLOW: workflow,
        QFLOW_RELEASE_BUILD_WORKFLOW: workflow,
        QFLOW_MIGRATION_COMMIT_WORKFLOW: workflow,
        QFLOW_BANK_ENRICHMENT_WORKFLOW: workflow,
        QFLOW_QUESTION_ORGANIZATION_WORKFLOW: workflow,
        QFLOW_ASSESSMENT_PRINT_WORKFLOW: workflow,
      },
    },
  };
  return await startFetchServer(async (request) => {
    const url = new URL(request.url), match = /^\/releases\/([^/]+)\/packages$/.exec(url.pathname);
    if (match && request.method === 'POST') {
      return await invokeHttpRoute(
        handler,
        makeHttpRequest(request, { auth, state, params: { id: match[1] } }),
      );
    }
    const forwarded = new Request(new URL(url.pathname + url.search, appUrl), request);
    forwarded.headers.delete('host');
    if (forwarded.headers.get('origin') === url.origin) forwarded.headers.set('origin', appUrl);
    const referer = forwarded.headers.get('referer');
    if (referer?.startsWith(url.origin + '/')) {
      forwarded.headers.set('referer', appUrl + referer.slice(url.origin.length));
    }
    const response = await fetch(forwarded, { redirect: 'manual' }),
      headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    const location = headers.get('location');
    if (location?.startsWith(appUrl)) {
      headers.set('location', url.origin + location.slice(appUrl.length));
    }
    return new Response(response.body, { status: response.status, headers });
  });
}
