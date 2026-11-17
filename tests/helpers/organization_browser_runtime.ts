import { startFetchServer } from './fetch_server.ts';
import { fixtureClefProvider } from './fixture_clef_provider.ts';
import { bankOrganizePageRoute as beginEndpoint } from '../../lib/http/routes/bank_pages/organize.tsx';
import { bankOrganizationPageRoute as taskEndpoint } from '../../lib/http/routes/bank_pages/organization.tsx';
import { invokeHttpRoute, makeHttpRequest } from './http_route.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { organizationBrowserEnvironment } from './organization_browser_environment.ts';
export { organizationBrowserEnvironment } from './organization_browser_environment.ts';
import { db } from '../../lib/db.ts';
import { processOrganizationStep } from '../../lib/services/question_organization_processor.ts';

const begin = beginEndpoint.handle;
const task = taskEndpoint.handle;

/** HTTP composition owns a queued platform adapter; drain runs real workflows with a fixture provider. */
export async function organizationBrowserRuntime(
  auth: RequestContext,
  mode: 'fixture_clef' | 'no_ai' = 'fixture_clef',
) {
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
        ...(mode === 'fixture_clef' ? organizationBrowserEnvironment : {}),
        AI: mode === 'no_ai' ? undefined : {
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
        for (let step = 0; step < 30; step++) {
          const outcome = await processOrganizationStep(
            { jobId, workflowExecutionId: executionId },
            {
              database: db,
              now: () => new Date(),
              newId: () => crypto.randomUUID(),
              provider: () => {
                if (mode === 'no_ai') {
                  throw new Error('Source-only organization must not request AI.');
                }
                return fixtureClefProvider((question, _definition, examples) => {
                  const topicId =
                    examples.find((e) => e.question.questionId === question.questionId)?.topicId ??
                      'cells';
                  return Promise.resolve({
                    ok: true,
                    value: {
                      topicId,
                      confidence: 0.99,
                      probabilities: {
                        cells: topicId === 'cells' ? 0.99 : 0.01,
                        energy: topicId === 'energy' ? 0.99 : 0.01,
                        __no_match__: 0,
                      },
                      model: 'clef',
                      inputTokens: 700,
                      outputTokens: 41,
                    },
                  });
                });
              },
            },
          );
          if (!outcome.ok || outcome.value.state === 'failed') {
            throw new Error('Organization browser processing failed');
          }
          if (outcome.value.state === 'completed') break;
          if (step === 29) throw new Error('Organization browser did not finish');
        }
        queue.delete(executionId);
        completed.add(executionId);
      }
    },
    close: () => server.close(),
  };
}
