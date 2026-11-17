import { and, eq, sql } from 'drizzle-orm';

import type { AIGeneratedSourceCitation } from '../ai/generation.ts';
import { db, type QflowDatabase } from '../db.ts';
import {
  aiGenerationJobsTable,
  aiUsageTable,
  migrationBatches,
  migrationItems,
  migrationRuns,
} from '../db/schema.ts';
import { emptyMigrationCounts } from '../import/migration_analysis.ts';
import {
  migrationItemContentHash,
  migrationItemContextHash,
} from '../import/migration_item_content.ts';
import { toMigrationJsonColumn } from '../import/migration_run_store.ts';
import type { MigrationRunRecord } from '../import/migration_types.ts';
import { buildQtiPreviewXml } from '../qti_preview.ts';
import type { WorkerContext } from '../tenants.ts';
import type { Draft } from '../types/draft.ts';
import type { QuestionReviewSuggestion } from '../question_review_types.ts';
import {
  assessBlueprintCoverage,
  type DefinedAssessmentBlueprint,
  parseAssessmentBlueprint,
  requireDefinedAssessmentBlueprint,
} from '../assessment_blueprint.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import {
  type AIGenerationCompletedOutput,
  AIGenerationLeaseLostError,
} from './generation_checkpoint.ts';
import { validateGeneratedEvidence } from './source_evidence.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';

/** One valid generated draft and its model-provided source citations. */
export type GeneratedDraftPreview = {
  readonly index: number;
  readonly typeId: 'single_select' | 'multi_select' | 'text_entry';
  readonly title: string;
  readonly draft: Draft;
  readonly blueprintTargetId: string;
  readonly reviewSuggestions: readonly QuestionReviewSuggestion[];
  readonly citations: AIGeneratedSourceCitation[];
};

type GenerationCompletion = {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly jobInput: {
    readonly mode: 'fast' | 'thorough';
    readonly blueprint: DefinedAssessmentBlueprint;
  };
  readonly output: AIGenerationCompletedOutput;
  readonly auditMetadata: Record<string, unknown>;
};

