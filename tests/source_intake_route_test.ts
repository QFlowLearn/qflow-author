import { expect, test as testCase } from 'vitest';

import { executeSourceBankRoute as executeHandlerEndpoint } from '../lib/http/routes/bank_api/execute_source.ts';
import { inspectSourceBankRoute as inspectHandlerEndpoint } from '../lib/http/routes/bank_api/inspect_source.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import type { ObjectReadWriter } from '../lib/storage_contract.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { runSourceMigrationWorkflow } from '../lib/workflows/job_workflows.ts';
import { db, shutdownDb } from '../lib/db.ts';
import {
  auditLogs,
  conversionSourceArtifacts,
  migrationBatches,
  migrationRuns,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';

const executeHandler = executeHandlerEndpoint.handle;
const inspectHandler = inspectHandlerEndpoint.handle;

testCase('source intake inspection resolves pasted generation text', async () => {
  const form = new FormData();
  form.set('destination', 'Assessment');
  form.set('purpose', 'generate_new');
  form.set('text', 'Plate tectonics explains the movement of continents.');
  const req = new Request('http://local/api/source-intake/inspect', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });

  const response = await invokeHttpRoute(inspectHandler, makeHttpRequest(req));
  const payload = await response.json();
  expect(response.status).toStrictEqual(200);
  expect(payload.inspections[0]._tag).toStrictEqual('resolved');
  expect(payload.inspections[0].candidate.adapter).toStrictEqual({
    id: 'pasted-text',
    version: '1',
  });
});

testCase('source intake inspection rejects mixed file and pasted sources', async () => {
  const form = new FormData();
  form.set('destination', 'Assessment');
  form.set('purpose', 'recover_existing');
  form.set('files', new File(['question'], 'questions.txt', { type: 'text/plain' }));
  form.set('text', 'Question?\nA. One\nB. Two\nANSWER: A');
  const req = new Request('http://local/api/source-intake/inspect', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });

  const response = await invokeHttpRoute(inspectHandler, makeHttpRequest(req));
  const payload = await response.json();
  expect(response.status).toStrictEqual(400);
  expect(payload.error).toStrictEqual('Choose files or pasted text, not both.');
  expect(payload.code).toStrictEqual('invalid_request');
});

testCase('source intake execution durably prepares pasted text for conversion review', async () => {
  const form = new FormData();
  form.set('destination', 'Assessment');
  form.set('purpose', 'generate_new');
  form.set('text', 'Plate tectonics explains the movement of continents.');
  form.set('adapter-0', 'pasted-text@1');
  const req = new Request('http://local/api/source-intake/execute', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: form,
  });

  const objects = new Map<string, Uint8Array>();
  let sourceReadAttempts = 0;
  const storage: ObjectReadWriter = {
    putObject(input) {
      objects.set(input.key, input.data);
      return Promise.resolve();
    },
    readObject(key) {
      sourceReadAttempts += 1;
      if (sourceReadAttempts === 1) throw new Error('Transient source read failure.');
      const value = objects.get(key);
      if (!value) throw new Error(`Missing test object: ${key}`);
      return Promise.resolve(value);
    },
  };
  let runId = '';
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const auth = { tenantId, userId, role: 'owner' as const };
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `source-${tenantId.slice(0, 8)}`,
      name: 'Source Intake Test',
    });
    const email = `source-${userId.slice(0, 8)}@example.test`;
    await db.insert(users).values({ id: userId, email, emailNormalized: email });
    const response = await invokeHttpRoute(
      executeHandler,
      makeHttpRequest(req, { auth, state: workflowRouteState(storage) }),
    );
    const payload = await response.json();
    expect(response.status).toStrictEqual(202);
    expect(payload.purpose).toStrictEqual('generate_new');
    expect(typeof payload.batchId).toStrictEqual('string');
    expect(payload.runIds.length).toStrictEqual(1);
    runId = payload.runIds[0];
    expect(payload.redirectTo).toStrictEqual(`/imports/${runId}`);
    const queued = await getMigrationRun(auth, runId);
    expect(queued?.execution._tag).toStrictEqual('Queued');
    expect(queued?.artifacts.map((artifact) => artifact.kind)).toStrictEqual(['original']);

    const dispatches = await db.select({ id: workflowDispatches.id }).from(workflowDispatches)
      .where(eq(workflowDispatches.jobId, runId)).limit(1);
    const workflowExecutionId = dispatches[0]?.id;
    if (!workflowExecutionId) throw new Error('Expected source Workflow execution.');
    const sleeps: Array<{ readonly name: string; readonly duration: string }> = [];
    const outcome = await runSourceMigrationWorkflow(
      { jobId: runId, workflowExecutionId },
      {
        do: (_name, _config, operation) => operation(),
        sleep: (name, duration) => {
          sleeps.push({ name, duration });
          return Promise.resolve();
        },
      },
      { database: db, storage },
    );
    expect(outcome._tag).toStrictEqual('Completed');
    expect(outcome._tag === 'Completed' ? outcome.attempts : 0).toStrictEqual(2);
    expect(sleeps).toStrictEqual([{
      name: 'wait before source attempt 2',
      duration: '30 seconds',
    }]);

    const run = await getMigrationRun(auth, runId);
    expect(run?.purpose).toStrictEqual('generate_new');
    expect(run?.artifacts.map((artifact) => artifact.kind)).toStrictEqual([
      'original',
      'normalized',
    ]);
    expect(run?.artifacts[1].document?.blocks[0].kind).toStrictEqual('paragraph');
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId))
      .catch(() => undefined);
    if (runId) {
      await db.delete(conversionSourceArtifacts).where(
        eq(conversionSourceArtifacts.runId, runId),
      ).catch(() => undefined);
    }
    await db.delete(migrationRuns).where(eq(migrationRuns.tenantId, tenantId))
      .catch(() => undefined);
    await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId))
      .catch(() => undefined);
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(
      () => undefined,
    );
    await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

