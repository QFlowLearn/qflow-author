import { developmentOrigin, edgeBuild } from 'virtual:qflow-assets';
import { type Ingress, readClientIp } from './client_address.ts';
import { createCloudflareWorker } from './worker_composition.ts';
import { createApp } from '../../lib/http/app.tsx';
import { dispatchWorkflowOutbox } from './workflows.entry.ts';
export {
  AiGenerationWorkflow,
  AssessmentPrintWorkflow,
  BankEnrichmentWorkflow,
  MigrationCommitWorkflow,
  QuestionOrganizationWorkflow,
  ReleaseBuildWorkflow,
  SourceMigrationWorkflow,
} from './workflows.entry.ts';

const app = createApp();
function composeWorker(ingress: Ingress, origin?: string) {
  const canonical = origin === undefined ? undefined : new URL(origin);
  return createCloudflareWorker({
    fetch(request, runtime) {
      // The local owner supplies a validated canonical origin. Never trust forwarded headers.
      let localRequest = request;
      if (canonical) {
        const url = new URL(request.url);
        url.protocol = canonical.protocol;
        url.hostname = canonical.hostname;
        url.port = canonical.port;
        localRequest = new Request(url, request);
      }
      return app.fetch(localRequest, {
        runtime: runtime.bindings,
        clientAddress: readClientIp(request, ingress),
      });
    },
  }, dispatchWorkflowOutbox);
}
const worker = composeWorker(
  edgeBuild ? 'CloudflareEdge' : 'Local',
  edgeBuild ? undefined : developmentOrigin,
);
/** Selected only by the owned local preview entry; no request or binding can select ingress. */
export function createLocalWorker(origin?: string) {
  return composeWorker('Local', origin);
}
export default worker;

export type { QflowCloudflareEnv } from './worker_composition.ts';
export { worker as qflowCloudflareWorker };
