import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { resolveStorage } from '../../../storage.ts';
import {
  parseSourceIntakeIdempotencyKey,
  parseSourceIntakeRequest,
  SourceIntakeRequestError,
  toImportSource,
} from '../../../source_intake/http.ts';
import {
  inspectSource,
  selectSourceCandidate,
  SourceSelectionError,
} from '../../../source_intake/registry.ts';
import { requireAuthContext } from '../../../tenants.ts';
import {
  enqueueMigrationBatch,
  MigrationBatchConflictError,
  MigrationBatchInputError,
} from '../../../import/migration_enqueue.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
  WorkflowBindingConfigError,
} from '../../../workflows/workflow_dispatch.ts';

/** Shared bank API endpoint contract and implementation. */
export const executeSourceBankRoute = defineHttpRoute('/api/source-intake/execute', {
  'POST': handle,
});

function logDeferredWorkflowDispatch(
  batchId: string,
  runIds: readonly string[],
  error: { readonly _tag: string },
): void {
  console.error(JSON.stringify({
    event: 'source_workflow_dispatch_deferred',
    batchId,
    runIds,
    errorTag: error._tag,
  }));
}

async function handle(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);

  try {
    requireWorkflowBindings(ctx.runtime);
    const idempotencyKey = parseSourceIntakeIdempotencyKey(ctx.req);
    const request = await parseSourceIntakeRequest(ctx.req);
    const selected = await Promise.all(
      request.entries.map(async (entry, index) => {
        const inspection = await inspectSource(request.purpose, entry.input);
        return selectSourceCandidate(inspection, request.selections[index]);
      }),
    );

    const storage = resolveStorage(ctx.runtime);
    if (request.purpose === 'recover_existing') {
      const batch = await enqueueMigrationBatch(auth, {
        idempotencyKey,
        destination: request.destination,
        purpose: 'recover_existing',
        sources: selected.map((candidate, index) => {
          const entry = request.entries[index];
          if (!entry) throw new Error('Inspected source inventory is inconsistent.');
          return {
            source: toImportSource(entry),
            adapter: candidate.adapter,
          };
        }),
      }, { storage });
      const dispatch = await dispatchPendingWorkflowJobs(ctx.runtime, {
        jobIds: batch.runs.map((run) => run.id),
        tenantId: auth.tenantId,
      });
      if (!dispatch.ok) {
        logDeferredWorkflowDispatch(batch.id, batch.runs.map((run) => run.id), dispatch.error);
      }
      const firstRun = batch.runs[0];
      if (!firstRun) {
        throw new SourceIntakeRequestError('Add a source before you continue.');
      }
      return Response.json({
        purpose: request.purpose,
        batchId: batch.id,
        runIds: batch.runs.map((run) => run.id),
        statusUrl: `/imports/batches/${batch.id}`,
        redirectTo: batch.runs.length === 1
          ? `/imports/${firstRun.id}`
          : `/imports/batches/${batch.id}`,
      }, { status: 202 });
    }

    const entry = request.entries[0];
    const candidate = selected[0];
    if (!entry || !candidate) {
      throw new SourceIntakeRequestError('Generate from source requires one source.');
    }
    const source = entry.input._tag === 'paste'
      ? {
        filename: 'pasted-source.txt',
        mime: 'text/plain',
        bytes: new TextEncoder().encode(entry.input.text),
      }
      : toImportSource(entry);
    const batch = await enqueueMigrationBatch(auth, {
      idempotencyKey,
      destination: request.destination,
      purpose: 'generate_new',
      sources: [{ source, adapter: candidate.adapter }],
    }, { storage });
    const dispatch = await dispatchPendingWorkflowJobs(ctx.runtime, {
      jobIds: batch.runs.map((queuedRun) => queuedRun.id),
      tenantId: auth.tenantId,
    });
    if (!dispatch.ok) {
      logDeferredWorkflowDispatch(
        batch.id,
        batch.runs.map((queuedRun) => queuedRun.id),
        dispatch.error,
      );
    }
    const run = batch.runs[0];
    if (!run) {
      throw new SourceIntakeRequestError('Generate from source requires one source.');
    }
    return Response.json({
      purpose: request.purpose,
      batchId: batch.id,
      runIds: [run.id],
      statusUrl: `/imports/batches/${batch.id}`,
      redirectTo: `/imports/${run.id}`,
    }, { status: 202 });
  } catch (error: unknown) {
    if (error instanceof WorkflowBindingConfigError) {
      console.error(JSON.stringify({
        event: 'source_workflow_configuration_invalid',
        errorTag: error._tag,
      }));
      return Response.json({
        error: 'Source processing is not configured for this environment.',
        code: 'configuration_unavailable',
      }, {
        status: 503,
      });
    }
    if (error instanceof SourceIntakeRequestError) {
      return Response.json({
        error: error.message,
        code: error.code,
        ...(error.params ? { params: error.params } : {}),
      }, { status: error.status });
    }
    if (error instanceof SourceSelectionError) {
      return Response.json({ error: error.message, code: error.code }, { status: 422 });
    }
    if (error instanceof MigrationBatchConflictError) {
      return Response.json({ error: error.message, code: 'conflict' }, { status: 409 });
    }
    if (error instanceof MigrationBatchInputError) {
      return Response.json({ error: error.message, code: 'invalid_request' }, { status: 400 });
    }
    console.error(JSON.stringify({
      event: 'source_intake_execution_failed',
      message: 'Source intake failed at an internal dependency.',
    }));
    return Response.json(
      { error: 'QFlowLearn could not prepare this source.', code: 'unexpected' },
      { status: 500 },
    );
  }
}