testCase('one recovered Respondus source opens its review workspace directly', async () => {
  const form = new FormData();
  form.set('destination', 'Assessment');
  form.set('purpose', 'recover_existing');
  form.set(
    'files',
    new File(
      ['1. Which value equals two plus two?\na. 3\n*b. 4\nPoints: 1'],
      'questions.respondus',
      { type: 'text/plain' },
    ),
  );
  form.set('adapter-0', 'respondus-standard@1');
  const req = new Request('http://local/api/source-intake/execute', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: form,
  });

  const objects = new Map<string, Uint8Array>();
  const storage: ObjectReadWriter = {
    putObject(input) {
      objects.set(input.key, input.data);
      return Promise.resolve();
    },
    readObject(key) {
      const value = objects.get(key);
      if (!value) throw new Error(`Missing test object: ${key}`);
      return Promise.resolve(value);
    },
  };
  let runId = '';
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const auth = { tenantId, userId, role: 'owner' as const };
  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `recovery-${tenantId.slice(0, 8)}`,
      name: 'Recovery Intake Test',
    });
    const email = `recovery-${userId.slice(0, 8)}@example.test`;
    await db.insert(users).values({ id: userId, email, emailNormalized: email });

    const response = await invokeHttpRoute(
      executeHandler,
      makeHttpRequest(req, { auth, state: workflowRouteState(storage) }),
    );
    const payload = await response.json();
    expect(response.status).toStrictEqual(202);
    expect(payload.purpose).toStrictEqual('recover_existing');
    expect(typeof payload.batchId).toStrictEqual('string');
    expect(payload.runIds.length).toStrictEqual(1);
    runId = payload.runIds[0];
    expect(payload.redirectTo).toStrictEqual(`/imports/${runId}`);
    expect((await getMigrationRun(auth, runId))?.execution._tag).toStrictEqual('Queued');
  } finally {
    await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId))
      .catch(() => undefined);
    await db.delete(migrationRuns).where(eq(migrationRuns.tenantId, tenantId))
      .catch(() => undefined);
    await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId))
      .catch(() => undefined);
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(
      () => undefined,
    );
    await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
    await shutdownDb().catch(() => undefined);
  }
});

