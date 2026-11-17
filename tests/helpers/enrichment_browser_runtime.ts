import { startFetchServer } from './fetch_server.ts';
import { bankOrganizePageRoute as beginEndpoint } from '../../lib/http/routes/bank_pages/organize.tsx';
import { bankOrganizationPageRoute as taskEndpoint } from '../../lib/http/routes/bank_pages/organization.tsx';
import { invokeHttpRoute, makeHttpRequest } from './http_route.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { enrichmentConfigFixture as config } from './enrichment_provider_fixture.ts';
import { db } from '../../lib/db.ts';
import { BankEnrichmentJobRead } from '../../lib/services/bank_enrichment_job_read.ts';
import { finishTestEnrichment } from './enrichment_test_worker.ts';

const begin = beginEndpoint.handle;
const task = taskEndpoint.handle;

/** Explicit test model settings used by both the local Fresh renderer and the owned job dispatcher. */
export const enrichmentBrowserEnvironment = {
  QFLOW_ENRICHMENT_PROVIDER: config.provider,
  QFLOW_ENRICHMENT_MODEL: config.model,
  QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION: String(config.inputMicrosPerMillion),
  QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION: String(config.outputMicrosPerMillion),
  QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS: String(config.previewBudgetMicros),
  QFLOW_ENRICHMENT_RUN_BUDGET_MICROS: String(config.runBudgetMicros),
};
/** HTTP composition owns a queued platform adapter; drain runs real workflows with a fixture provider. */
export async function enrichmentBrowserRuntime(auth: RequestContext) {
  const queue = new Map<string, string>(), completed = new Set<string>();
  const instance = (id: string) => ({
    status: () => Promise.resolve({ status: completed.has(id) ? 'complete' : 'queued' }),
    restart: () => Promise.reject(new Error('Unexpected fixture restart.')),
  });
  const workflow = {
    createBatch(
      inputs: readonly { readonly id: string; readonly params: { readonly jobId: string } }[],
    ) {
      for (const input of inputs) {
        if (!completed.has(input.id)) queue.set(input.id, input.params.jobId);
      }
      return Promise.resolve(inputs.map((input) => instance(input.id)));
    },
    get: (id: string) => instance(id),
  };
  const catalog = catalogForLocale('en-US');
  const state = {
    interfaceLocale: 'en-US' as const,
    catalog,
    i18n: createI18n('en-US', catalog),
    runtime: {
      bindings: {
        ...enrichmentBrowserEnvironment,
        AI: {
          run: () => {
            throw new Error('The browser fixture never uses a remote AI binding.');
          },
        },
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
  let posts = 0;
  const server = await startFetchServer(async (request) => {
    const url = new URL(request.url);
    const match = /^\/items\/organize(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
    if (!match || request.method !== 'POST') return new Response(null, { status: 404 });
    posts++;
    const handler = match[1] ? task : begin;
    const post = handler;
    if (!post) throw new Error('Enrichment POST is missing.');
    return await invokeHttpRoute(
      post,
      makeHttpRequest(request, {
        auth,
        state,
        params: match[1] ? { id: match[1] } : {},
      }),
    );
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    postCount: () => posts,
    async drain() {
      for (const [executionId, jobId] of [...queue]) {
        const outcome = await finishTestEnrichment(jobId, executionId);
        if (outcome._tag !== 'Completed') {
          const job = await new BankEnrichmentJobRead(db, () => new Date()).get(auth, jobId);
          if (!job.ok || job.value.state !== 'cancelled') {
            throw new Error('Browser fixture workflow failed.');
          }
        }
        queue.delete(executionId);
        completed.add(executionId);
      }
    },
    close: () => server.close(),
  };
}
