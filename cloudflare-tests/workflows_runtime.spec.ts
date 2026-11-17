import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { dispatchWorkflowOutbox } from '../deploy/cloudflare/workflows.entry.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { getDb } from '../lib/db.ts';
import {
  aiGenerationJobsTable,
  aiUsageTable,
  auditLogs,
  conversionSourceArtifacts,
  migrationBatches,
  migrationItems,
  migrationRuns,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { buildEmptyMigrationSummary } from '../lib/import/migration_analysis.ts';
import { sha256Hex } from '../lib/sha256.ts';

import { testAssessmentBlueprint } from '../tests/assessment_blueprint_fixture.ts';

const bindings = env;
const sourceWorkflow = bindings.QFLOW_SOURCE_MIGRATION_WORKFLOW;
const aiWorkflow = bindings.QFLOW_AI_GENERATION_WORKFLOW;

describe('Cloudflare Workflow entrypoints', () => {
  it('reconciles a persisted source job when its workerd instance already exists', async () => {
    const instanceId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const source = new TextEncoder().encode(
      'Photosynthesis turns light energy into chemical energy.',
    );
    const sourceHash = await sha256Hex(source);
    const storageKey = `conversion-sources/${tenantId}/${jobId}/original/${sourceHash}`;
    const runtime = { bindings };
    const database = getDb(runtime);
    const instance = await introspectWorkflowInstance(sourceWorkflow, instanceId);

    try {
      await bindings.QFLOW_UPLOADS.put(storageKey, source, {
        httpMetadata: { contentType: 'text/plain' },
      });
      await database.insert(tenants).values({
        id: tenantId,
        slug: `workflow-${tenantId.slice(0, 8)}`,
        name: 'Workflow runtime test',
      });
      const email = `workflow-${userId.slice(0, 8)}@example.test`;
      await database.insert(users).values({ id: userId, email, emailNormalized: email });
      await database.insert(migrationBatches).values({
        id: batchId,
        tenantId,
        createdBy: userId,
        createdBySnapshot: { id: userId, email },
        purpose: 'generate_new',
        idempotencyKey: crypto.randomUUID(),
        requestFingerprint: '0'.repeat(64),
        sourceCount: 1,
      });
      await database.insert(migrationRuns).values({
        destination: 'Assessment',
        id: jobId,
        batchId,
        batchPosition: 1,
        tenantId,
        sourceFilename: 'lesson.txt',
        sourceMime: 'text/plain',
        sourceSize: source.byteLength,
        adapterId: 'source-extraction',
        adapterLabel: 'Source extraction',
        adapterVersion: '1',
        status: 'queued',
        parts: [],
        summary: buildEmptyMigrationSummary(),
        blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
        attempts: 0,
        maxAttempts: 3,
        leaseToken: null,
        lastError: null,
        startedAt: null,
        completedAt: null,
        approvalStatus: 'draft',
        submittedBy: null,
        submittedAt: null,
        decidedBy: null,
        decidedAt: null,
        approvalNote: null,
        assessmentId: null,
        committedAt: null,
      });
      await database.insert(conversionSourceArtifacts).values({
        id: artifactId,
        runId: jobId,
        kind: 'original',
        filename: 'lesson.txt',
        mimeType: 'text/plain',
        size: source.byteLength,
        sha256: sourceHash,
        storageKey,
        document: null,
      });
      await database.insert(workflowDispatches).values({
        id: instanceId,
        kind: 'source_migration',
        jobId,
        tenantId,
        state: 'pending',
        workflowStatus: null,
        attempts: 0,
        lastErrorCode: null,
        startedAt: null,
        completedAt: null,
        lastCheckedAt: null,
      });

      // Reproduce the crash window after platform creation but before the outbox row is activated.
      await sourceWorkflow.create({ id: instanceId, params: { jobId } });
      const firstDispatch = await dispatchWorkflowOutbox(bindings);
      expect(firstDispatch.ok).toBe(true);
      if (!firstDispatch.ok) throw new Error('Expected Workflow dispatch to succeed.');
      expect(firstDispatch.dispatched).toBe(1);
      await instance.waitForStatus('complete');
      const terminalDispatch = await dispatchWorkflowOutbox(bindings);
      expect(terminalDispatch.ok).toBe(true);
      if (!terminalDispatch.ok) throw new Error('Expected Workflow reconciliation to succeed.');
      expect(firstDispatch.completed + terminalDispatch.completed).toBe(1);

      expect(await instance.getOutput()).toEqual({ _tag: 'Completed', jobId, attempts: 1 });
      expect((await (await sourceWorkflow.get(instanceId)).status()).status).toBe('complete');
      const runs = await database.select({
        status: migrationRuns.status,
        attempts: migrationRuns.attempts,
      }).from(migrationRuns).where(eq(migrationRuns.id, jobId));
      expect(runs).toEqual([{
        status: 'analyzed',
        attempts: 1,
      }]);
      const artifacts = await database.select({ kind: conversionSourceArtifacts.kind })
        .from(conversionSourceArtifacts)
        .where(eq(conversionSourceArtifacts.runId, jobId));
      expect(artifacts.map((artifact) => artifact.kind).sort()).toEqual(['normalized', 'original']);
      expect(
        await database.select({
          state: workflowDispatches.state,
          workflowStatus: workflowDispatches.workflowStatus,
        }).from(workflowDispatches).where(eq(workflowDispatches.id, instanceId)),
      ).toEqual([{ state: 'complete', workflowStatus: 'complete' }]);
    } finally {
      await instance.dispose();
      await database.delete(workflowDispatches).where(eq(workflowDispatches.id, instanceId));
      await database.delete(conversionSourceArtifacts).where(
        eq(conversionSourceArtifacts.runId, jobId),
      );
      await database.delete(migrationRuns).where(eq(migrationRuns.id, jobId));
      await database.delete(migrationBatches).where(eq(migrationBatches.id, batchId));
      await database.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await database.delete(users).where(eq(users.id, userId));
      await database.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  it('resumes and completes a persisted AI job through the real workerd binding', async () => {
    const instanceId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const originalArtifactId = crypto.randomUUID();
    const normalizedArtifactId = crypto.randomUUID();
    const blueprint = testAssessmentBlueprint([
      { id: 'choice-target', questionType: 'single_select', count: 1 },
    ]);
    const runtime = { bindings };
    const database = getDb(runtime);
    const instance = await introspectWorkflowInstance(aiWorkflow, instanceId);

    try {
      await database.insert(tenants).values({
        id: tenantId,
        slug: `workflow-ai-${tenantId.slice(0, 8)}`,
        name: 'AI Workflow runtime test',
      });
      const email = `workflow-ai-${userId.slice(0, 8)}@example.test`;
      await database.insert(users).values({ id: userId, email, emailNormalized: email });
      await database.insert(migrationBatches).values({
        id: batchId,
        tenantId,
        createdBy: userId,
        createdBySnapshot: { id: userId, email },
        purpose: 'generate_new',
        idempotencyKey: crypto.randomUUID(),
        requestFingerprint: 'a'.repeat(64),
        sourceCount: 1,
      });
      await database.insert(migrationRuns).values({
        destination: 'Assessment',
        id: runId,
        batchId,
        batchPosition: 1,
        tenantId,
        sourceFilename: 'plate-tectonics.pdf',
        sourceMime: 'application/pdf',
        sourceSize: 55,
        adapterId: 'source-extraction',
        adapterLabel: 'Source extraction',
        adapterVersion: '1',
        status: 'analyzed',
        parts: [],
        summary: buildEmptyMigrationSummary(),
        blueprint,
        attempts: 1,
        maxAttempts: 3,
        leaseToken: null,
        lastError: null,
        startedAt: null,
        completedAt: new Date(),
        approvalStatus: 'draft',
        submittedBy: null,
        submittedAt: null,
        decidedBy: null,
        decidedAt: null,
        approvalNote: null,
        assessmentId: null,
        committedAt: null,
      });
      await database.insert(conversionSourceArtifacts).values([
        {
          id: originalArtifactId,
          runId,
          kind: 'original',
          filename: 'plate-tectonics.pdf',
          mimeType: 'application/pdf',
          size: 55,
          sha256: 'a'.repeat(64),
          storageKey: `workflow-ai/${runId}/original`,
          document: null,
        },
        {
          id: normalizedArtifactId,
          runId,
          kind: 'normalized',
          filename: 'plate-tectonics.pdf.normalized.json',
          mimeType: 'application/vnd.qflow.structured-source+json',
          size: 55,
          sha256: 'b'.repeat(64),
          storageKey: `workflow-ai/${runId}/normalized`,
          document: {
            version: 1,
            title: 'Plate tectonics',
            sourceKind: 'pdf',
            blocks: [{
              id: 'block-1',
              kind: 'paragraph',
              text: 'Tectonic plates move slowly across Earth’s mantle.',
              page: 1,
            }],
            text: 'Tectonic plates move slowly across Earth’s mantle.',
            uncertainties: [],
          },
        },
      ]);
      await database.insert(aiGenerationJobsTable).values({
        id: jobId,
        tenantId,
        conversionRunId: runId,
        userId,
        status: 'queued',
        progress: 70,
        input: { mode: 'fast', blueprint },
        output: {
          _tag: 'provider_result',
          generation: {
            provider: 'openrouter_chat_completions',
            mode: 'fast',
            model: 'checkpoint/test-model',
            promptVersion: 'qflow.assessment-generation.v1',
          },
          content: JSON.stringify([{
            type: 'single_select',
            title: 'Plate motion',
            bodyHtml: '<p>What moves slowly across Earth’s mantle?</p>',
            choices: [
              { id: 'A', text: 'Tectonic plates' },
              { id: 'B', text: 'Clouds' },
            ],
            correctId: 'A',
            blueprintTargetId: 'choice-target',
            reviewSuggestions: [],
            citations: [{
              kind: 'page',
              page: 1,
              quote: 'Tectonic plates move slowly',
            }],
          }]),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          source: {
            totalChars: 75,
            includedChars: 75,
            maxChars: 24000,
            truncated: false,
            fileBacked: true,
          },
          allowance: {
            plan: 'free',
            limit: 10,
            used: 0,
            remaining: 10,
            resetDate: '2026-02-01T00:00:00.000Z',
            allowThorough: false,
            maxQuestionsPerGeneration: 5,
          },
        },
        attempts: 0,
        maxAttempts: 3,
        leaseToken: null,
        startedAt: null,
        completedAt: null,
      });
      await database.insert(workflowDispatches).values({
        id: instanceId,
        kind: 'ai_generation',
        jobId,
        tenantId,
        state: 'pending',
        workflowStatus: null,
        attempts: 0,
        lastErrorCode: null,
        startedAt: null,
        completedAt: null,
        lastCheckedAt: null,
      });

      const firstDispatch = await dispatchWorkflowOutbox(bindings);
      expect(firstDispatch.ok).toBe(true);
      if (!firstDispatch.ok) throw new Error('Expected AI Workflow dispatch to succeed.');
      expect(firstDispatch.dispatched).toBe(1);
      await instance.waitForStatus('complete');
      const terminalDispatch = await dispatchWorkflowOutbox(bindings);
      expect(terminalDispatch.ok).toBe(true);
      if (!terminalDispatch.ok) throw new Error('Expected AI Workflow reconciliation to succeed.');
      expect(firstDispatch.completed + terminalDispatch.completed).toBe(1);

      expect(await instance.getOutput()).toEqual({ _tag: 'Completed', jobId, attempts: 1 });
      expect((await (await aiWorkflow.get(instanceId)).status()).status).toBe('complete');
      expect(
        await database.select({
          status: aiGenerationJobsTable.status,
          progress: aiGenerationJobsTable.progress,
          attempts: aiGenerationJobsTable.attempts,
          leaseToken: aiGenerationJobsTable.leaseToken,
        }).from(aiGenerationJobsTable).where(eq(aiGenerationJobsTable.id, jobId)),
      ).toEqual([{ status: 'completed', progress: 100, attempts: 1, leaseToken: null }]);
      expect(
        await database.select({ id: migrationItems.id }).from(migrationItems)
          .where(eq(migrationItems.runId, runId)),
      ).toHaveLength(1);
      expect(
        await database.select({ questionsGenerated: aiUsageTable.questionsGenerated })
          .from(aiUsageTable).where(eq(aiUsageTable.id, jobId)),
      ).toEqual([{ questionsGenerated: 1 }]);
      expect(
        await database.select({
          state: workflowDispatches.state,
          workflowStatus: workflowDispatches.workflowStatus,
          lastErrorCode: workflowDispatches.lastErrorCode,
        }).from(workflowDispatches).where(eq(workflowDispatches.id, instanceId)),
      ).toEqual([{
        state: 'complete',
        workflowStatus: 'complete',
        lastErrorCode: null,
      }]);
    } finally {
      await instance.dispose();
      await database.delete(workflowDispatches).where(eq(workflowDispatches.id, instanceId));
      await database.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await database.delete(aiUsageTable).where(eq(aiUsageTable.tenantId, tenantId));
      await database.delete(migrationItems).where(eq(migrationItems.runId, runId));
      await database.delete(aiGenerationJobsTable).where(eq(aiGenerationJobsTable.id, jobId));
      await database.delete(conversionSourceArtifacts).where(
        eq(conversionSourceArtifacts.runId, runId),
      );
      await database.delete(migrationRuns).where(eq(migrationRuns.id, runId));
      await database.delete(migrationBatches).where(eq(migrationBatches.id, batchId));
      await database.delete(users).where(eq(users.id, userId));
      await database.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  it('restarts a terminated instance through the production dispatcher', async () => {
    const instanceId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const missingJobId = crypto.randomUUID();
    const runtime = { bindings };
    const database = getDb(runtime);
    const instance = await introspectWorkflowInstance(sourceWorkflow, instanceId);

    try {
      await database.insert(tenants).values({
        id: tenantId,
        slug: `workflow-restart-${tenantId.slice(0, 8)}`,
        name: 'Workflow restart runtime test',
      });
      const created = await sourceWorkflow.create({
        id: instanceId,
        params: { jobId: missingJobId },
      });
      await created.terminate();
      await instance.waitForStatus('terminated');
      await database.insert(workflowDispatches).values({
        id: instanceId,
        kind: 'source_migration',
        jobId: missingJobId,
        tenantId,
        state: 'active',
        workflowStatus: 'terminated',
        attempts: 0,
        lastErrorCode: 'workflow_terminated',
        startedAt: new Date(),
        completedAt: null,
        lastCheckedAt: new Date(),
      });

      expect(await dispatchWorkflowOutbox(bindings)).toEqual({
        ok: true,
        dispatched: 0,
        reconciled: 1,
        completed: 0,
      });
      expect(
        await database.select({
          state: workflowDispatches.state,
          workflowStatus: workflowDispatches.workflowStatus,
          attempts: workflowDispatches.attempts,
          lastErrorCode: workflowDispatches.lastErrorCode,
        }).from(workflowDispatches).where(eq(workflowDispatches.id, instanceId)),
      ).toEqual([{
        state: 'active',
        workflowStatus: 'queued',
        attempts: 1,
        lastErrorCode: null,
      }]);
    } finally {
      await instance.dispose();
      await database.delete(workflowDispatches).where(eq(workflowDispatches.id, instanceId));
      await database.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await database.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });
});
