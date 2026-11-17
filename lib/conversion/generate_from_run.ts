import {
  type AIGenerationParserInput,
  type AIGenerationUsage,
  ASSESSMENT_GENERATION_PROMPT_VERSION,
  buildAssessmentGenerationPrompt,
  FILE_SOURCE_MATERIAL_PROMPT_CHARS,
  sourceMaterialForPrompt,
} from '../ai/generation.ts';
import {
  type AssessmentGenerationProvider,
  type AssessmentGenerationProviderRequest,
} from '../ai/assessment_generation_provider.ts';
import type { AIGenerationReference } from '../ai/generation_reference.ts';
import { parseAIGeneratedDrafts } from '../ai/draft_parser.ts';
import type { OpenRouterMode } from '../ai/openrouter.ts';
import { awaitWithAbortSignal } from '../cancellation.ts';
import type { QflowDatabase } from '../db.ts';
import type { MigrationRunRecord } from '../import/migration_types.ts';
import { type AIGenerationAllowance, checkAIGenerationAllowance } from '../services/ai_usage.ts';
import type { ObjectReader } from '../storage_contract.ts';
import type { WorkerContext } from '../tenants.ts';
import {
  assessmentBlueprintQuestionCount,
  type DefinedAssessmentBlueprint,
} from '../assessment_blueprint.ts';
import { type GeneratedDraftPreview, persistGeneratedConversionItems } from './generated_items.ts';
import {
  type AIGenerationAllowanceSnapshot,
  type AIGenerationProviderCheckpoint,
  type AIGenerationSourceSummary,
  checkpointFromParserInput,
  parserInputFromCheckpoint,
} from './generation_checkpoint.ts';
import { renderSourceForGeneration } from './source_evidence.ts';
import { pdfNeedsFileExtraction } from './extract_pdf_source.ts';

const MAX_AI_SOURCE_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ConversionGenerationInput = {
  mode: OpenRouterMode;
  blueprint: DefinedAssessmentBlueprint;
};

type LoadedSourceFile = {
  filename: string;
  mimeType: string;
  artifactId: string;
  size: number;
  bytes: Uint8Array;
};

/** Generated question preview and usage facts returned to the owning worker. */
export type ConversionGenerationResult = {
  readonly preview: readonly GeneratedDraftPreview[];
  readonly providerUsage: AIGenerationUsage;
  readonly totals: {
    readonly requested: number;
    readonly parsed: number;
    readonly preview: number;
  };
  readonly source: AIGenerationSourceSummary;
  readonly usage: AIGenerationAllowanceSnapshot;
};

/**
 * Conversion-owned generation orchestrator.
 * Job queue plumbing stays in ai_generation_jobs; this module owns run grounding + persistence.
 */
