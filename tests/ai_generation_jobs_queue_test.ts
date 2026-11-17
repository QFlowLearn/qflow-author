import { expect, test as testCase } from 'vitest';

import { and, desc, eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  aiGenerationJobsTable,
  migrationBatches,
  migrationRuns,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { parseAIGenerationJobInput } from '../lib/ai_generation_job.ts';
import {
  claimAIGenerationJob,
  enqueueAIGenerationJob,
  markAIGenerationJobProgress,
  markAIGenerationJobRetry,
  storeAIGenerationProviderCheckpoint,
} from '../lib/services/ai_generation_job_store.ts';
import { AIGenerationLeaseLostError } from '../lib/conversion/generation_checkpoint.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';
import { updateMigrationRunBlueprint } from '../lib/import/migration_run_review.ts';
import { generationImportRoute as generateHandlerEndpoint } from '../lib/http/routes/import_api/generation.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const generateHandler = generateHandlerEndpoint.handle;

const DEFAULT_INPUT = parseAIGenerationJobInput({
  mode: 'fast',
  blueprint: testAssessmentBlueprint([
    { id: 'choice-target', questionType: 'single_select', count: 2 },
    { id: 'entry-target', questionType: 'text_entry', count: 1 },
  ]),
});

testCase('AI generation claims the exact job assigned to its Workflow instance', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assessmentA = crypto.randomUUID();
  const assessmentB = crypto.randomUUID();

  try {
    await seedJobQueueFixtures({
      tenantId,
      userId,
      assessmentId: assessmentA,
      assessmentSlug: 'queue-a',
    });
    await seedMigrationRun({
      tenantId,
      userId,
      assessmentId: assessmentB,
      assessmentSlug: 'queue-b',
    });
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };

    const first = await enqueueAIGenerationJob(ctx, assessmentA, DEFAULT_INPUT);
    await expect(
      Promise.resolve().then(() =>
        updateMigrationRunBlueprint(
          ctx,
          assessmentA,
          testAssessmentBlueprint([
            { id: 'replacement-target', questionType: 'single_select', count: 1 },
          ]),
        )
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('active AI generation job')
    );
    const replay = await enqueueAIGenerationJob(ctx, assessmentA, DEFAULT_INPUT);
    expect(replay.id).toStrictEqual(first.id);
    await expect(
      Promise.resolve().then(() =>
        enqueueAIGenerationJob(
          ctx,
          assessmentA,
          parseAIGenerationJobInput({
            mode: 'fast',
            blueprint: testAssessmentBlueprint([
              { id: 'different-target', questionType: 'single_select', count: 1 },
            ]),
          }),
        )
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('different generation command')
    );
    const savedBlueprint = await db.select({ blueprint: migrationRuns.blueprint })
      .from(migrationRuns)
      .where(eq(migrationRuns.id, assessmentA))
      .limit(1);
    expect(savedBlueprint[0].blueprint).toStrictEqual(DEFAULT_INPUT.blueprint);
    const second = await enqueueAIGenerationJob(ctx, assessmentB, DEFAULT_INPUT);

    const firstExecutionId = await workflowExecutionId(first.id);
    const claimedFirst = await claimAIGenerationJob(first.id, firstExecutionId);
    if (!claimedFirst) expect.unreachable('expected the assigned job to be claimed');
    expect(claimedFirst.id).toStrictEqual(first.id);
    expect(claimedFirst.status).toStrictEqual('running');
    expect(claimedFirst.attempts).toStrictEqual(1);
    const replayedFirst = await claimAIGenerationJob(first.id, firstExecutionId);
    expect(replayedFirst?.leaseToken).toStrictEqual(claimedFirst.leaseToken);
    expect(replayedFirst?.attempts).toStrictEqual(1);
    expect(await claimAIGenerationJob(first.id, crypto.randomUUID())).toStrictEqual(null);

    const claimedSecond = await claimAIGenerationJob(
      second.id,
      await workflowExecutionId(second.id),
    );
    if (!claimedSecond) {
      expect.unreachable('expected the second assigned job to be claimed independently');
    }
    expect(claimedSecond.id).toStrictEqual(second.id);
  } finally {
    await cleanupJobQueueFixtures({ tenantId, userId });
    await shutdownDb().catch(() => {});
  }
});

testCase(
  'generation jobs preserve checkpoints across retries and fence expired leases',
  async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const assessmentId = crypto.randomUUID();

    try {
      await seedJobQueueFixtures({
        tenantId,
        userId,
        assessmentId,
        assessmentSlug: 'queue-checkpoint',
      });
      const ctx: RequestContext = { tenantId, userId, role: 'owner' };
      const queued = await enqueueAIGenerationJob(ctx, assessmentId, DEFAULT_INPUT);
      const executionId = await workflowExecutionId(queued.id);
      const firstAttempt = await claimAIGenerationJob(queued.id, executionId);
      if (!(firstAttempt?.leaseToken)) expect.unreachable('expected first attempt lease');
      const checkpoint = {
        _tag: 'provider_result' as const,
        generation: {
          provider: 'openrouter_chat_completions' as const,
          mode: 'fast' as const,
          model: 'test/model',
          promptVersion: 'qflow.assessment-generation.v1',
        },
        content: '[{"type":"single_select"}]',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        source: {
          totalChars: 55,
          includedChars: 55,
          maxChars: 6000,
          truncated: false,
          fileBacked: false,
        },
        allowance: {
          plan: 'free' as const,
          limit: 10,
          used: 0,
          remaining: 10,
          resetDate: '2026-02-01T00:00:00.000Z',
          allowThorough: false,
          maxQuestionsPerGeneration: 5,
        },
      };
      await storeAIGenerationProviderCheckpoint(
        firstAttempt.id,
        firstAttempt.leaseToken,
        checkpoint,
      );
      await markAIGenerationJobRetry(
        firstAttempt.id,
        firstAttempt.leaseToken,
        executionId,
        'provider_request_retryable',
      );
      await markAIGenerationJobRetry(
        firstAttempt.id,
        firstAttempt.leaseToken,
        executionId,
        'provider_request_retryable',
      );

      const secondAttempt = await claimAIGenerationJob(queued.id, executionId);
      if (!(secondAttempt?.leaseToken)) expect.unreachable('expected second attempt lease');
      expect(secondAttempt.id).toStrictEqual(firstAttempt.id);
      expect(secondAttempt.output).toStrictEqual(checkpoint);
      await expect(
        Promise.resolve().then(() =>
          markAIGenerationJobProgress(firstAttempt.id, firstAttempt.leaseToken!, 80)
        ),
      ).rejects.toBeInstanceOf(AIGenerationLeaseLostError);
    } finally {
      await cleanupJobQueueFixtures({ tenantId, userId });
      await shutdownDb().catch(() => {});
    }
  },
);

