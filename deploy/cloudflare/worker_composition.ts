import type { QflowRuntimeBindings } from '../../lib/runtime.ts';
import { safeErrorSummary } from '../../lib/error_summary.ts';
import { runWithRequestRuntime } from '../../lib/server/request_runtime_context.ts';
import { pruneAuthState } from '../../lib/services/auth.ts';
import {
  createPasswordServices,
  validatePasswordResetRuntime,
} from '../../lib/services/password_services_runtime.ts';

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
};

/** Raw platform bindings confined to the shared Worker composition seam. */
export type QflowCloudflareEnv = Record<string, unknown> & {
  ASSETS?: {
    fetch(request: Request): Promise<Response> | Response;
  };
  AI?: unknown;
  QFLOW_DB?: unknown;
  QFLOW_EMAIL?: unknown;
  QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT?: unknown;
  QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT?: unknown;
  QFLOW_UPLOADS?: unknown;
  QFLOW_SOURCE_MIGRATION_WORKFLOW?: unknown;
  QFLOW_AI_GENERATION_WORKFLOW?: unknown;
  QFLOW_RELEASE_BUILD_WORKFLOW?: unknown;
  QFLOW_MIGRATION_COMMIT_WORKFLOW?: unknown;
  QFLOW_BANK_ENRICHMENT_WORKFLOW?: unknown;
  QFLOW_QUESTION_ORGANIZATION_WORKFLOW?: unknown;
  QFLOW_ASSESSMENT_PRINT_WORKFLOW?: unknown;
  QFLOW_PRINT_RENDERER?: unknown;
};

/** One selected HTTP router; request lifetime and scheduled work belong to its Worker. */
export type WorkerHttpServer = {
  fetch(
    request: Request,
    runtime: { readonly bindings: QflowRuntimeBindings },
  ): Promise<Response> | Response;
};

const WORKFLOW_DISPATCH_CRON = '* * * * *';
const PASSWORD_RESET_DELIVERY_CRON = '*/2 * * * *';
const AUTH_STATE_PRUNE_CRON = '0 3 * * *';

/** Compose one HTTP router with QFlow's existing scheduled work and request-owned bindings. */
export function createCloudflareWorker(
  workerServer: WorkerHttpServer,
  dispatchWorkflowOutbox: (
    env: QflowCloudflareEnv,
  ) => Promise<import('../../lib/workflows/workflow_dispatch.ts').WorkflowDispatchResult>,
) {
  let passwordResetRuntimeValidated = false;
  return {
    fetch(
      request: Request,
      env: QflowCloudflareEnv,
      _ctx: WorkerExecutionContext,
    ): Promise<Response> | Response {
      const runtime = cloudflareRuntime(env);
      if (!passwordResetRuntimeValidated) {
        validatePasswordResetRuntime(runtime);
        passwordResetRuntimeValidated = true;
      }
      return runWithRequestRuntime(runtime, () => {
        if (shouldServeCloudflareAsset(request) && env.ASSETS) {
          return env.ASSETS.fetch(request);
        }
        return workerServer.fetch(request, runtime);
      });
    },
    async scheduled(event: unknown, env: QflowCloudflareEnv): Promise<void> {
      const runtime = cloudflareRuntime(env);
      await runWithRequestRuntime(runtime, async () => {
        const cron = readScheduledCron(event);
        if (cron === WORKFLOW_DISPATCH_CRON) {
          const workflow = await dispatchWorkflowOutbox(env);
          if (workflow.ok) return;
          if (!('error' in workflow)) {
            console.error(JSON.stringify({
              event: 'workflow_outbox_dispatch_failed',
              errorTag: 'WorkflowDispatchFailed',
              phase: 'invalid_dispatch_result',
              cause: { name: 'InvalidWorkflowDispatchResult', code: null },
            }));
            throw new Error('Cloudflare Workflow outbox dispatch failed.');
          }
          console.error(JSON.stringify({
            event: 'workflow_outbox_dispatch_failed',
            errorTag: workflow.error._tag,
            phase: workflow.error.phase,
            cause: workflow.error.cause,
          }));
          throw new Error('Cloudflare Workflow outbox dispatch failed.');
        }

        if (cron === PASSWORD_RESET_DELIVERY_CRON) {
          const delivery = await createPasswordServices(runtime).deliverPendingResetEmails();
          if (delivery.ok) return;
          console.error(JSON.stringify({
            event: 'password_reset_delivery_recovery_failed',
            attempted: delivery.attempted,
            delivered: delivery.delivered,
            failed: delivery.failed,
          }));
          throw new Error('Cloudflare password-reset delivery recovery failed.');
        }

        if (cron === AUTH_STATE_PRUNE_CRON) {
          try {
            await pruneAuthState();
            return;
          } catch (cause: unknown) {
            console.error(JSON.stringify({
              event: 'auth_state_prune_failed',
              cause: safeErrorSummary(cause),
            }));
            throw new Error('Cloudflare auth cleanup failed.');
          }
        }

        console.warn(JSON.stringify({
          event: 'cloudflare_scheduled_trigger_ignored',
          cron,
        }));
      });
    },
  };
}

function shouldServeCloudflareAsset(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return pathname.startsWith('/assets/') ||
    pathname.startsWith('/fonts/') ||
    pathname === '/favicon.svg' ||
    pathname === '/styles.css' ||
    pathname === '/tailwind.css' ||
    pathname === '/tw.css';
}

function cloudflareRuntime(env: QflowCloudflareEnv) {
  return { bindings: env };
}

function readScheduledCron(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const cron = Reflect.get(event, 'cron');
  return typeof cron === 'string' ? cron : null;
}