testCase(
  'source intake remains accepted when immediate Workflow dispatch is unavailable',
  async () => {
    const form = new FormData();
    form.set('destination', 'Assessment');
    form.set('purpose', 'generate_new');
    form.set('text', 'Plate tectonics explains the movement of continents.');
    form.set('adapter-0', 'pasted-text@1');
    const req = new Request('http://local/api/source-intake/execute', {
      ...{ duplex: 'half' },
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: form,
    });
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const auth = { tenantId, userId, role: 'owner' as const };
    const storage: ObjectReadWriter = {
      putObject: () => Promise.resolve(),
      readObject: () => Promise.reject(new Error('Unexpected source read.')),
    };
    let runId = '';
    try {
      await db.insert(tenants).values({
        id: tenantId,
        slug: `deferred-${tenantId.slice(0, 8)}`,
        name: 'Deferred Source Dispatch Test',
      });
      const email = `deferred-${userId.slice(0, 8)}@example.test`;
      await db.insert(users).values({ id: userId, email, emailNormalized: email });

      const response = await invokeHttpRoute(
        executeHandler,
        makeHttpRequest(req, {
          auth,
          state: workflowRouteState(storage, 'fail'),
        }),
      );
      const payload = await response.json();
      expect(response.status).toStrictEqual(202);
      runId = payload.runIds[0];
      expect((await getMigrationRun(auth, runId))?.execution._tag).toStrictEqual('Queued');
      expect(
        await db.select({
          state: workflowDispatches.state,
          lastErrorCode: workflowDispatches.lastErrorCode,
        }).from(workflowDispatches).where(eq(workflowDispatches.jobId, runId)),
      ).toStrictEqual([{ state: 'pending', lastErrorCode: 'workflow_dispatch_failed' }]);
    } finally {
      await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId))
        .catch(() => undefined);
      if (runId) {
        await db.delete(conversionSourceArtifacts).where(eq(conversionSourceArtifacts.runId, runId))
          .catch(() => undefined);
      }
      await db.delete(migrationRuns).where(eq(migrationRuns.tenantId, tenantId))
        .catch(() => undefined);
      await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId))
        .catch(() => undefined);
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).catch(() => undefined);
      await db.delete(users).where(eq(users.id, userId)).catch(() => undefined);
      await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined);
      await shutdownDb().catch(() => undefined);
    }
  },
);

testCase('source intake execution blocks an unconfirmed recovery match', async () => {
  const form = new FormData();
  form.set('destination', 'Assessment');
  form.set('purpose', 'recover_existing');
  form.set(
    'files',
    new File(
      ['<quiz><question type="multichoice"></question></quiz>'],
      'quiz.xml',
      { type: 'application/xml' },
    ),
  );
  const req = new Request('http://local/api/source-intake/execute', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: form,
  });

  const response = await invokeHttpRoute(
    executeHandler,
    makeHttpRequest(req, { state: workflowRouteState() }),
  );
  const payload = await response.json();
  expect(response.status).toStrictEqual(422);
  expect(payload.error).toStrictEqual('Confirm the source format before continuing.');
  expect(payload.code).toStrictEqual('missing_selection');
});

function workflowRouteState(
  storage?: ObjectReadWriter,
  dispatch: 'succeed' | 'fail' = 'succeed',
): Record<string, unknown> {
  const instances = new Map<string, { readonly status: string }>();
  const instance = (id: string) => ({
    status: () => Promise.resolve(instances.get(id) ?? { status: 'unknown' }),
    restart: () => {
      instances.set(id, { status: 'queued' });
      return Promise.resolve();
    },
  });
  const workflow = {
    createBatch: (inputs: readonly { readonly id: string }[]) => {
      if (dispatch === 'fail') throw new Error('Workflow dispatch unavailable.');
      for (const input of inputs) {
        if (!instances.has(input.id)) instances.set(input.id, { status: 'queued' });
      }
      return Promise.resolve(inputs.map((input) => instance(input.id)));
    },
    get: (id: string) => {
      if (!instances.has(id)) throw new Error('Workflow instance not found.');
      return instance(id);
    },
  };
  return {
    ...(storage ? { storage } : {}),
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
}