testCase(
  'AI generation remains accepted when immediate Workflow dispatch is unavailable',
  async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    try {
      await seedJobQueueFixtures({
        tenantId,
        userId,
        assessmentId: runId,
        assessmentSlug: 'deferred-ai-dispatch',
      });
      const workflow = {
        createBatch: () => Promise.reject(new Error('Workflow dispatch unavailable.')),
        get: () => {
          throw new Error('Workflow instance not found.');
        },
      };
      const bindings = {
        QFLOW_SOURCE_MIGRATION_WORKFLOW: workflow,
        QFLOW_AI_GENERATION_WORKFLOW: workflow,
        QFLOW_RELEASE_BUILD_WORKFLOW: workflow,
        QFLOW_MIGRATION_COMMIT_WORKFLOW: workflow,
        QFLOW_BANK_ENRICHMENT_WORKFLOW: workflow,
        QFLOW_QUESTION_ORGANIZATION_WORKFLOW: workflow,
        QFLOW_ASSESSMENT_PRINT_WORKFLOW: workflow,
      };
      const response = await invokeHttpRoute(
        generateHandler,
        makeHttpRequest(
          new Request(`http://local/api/imports/${runId}/generate`, {
            ...{ duplex: 'half' },
            method: 'POST',
            body: JSON.stringify(DEFAULT_INPUT),
          }),
          {
            params: { id: runId },
            auth: { tenantId, userId, role: 'owner' },
            state: {
              runtime: {
                bindings: {
                  ...bindings,
                  QFLOW_AI_PROVIDER: 'openrouter',
                  OPENROUTER_API_KEY: 'test-key',
                  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
                  OPENROUTER_SITE_URL: 'https://qflow.test',
                  OPENROUTER_APP_NAME: 'QFlow Test',
                  OPENROUTER_MODEL_FAST: 'openrouter/fast',
                  OPENROUTER_MODEL_THOROUGH: 'openrouter/thorough',
                },
              },
            },
          },
        ),
      );
      const payload = await response.json();
      expect(response.status).toStrictEqual(202);
      expect(typeof payload.jobId).toStrictEqual('string');
      expect(payload.status).toStrictEqual('queued');
      expect(
        await db.select({
          state: workflowDispatches.state,
          lastErrorCode: workflowDispatches.lastErrorCode,
        }).from(workflowDispatches).where(eq(workflowDispatches.jobId, payload.jobId)),
      ).toStrictEqual([{ state: 'pending', lastErrorCode: 'workflow_dispatch_failed' }]);
    } finally {
      await cleanupJobQueueFixtures({ tenantId, userId });
      await shutdownDb().catch(() => {});
    }
  },
);

