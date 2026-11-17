import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
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
} from '../lib/db/schema.ts';
import { persistGeneratedConversionItems } from '../lib/conversion/generated_items.ts';
import { AIGenerationLeaseLostError } from '../lib/conversion/generation_checkpoint.ts';
import { commitMigrationRun } from '../lib/import/migration_run_commit.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import type { ObjectWriteLifecycle } from '../lib/storage_contract.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

const GENERATED_ITEM_LANGUAGE = newAuthoringItemLanguage();

const NO_ASSET_STORAGE: ObjectWriteLifecycle = {
  putObject() {
    throw new Error('This fixture does not contain package assets.');
  },
  deleteObject() {
    throw new Error('This fixture does not contain package assets.');
  },
};

testCase('generated questions and terminal job state commit under one active lease', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  try {
    await seedFixture({ tenantId, userId, runId, jobId, leaseToken });
    const run = await getMigrationRun(ctx, runId);
    if (!run) throw new Error('Generation fixture run was not created.');
    const preview = [{
      index: 0,
      typeId: 'single_select' as const,
      title: 'Plate motion',
      blueprintTargetId: 'choice-target',
      reviewSuggestions: [],
      draft: {
        type: 'single_select' as const,
        itemLanguage: GENERATED_ITEM_LANGUAGE,
        title: 'Plate motion',
        promptHtml: '',
        bodyHtml: '<p>What moves across Earth’s mantle?</p>',
        choices: [{ id: 'A', text: 'Tectonic plates' }, { id: 'B', text: 'Clouds' }],
        correctId: 'A',
        shuffle: false,
        required: true,
        tags: ['ai-generated'],
      },
      citations: [{
        kind: 'block' as const,
        blockId: 'block-1',
        quote: 'Tectonic plates move slowly',
      }],
    }];
    const generation = {
      provider: 'openrouter_chat_completions',
      model: 'test/model',
      mode: 'fast',
      promptVersion: 'qflow.assessment-generation.v1',
    } as const;

    await expect(
      Promise.resolve().then(() =>
        persistGeneratedConversionItems(ctx, run, preview, false, {
          jobId,
          leaseToken: crypto.randomUUID(),
          jobInput: {
            mode: 'fast',
            blueprint: testAssessmentBlueprint([
              { id: 'choice-target', questionType: 'single_select', count: 1 },
            ]),
          },
          output: {
            _tag: 'completed',
            generation,
            result: completedResult(),
          },
          auditMetadata: {},
        })
      ),
    ).rejects.toBeInstanceOf(AIGenerationLeaseLostError);
    expect(await itemCount(runId)).toStrictEqual(0);
    expect(await completionSideEffectCount(jobId)).toStrictEqual({ audit: 0, usage: 0 });

    await db.update(migrationRuns).set({
      blueprint: testAssessmentBlueprint([
        { id: 'changed-target', questionType: 'single_select', count: 1 },
      ]),
    }).where(eq(migrationRuns.id, runId));
    await expect(
      Promise.resolve().then(() =>
        persistGeneratedConversionItems(ctx, run, preview, false, {
          jobId,
          leaseToken,
          jobInput: {
            mode: 'fast',
            blueprint: testAssessmentBlueprint([
              { id: 'choice-target', questionType: 'single_select', count: 1 },
            ]),
          },
          output: {
            _tag: 'completed',
            generation,
            result: completedResult(),
          },
          auditMetadata: {},
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('job and conversion blueprint disagree')
    );
    expect(await itemCount(runId)).toStrictEqual(0);
    expect(await completionSideEffectCount(jobId)).toStrictEqual({ audit: 0, usage: 0 });
    await db.update(migrationRuns).set({
      blueprint: testAssessmentBlueprint([
        { id: 'choice-target', questionType: 'single_select', count: 1 },
      ]),
    }).where(eq(migrationRuns.id, runId));

    await persistGeneratedConversionItems(ctx, run, preview, false, {
      jobId,
      leaseToken,
      jobInput: {
        mode: 'fast',
        blueprint: testAssessmentBlueprint([
          { id: 'choice-target', questionType: 'single_select', count: 1 },
        ]),
      },
      output: {
        _tag: 'completed',
        generation,
        result: completedResult(),
      },
      auditMetadata: {},
    });
    expect(await itemCount(runId)).toStrictEqual(1);
    expect(await completionSideEffectCount(jobId)).toStrictEqual({ audit: 1, usage: 1 });
    const jobs = await db.select().from(aiGenerationJobsTable)
      .where(eq(aiGenerationJobsTable.id, jobId))
      .limit(1);
    expect(jobs[0]?.status).toStrictEqual('completed');
    expect(jobs[0]?.leaseToken).toStrictEqual(null);
    expect(jobs[0]?.output).toStrictEqual({
      _tag: 'completed',
      generation,
      result: completedResult(),
    });

    const generatedRun = await getMigrationRun(ctx, runId);
    const generatedItem = generatedRun?.items[0];
    if (!generatedItem) throw new Error('Generated item was not persisted.');
    await updateMigrationItems(
      ctx,
      runId,
      [generatedItem.id],
      { kind: 'accept' },
      {
        [generatedItem.id]: {
          contentHash: generatedItem.contentHash,
          contextHash: generatedItem.contextHash,
          decision: 'pending',
        },
      },
    );
    await commitMigrationRun(ctx, runId, {
      storage: NO_ASSET_STORAGE,
      approvedItemIds: [generatedItem.id],
      approval: true,
    });
    const committedItems = await db.select({
      questionId: migrationItems.createdQuestionId,
      revision: migrationItems.createdRevision,
    }).from(migrationItems).where(eq(migrationItems.id, generatedItem.id)).limit(1);
    const committedItem = committedItems[0];
    if (!committedItem?.questionId || !committedItem.revision) {
      throw new Error('Generated item was not committed as a question.');
    }
    const revision = await getQuestionRevision(
      ctx,
      committedItem.questionId,
      committedItem.revision,
    );
    if (!revision || revision.provenance.origin._tag !== 'Imported') {
      throw new Error('Generated question is missing its imported origin.');
    }
    expect(revision.provenance.origin.assistance).toStrictEqual({
      _tag: 'AiGenerated',
      jobId,
      generation,
    });
  } finally {
    await cleanup({ tenantId, userId, runId });
  }
});

async function seedFixture(input: {
  tenantId: string;
  userId: string;
  runId: string;
  jobId: string;
  leaseToken: string;
}): Promise<void> {
  await db.insert(tenants).values({
    id: input.tenantId,
    slug: `generation-${input.tenantId.slice(0, 8)}`,
    name: 'Generation Completion Test',
  });
  await db.insert(users).values({
    id: input.userId,
    email: `generation-${input.userId.slice(0, 8)}@example.com`,
    emailNormalized: `generation-${input.userId.slice(0, 8)}@example.com`,
    displayName: 'Generation Test User',
    authProvider: 'local',
    authProviderId: `generation-${input.userId.slice(0, 8)}`,
  });
  const batchId = crypto.randomUUID();
  await db.insert(migrationBatches).values({
    id: batchId,
    tenantId: input.tenantId,
    createdBy: input.userId,
    createdBySnapshot: projectJsonPersistenceObject({
      id: input.userId,
      email: `generation-${input.userId.slice(0, 8)}@example.com`,
      displayName: 'Generation Test User',
    }),
    purpose: 'generate_new',
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'a'.repeat(64),
    sourceCount: 1,
  });
  await db.insert(migrationRuns).values({
    destination: 'Assessment',
    id: input.runId,
    batchId,
    batchPosition: 1,
    tenantId: input.tenantId,
    sourceFilename: 'plate-tectonics.txt',
    sourceMime: 'text/plain',
    sourceSize: 55,
    adapterId: 'text-source',
    adapterLabel: 'Text source',
    adapterVersion: '1',
    blueprint: testAssessmentBlueprint([
      { id: 'choice-target', questionType: 'single_select', count: 1 },
    ]),
    status: 'analyzed',
    attempts: 0,
    maxAttempts: 3,
    approvalStatus: 'draft',
    completedAt: new Date(),
    parts: [],
    summary: {
      title: 'plate-tectonics.txt',
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
  const artifactHash = 'c'.repeat(64);
  await db.insert(conversionSourceArtifacts).values([
    {
      id: crypto.randomUUID(),
      runId: input.runId,
      kind: 'original',
      filename: 'plate-tectonics.txt',
      mimeType: 'text/plain',
      size: 55,
      sha256: 'd'.repeat(64),
      storageKey: `generation-test/${input.runId}/original`,
      document: null,
    },
    {
      id: crypto.randomUUID(),
      runId: input.runId,
      kind: 'normalized',
      filename: 'plate-tectonics.txt.normalized.json',
      mimeType: 'application/vnd.qflow.structured-source+json',
      size: 55,
      sha256: artifactHash,
      storageKey: `generation-test/${input.runId}/normalized`,
      document: {
        version: 1,
        title: 'Plate tectonics',
        sourceKind: 'text',
        blocks: [{
          id: 'block-1',
          kind: 'paragraph',
          text: 'Tectonic plates move slowly across Earth’s mantle.',
        }],
        text: 'Tectonic plates move slowly across Earth’s mantle.',
        uncertainties: [],
      },
    },
  ]);
  await db.insert(aiGenerationJobsTable).values({
    id: input.jobId,
    tenantId: input.tenantId,
    conversionRunId: input.runId,
    userId: input.userId,
    status: 'running',
    progress: 70,
    input: {
      mode: 'fast',
      blueprint: testAssessmentBlueprint([
        { id: 'choice-target', questionType: 'single_select', count: 1 },
      ]),
    },
    output: {
      _tag: 'provider_result',
      generation: {
        provider: 'openrouter_chat_completions',
        mode: 'fast',
        model: 'test/model',
        promptVersion: 'qflow.assessment-generation.v1',
      },
      content: '[]',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      source: {
        totalChars: 55,
        includedChars: 55,
        maxChars: 6000,
        truncated: false,
        fileBacked: false,
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
    attempts: 1,
    maxAttempts: 3,
    leaseToken: input.leaseToken,
    startedAt: new Date(),
  });
}

function completedResult() {
  return {
    requestedCount: 1,
    parsedCount: 1,
    persistedCount: 1,
    errorCount: 0,
    providerUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
}

async function itemCount(runId: string): Promise<number> {
  const rows = await db.select({ id: migrationItems.id })
    .from(migrationItems)
    .where(eq(migrationItems.runId, runId));
  return rows.length;
}

async function completionSideEffectCount(
  jobId: string,
): Promise<{ readonly audit: number; readonly usage: number }> {
  const [audit, usage] = await Promise.all([
    db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, jobId)),
    db.select({ id: aiUsageTable.id }).from(aiUsageTable).where(eq(aiUsageTable.id, jobId)),
  ]);
  return { audit: audit.length, usage: usage.length };
}

async function cleanup(input: {
  tenantId: string;
  userId: string;
  runId: string;
}): Promise<void> {
  try {
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, input.tenantId));
    await db.delete(aiUsageTable).where(eq(aiUsageTable.tenantId, input.tenantId));
    await db.delete(migrationRuns).where(eq(migrationRuns.id, input.runId));
    await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, input.tenantId));
    await db.delete(users).where(eq(users.id, input.userId));
    await db.delete(tenants).where(eq(tenants.id, input.tenantId));
  } catch {
    // Cleanup must not hide the primary assertion.
  } finally {
    await shutdownDb().catch(() => {});
  }
}