export async function generateQuestionsForConversionRun(input: {
  ctx: WorkerContext;
  run: MigrationRunRecord;
  job: {
    id: string;
    conversionRunId: string;
    tenantId: string;
    leaseToken: string;
    input: ConversionGenerationInput;
  };
  providerCheckpoint: AIGenerationProviderCheckpoint | null;
  onProviderCheckpoint: (checkpoint: AIGenerationProviderCheckpoint) => Promise<void>;
  onProgress?: (progress: number) => Promise<void> | void;
  database: QflowDatabase;
  storage: ObjectReader;
  provider: AssessmentGenerationProvider;
  signal?: AbortSignal;
}): Promise<ConversionGenerationResult> {
  const { ctx, run, job, provider } = input;
  if (run.purpose !== 'generate_new') {
    throw new Error('AI generation requires a generate-from-source conversion run.');
  }
  if (run.execution._tag !== 'Analyzed' || run.items.length) {
    throw new Error('AI generation requires an analyzed conversion with no existing questions.');
  }

  const count = assessmentBlueprintQuestionCount(job.input.blueprint);
  const resolvedGeneration = await resolveGenerationInput({
    checkpoint: input.providerCheckpoint,
    ctx,
    run,
    provider,
    job,
    database: input.database,
    storage: input.storage,
    persist: input.onProviderCheckpoint,
    onProgress: input.onProgress,
    signal: input.signal,
  });
  const parserInput = resolvedGeneration.parserInput;
  const sourceSummary = resolvedGeneration.source;
  const allowance = resolvedGeneration.allowance;

  input.signal?.throwIfAborted();
  await input.onProgress?.(70);
  const parsedDrafts = parseAIGeneratedDrafts(parserInput.content, job.input.blueprint);

  const preview: GeneratedDraftPreview[] = parsedDrafts.drafts.map((parsed) => ({
    index: parsed.index,
    typeId: parsed.typeId as GeneratedDraftPreview['typeId'],
    title: parsed.title,
    draft: {
      ...parsed.serializedDraft,
      type: parsed.typeId,
      title: parsed.title,
    },
    blueprintTargetId: parsed.blueprintTargetId,
    reviewSuggestions: parsed.reviewSuggestions,
    citations: parsed.citations,
  }));

  input.signal?.throwIfAborted();
  await input.onProgress?.(90);
  input.signal?.throwIfAborted();
  const auditMetadata = {
    conversionRunId: job.conversionRunId,
    provider: parserInput.source,
    mode: job.input.mode,
    model: parserInput.model,
    promptVersion: resolvedGeneration.generation.promptVersion,
    requestedCount: count,
    blueprint: job.input.blueprint,
    promptTokens: parserInput.usage.promptTokens,
    completionTokens: parserInput.usage.completionTokens,
    totalTokens: parserInput.usage.totalTokens,
    parsedCount: parsedDrafts.total,
    previewCount: preview.length,
    errorCount: 0,
    sourceTruncated: sourceSummary.truncated,
    sourceTotalChars: sourceSummary.totalChars,
    sourceIncludedChars: sourceSummary.includedChars,
    sourceMaxChars: sourceSummary.maxChars,
    sourceFileBacked: sourceSummary.fileBacked,
    plan: allowance.plan,
    remaining: allowance.remaining,
    resetDate: allowance.resetDate,
  };

  const result = {
    preview,
    providerUsage: parserInput.usage,
    totals: {
      requested: count,
      parsed: parsedDrafts.total,
      preview: preview.length,
    },
    source: sourceSummary,
    usage: {
      plan: allowance.plan,
      limit: allowance.limit,
      used: allowance.used + 1,
      remaining: allowance.remaining === null ? null : Math.max(0, allowance.remaining - 1),
      resetDate: allowance.resetDate,
      allowThorough: allowance.allowThorough,
      maxQuestionsPerGeneration: allowance.maxQuestionsPerGeneration,
    },
  };
  input.signal?.throwIfAborted();
  await persistGeneratedConversionItems(ctx, run, preview, sourceSummary.truncated, {
    jobId: job.id,
    leaseToken: job.leaseToken,
    jobInput: job.input,
    output: {
      _tag: 'completed',
      generation: resolvedGeneration.generation,
      result: {
        requestedCount: result.totals.requested,
        parsedCount: result.totals.parsed,
        persistedCount: result.totals.preview,
        errorCount: 0,
        providerUsage: result.providerUsage,
      },
    },
    auditMetadata,
  }, input.database);
  return result;
}