async function seedJobQueueFixtures(input: {
  tenantId: string;
  userId: string;
  assessmentId: string;
  assessmentSlug: string;
}) {
  await db.insert(tenants).values({
    id: input.tenantId,
    slug: `t-${input.tenantId.slice(0, 8)}`,
    name: 'Queue Test Tenant',
  });

  await db.insert(users).values({
    id: input.userId,
    email: `queue-${input.userId.slice(0, 8)}@example.com`,
    emailNormalized: `queue-${input.userId.slice(0, 8)}@example.com`,
    displayName: 'Queue Test User',
    authProvider: 'local',
    authProviderId: `queue-${input.userId.slice(0, 8)}`,
  });

  await seedMigrationRun(input);
}

async function workflowExecutionId(jobId: string): Promise<string> {
  const rows = await db.select({ id: workflowDispatches.id }).from(workflowDispatches).where(and(
    eq(workflowDispatches.kind, 'ai_generation'),
    eq(workflowDispatches.jobId, jobId),
  )).orderBy(desc(workflowDispatches.createdAt)).limit(1);
  if (!rows[0]) throw new Error(`Workflow execution not found for job ${jobId}.`);
  return rows[0].id;
}

async function seedMigrationRun(input: {
  tenantId: string;
  userId: string;
  assessmentId: string;
  assessmentSlug: string;
}) {
  const batchId = crypto.randomUUID();
  await db.insert(migrationBatches).values({
    id: batchId,
    tenantId: input.tenantId,
    createdBy: input.userId,
    createdBySnapshot: projectJsonPersistenceObject({
      id: input.userId,
      email: `queue-${input.userId.slice(0, 8)}@example.com`,
      displayName: 'Queue Test User',
    }),
    purpose: 'generate_new',
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'a'.repeat(64),
    sourceCount: 1,
  });
  await db.insert(migrationRuns).values({
    destination: 'Assessment',
    id: input.assessmentId,
    batchId,
    batchPosition: 1,
    tenantId: input.tenantId,
    sourceFilename: `${input.assessmentSlug}.txt`,
    sourceMime: 'text/plain',
    sourceSize: 10,
    adapterId: 'text-source',
    adapterLabel: 'Text source',
    adapterVersion: '1',
    blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
    status: 'analyzed',
    attempts: 0,
    maxAttempts: 3,
    approvalStatus: 'draft',
    completedAt: new Date(),
    parts: [],
    summary: {
      title: `${input.assessmentSlug}.txt`,
      counts: {
        parts: 0,
        items: 0,
        assets: 0,
        warnings: 0,
        ready: 0,
        reviewNeeded: 0,
        blocked: 0,
      },
      warningCounts: {},
      itemTypeCounts: {},
    },
  });
}

async function cleanupJobQueueFixtures(input: { tenantId: string; userId: string }) {
  try {
    await db.delete(workflowDispatches).where(
      eq(workflowDispatches.tenantId, input.tenantId),
    );
    await db.delete(aiGenerationJobsTable).where(
      eq(aiGenerationJobsTable.tenantId, input.tenantId),
    );
    await db.delete(migrationRuns).where(eq(migrationRuns.tenantId, input.tenantId));
    await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, input.tenantId));
  } catch {
    // ignore cleanup failures
  }
  try {
    await db.delete(tenants).where(eq(tenants.id, input.tenantId));
  } catch {
    // ignore cleanup failures
  }
  try {
    await db.delete(users).where(eq(users.id, input.userId));
  } catch {
    // ignore cleanup failures
  }
}