/** Persist generated items and complete their owned job in one transaction. */
export async function persistGeneratedConversionItems(
  ctx: WorkerContext,
  run: MigrationRunRecord,
  preview: GeneratedDraftPreview[],
  sourceTruncated: boolean,
  completion: GenerationCompletion,
  database: QflowDatabase = db,
): Promise<void> {
  if (!preview.length) throw new Error('AI generation produced no valid questions.');
  const coverage = assessBlueprintCoverage(
    completion.jobInput.blueprint,
    preview.map((entry) => ({
      blueprintTargetId: entry.blueprintTargetId,
      questionType: entry.typeId,
    })),
  );
  if (!coverage.complete) {
    throw new Error('Generated questions do not exactly match the assessment blueprint.');
  }
  const normalized = run.artifacts.find((artifact) => artifact.kind === 'normalized');
  if (!normalized) {
    throw new Error('Conversion run is missing its normalized source artifact.');
  }
  const original = run.artifacts.find((artifact) => artifact.kind === 'original');
  if (!original) {
    throw new Error('Conversion run is missing its original source artifact.');
  }

  const now = new Date();
  const prepared = await Promise.all(preview.map(async (entry, index) => {
    const href = `generated/question-${index + 1}.xml`;
    const validatedEvidence = validateGeneratedEvidence({
      artifactId: normalized.id,
      artifactHash: normalized.sha256,
      document: normalized.document,
      citations: entry.citations,
    });
    const warnings = [
      ...validatedEvidence.errors.map((message) => ({
        code: 'INVALID_SOURCE_CITATION',
        message,
        path: href,
      })),
      ...(sourceTruncated
        ? [{
          code: 'SOURCE_TRUNCATED',
          message: 'The model received a truncated source representation.',
          path: href,
        }]
        : []),
    ];
    const qti = buildQtiPreviewXml(entry.draft, { identifier: `generated-${index + 1}` });
    if (!qti.ok) {
      warnings.push({
        code: 'QTI_PREVIEW_INVALID',
        message: qti.issues.map((issue) => issue.message).join(' '),
        path: href,
      });
    }
    const readiness = !validatedEvidence.anchors.length ||
        validatedEvidence.errors.length ||
        !qti.ok
      ? 'blocked' as const
      : sourceTruncated || normalized.document.uncertainties.length
      ? 'major_review' as const
      : 'ready' as const;
    const sourceIdentifier = `generated-${index + 1}`;
    const sourceXml = qti.ok ? qti.xml : '';
    const importedDraft = toMigrationJsonColumn(entry.draft);
    const contentHash = await migrationItemContentHash({
      sourceName: run.sourceFilename,
      title: entry.title,
      itemType: entry.typeId,
      sourceHref: href,
      sourceIdentifier,
      sourceXml,
      importedDraft,
      blueprintTargetId: entry.blueprintTargetId,
      reviewSuggestions: entry.reviewSuggestions,
      warnings,
      assets: [],
    });
    const contextHash = await migrationItemContextHash({
      readiness,
      sourceArtifact: {
        id: original.id,
        filename: original.filename,
        mimeType: original.mimeType,
        size: original.size,
        sha256: original.sha256,
      },
      normalizedSourceSha256: normalized.sha256,
      evidence: validatedEvidence.anchors,
      extractionUncertainties: normalized.document.uncertainties,
      review: {
        decision: 'pending',
        note: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });
    return {
      id: crypto.randomUUID(),
      runId: run.id,
      sourceHref: href,
      sourceIdentifier,
      title: entry.title,
      itemType: entry.typeId,
      position: index + 1,
      readiness,
      warnings: warnings as unknown as Array<Record<string, unknown>>,
      sourceXml,
      importedDraft,
      blueprintTargetId: entry.blueprintTargetId,
      reviewSuggestions: entry.reviewSuggestions as unknown as Array<Record<string, unknown>>,
      evidence: validatedEvidence.anchors as unknown as Array<Record<string, unknown>>,
      extractionUncertainties: normalized.document.uncertainties as unknown as Array<
        Record<string, unknown>
      >,
      contentHash,
      contextHash,
      decision: 'pending' as const,
      createdAt: now,
    };
  }));
  const placements = prepared.map((item) => ({
    href: item.sourceHref,
    refIdentifier: item.sourceIdentifier,
  }));
  const itemTypeCounts = prepared.reduce<Record<string, number>>((counts, item) => {
    counts[item.itemType] = (counts[item.itemType] ?? 0) + 1;
    return counts;
  }, {});

  await database.transaction(async (tx) => {
    const ownedJob = await tx.select({
      id: aiGenerationJobsTable.id,
      input: aiGenerationJobsTable.input,
    })
      .from(aiGenerationJobsTable)
      .where(and(
        eq(aiGenerationJobsTable.id, completion.jobId),
        eq(aiGenerationJobsTable.tenantId, ctx.tenantId),
        eq(aiGenerationJobsTable.conversionRunId, run.id),
        eq(aiGenerationJobsTable.status, 'running'),
        eq(aiGenerationJobsTable.leaseToken, completion.leaseToken),
      ))
      .for('update')
      .limit(1);
    if (!ownedJob.length) throw new AIGenerationLeaseLostError(completion.jobId);
    if (
      canonicalJsonStringify(ownedJob[0].input) !==
      canonicalJsonStringify(completion.jobInput)
    ) {
      throw new Error('AI generation job input changed before completion.');
    }

    const lockedRun = await tx.select({
      purpose: migrationBatches.purpose,
      status: migrationRuns.status,
      blueprint: migrationRuns.blueprint,
    }).from(migrationRuns)
      .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
      .where(and(
        eq(migrationRuns.id, run.id),
        eq(migrationRuns.tenantId, ctx.tenantId),
      )).for('update').limit(1);
    if (
      lockedRun[0]?.purpose !== 'generate_new' ||
      lockedRun[0]?.status !== 'analyzed'
    ) {
      throw new Error('AI generation requires an analyzed generate-from-source run.');
    }
    const lockedBlueprint = requireDefinedAssessmentBlueprint(
      parseAssessmentBlueprint(lockedRun[0].blueprint),
    );
    if (
      canonicalJsonStringify(lockedBlueprint) !==
      canonicalJsonStringify(completion.jobInput.blueprint)
    ) {
      throw new Error('AI generation job and conversion blueprint disagree.');
    }

    const existingItems = await tx.select({ id: migrationItems.id })
      .from(migrationItems)
      .where(eq(migrationItems.runId, run.id))
      .limit(1);
    if (existingItems.length) {
      throw new Error('AI generation cannot replace existing conversion questions.');
    }

    await tx.insert(migrationItems).values(prepared);
    await tx.insert(aiUsageTable).values({
      id: completion.jobId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      model: completion.output.generation.model,
      generationMode: completion.output.generation.mode,
      inputTokens: completion.output.result.providerUsage.promptTokens,
      outputTokens: completion.output.result.providerUsage.completionTokens,
      totalTokens: completion.output.result.providerUsage.totalTokens,
      questionsGenerated: completion.output.result.persistedCount,
    });
    await recordAuditEventInTransaction(tx, {
      eventId: completion.jobId,
      tenantId: ctx.tenantId,
      action: 'assessment_generation_completed',
      actorUserId: ctx.userId,
      metadata: completion.auditMetadata,
    });
    await tx.update(migrationRuns).set({
      organizationGroups: [],
      adapterId: 'ai-generation',
      adapterLabel: 'AI generation',
      adapterVersion: '1',
      parts: [{
        id: crypto.randomUUID(),
        title: 'Generated questions',
        placements,
        options: {},
      }],
      summary: toMigrationJsonColumn({
        title: run.sourceFilename,
        counts: {
          ...emptyMigrationCounts(),
          parts: 1,
          items: prepared.length,
          warnings: prepared.reduce((sum, item) => sum + item.warnings.length, 0),
          ready: prepared.filter((item) => item.readiness === 'ready').length,
          reviewNeeded: prepared.filter((item) => item.readiness === 'major_review').length,
          blocked: prepared.filter((item) => item.readiness === 'blocked').length,
        },
        warningCounts: countWarnings(prepared),
        itemTypeCounts,
      }),
      updatedAt: sql`now()`,
    }).where(and(
      eq(migrationRuns.id, run.id),
      eq(migrationRuns.tenantId, ctx.tenantId),
    ));

    const completed = await tx.update(aiGenerationJobsTable).set({
      status: 'completed',
      progress: 100,
      output: completion.output,
      error: null,
      leaseToken: null,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(and(
      eq(aiGenerationJobsTable.id, completion.jobId),
      eq(aiGenerationJobsTable.status, 'running'),
      eq(aiGenerationJobsTable.leaseToken, completion.leaseToken),
    )).returning({ id: aiGenerationJobsTable.id });
    if (!completed.length) throw new AIGenerationLeaseLostError(completion.jobId);
  });
}

function countWarnings(
  items: ReadonlyArray<{ readonly warnings: Array<Record<string, unknown>> }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const warning of item.warnings) {
      const code = warning.code;
      if (typeof code !== 'string') continue;
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return counts;
}