async function resolveGenerationInput(input: {
  checkpoint: AIGenerationProviderCheckpoint | null;
  ctx: WorkerContext;
  run: MigrationRunRecord;
  provider: AssessmentGenerationProvider;
  job: {
    id: string;
    tenantId: string;
    conversionRunId: string;
    input: ConversionGenerationInput;
  };
  database: QflowDatabase;
  storage: ObjectReader;
  persist: (checkpoint: AIGenerationProviderCheckpoint) => Promise<void>;
  onProgress?: (progress: number) => Promise<void> | void;
  signal?: AbortSignal;
}): Promise<{
  readonly parserInput: AIGenerationParserInput;
  readonly generation: AIGenerationReference;
  readonly source: AIGenerationSourceSummary;
  readonly allowance: AIGenerationAllowanceSnapshot;
}> {
  input.signal?.throwIfAborted();
  if (input.checkpoint) {
    if (
      input.checkpoint.generation.provider !== input.provider.generationProvider ||
      input.checkpoint.generation.mode !== input.job.input.mode
    ) {
      throw new Error('Provider checkpoint does not match the active generation command.');
    }
    return {
      parserInput: parserInputFromCheckpoint(input.checkpoint),
      generation: input.checkpoint.generation,
      source: input.checkpoint.source,
      allowance: input.checkpoint.allowance,
    };
  }

  const allowance = await checkAIGenerationAllowance(input.ctx, {
    mode: input.job.input.mode,
    requestedQuestions: assessmentBlueprintQuestionCount(input.job.input.blueprint),
  }, input.database);
  input.signal?.throwIfAborted();
  if (!allowance.allowed) {
    throw new Error(allowanceFailureMessage(allowance.reason, allowance.maxQuestionsPerGeneration));
  }

  const normalized = input.run.artifacts.find((artifact) => artifact.kind === 'normalized');
  if (!normalized) {
    throw new Error('Conversion run is missing its normalized source artifact.');
  }
  const sourceFile = pdfNeedsFileExtraction(normalized.document)
    ? await loadConversionSourceFile(input.run, input.storage, { signal: input.signal })
    : undefined;
  const sourceMaterial = await input.provider.prepareSourceMaterial(
    renderSourceForGeneration(normalized.document),
    sourceFile,
    { signal: input.signal },
  );
  const sourceMaterialMaxChars = normalized.document.sourceKind === 'pdf'
    ? FILE_SOURCE_MATERIAL_PROMPT_CHARS
    : undefined;
  const source = buildSourceSummary(
    sourceMaterial,
    sourceMaterialMaxChars,
    Boolean(sourceFile),
  );
  const prompt = buildAssessmentGenerationPrompt({
    blueprint: input.job.input.blueprint,
    gradeLevel: 'Unspecified',
    brief: `Create questions grounded in ${input.run.sourceFilename}.`,
    sourceMaterial,
    sourceMaterialMaxChars,
    evidenceMode: normalized.document.sourceKind === 'pdf' ? 'page' : 'block',
    existingQuestions: [],
  });

  input.signal?.throwIfAborted();
  await input.onProgress?.(20);
  const request: AssessmentGenerationProviderRequest = {
    mode: input.job.input.mode,
    maxTokens: 4096,
    temperature: 0.3,
    systemPrompt:
      'You are an assessment authoring assistant. Return only machine-parseable JSON. No markdown.',
    userPrompt: prompt,
    sourceFile,
  };
  const parserInput = await input.provider.generate(request, input.job, {
    signal: input.signal,
  });
  input.signal?.throwIfAborted();
  const allowanceSnapshot = toAllowanceSnapshot(allowance);
  const checkpoint = checkpointFromParserInput(
    parserInput,
    ASSESSMENT_GENERATION_PROMPT_VERSION,
    source,
    allowanceSnapshot,
  );
  await input.persist(checkpoint);
  return {
    parserInput,
    generation: checkpoint.generation,
    source,
    allowance: allowanceSnapshot,
  };
}

function buildSourceSummary(
  sourceMaterial: string,
  maxChars: number | undefined,
  fileBacked: boolean,
): AIGenerationSourceSummary {
  return {
    ...sourceMaterialForPrompt(sourceMaterial, maxChars).stats,
    fileBacked,
  };
}

function toAllowanceSnapshot(
  allowance: AIGenerationAllowance,
): AIGenerationAllowanceSnapshot {
  return {
    plan: allowance.plan,
    limit: allowance.limit,
    used: allowance.used,
    remaining: allowance.remaining,
    resetDate: allowance.resetDate,
    allowThorough: allowance.allowThorough,
    maxQuestionsPerGeneration: allowance.maxQuestionsPerGeneration,
  };
}

async function loadConversionSourceFile(
  run: MigrationRunRecord,
  storage: ObjectReader,
  options: { readonly signal?: AbortSignal } = {},
): Promise<LoadedSourceFile | undefined> {
  const artifact = run.artifacts.find((entry) => entry.kind === 'original');
  if (!artifact) throw new Error('Original PDF artifact was not found.');
  if (artifact.size > MAX_AI_SOURCE_UPLOAD_BYTES) {
    throw new Error('AI source file must be 10 MB or smaller.');
  }
  const bytes = await awaitWithAbortSignal(
    storage.readObject(artifact.storageKey),
    options,
  );
  if (bytes.byteLength > MAX_AI_SOURCE_UPLOAD_BYTES) {
    throw new Error('AI source file must be 10 MB or smaller.');
  }
  return {
    filename: artifact.filename,
    mimeType: 'application/pdf',
    artifactId: artifact.id,
    size: artifact.size,
    bytes,
  };
}

function allowanceFailureMessage(
  reason: 'ok' | 'limit_exceeded' | 'upgrade_required' | 'question_limit',
  maxQuestionsPerGeneration: number,
): string {
  if (reason === 'upgrade_required') {
    return 'Thorough mode requires a Pro or Enterprise plan.';
  }
  if (reason === 'question_limit') {
    return `This plan supports up to ${maxQuestionsPerGeneration} questions per generation.`;
  }
  return 'AI generation limit reached for this billing period.';
}
