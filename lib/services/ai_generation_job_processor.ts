import type { AssessmentGenerationProvider } from '../ai/assessment_generation_provider.ts';
import { AIGenerationLeaseLostError } from '../conversion/generation_checkpoint.ts';
import {
  type ConversionGenerationResult,
  generateQuestionsForConversionRun,
} from '../conversion/generate_from_run.ts';
import type { QflowDatabase } from '../db.ts';
import { getMigrationRun } from '../import/migration_run_queries.ts';
import type { ObjectReader } from '../storage_contract.ts';
import { workerContext } from '../tenants.ts';
import {
  type ClaimedAIGenerationJob,
  markAIGenerationJobProgress,
  storeAIGenerationProviderCheckpoint,
} from './ai_generation_job_store.ts';

export async function processAIGenerationJob(
  job: ClaimedAIGenerationJob,
  options: {
    readonly onProgress?: (progress: number) => Promise<void> | void;
    readonly database: QflowDatabase;
    readonly storage: ObjectReader;
    readonly provider: AssessmentGenerationProvider;
    readonly signal?: AbortSignal;
  },
): Promise<ConversionGenerationResult> {
  const database = options.database;
  if (job.status !== 'running' || !job.leaseToken) {
    throw new AIGenerationLeaseLostError(job.id);
  }
  const leaseToken = job.leaseToken;
  if (job.output?._tag === 'completed') {
    throw new Error('Completed AI generation output cannot belong to a running job.');
  }
  const worker = workerContext(job.tenantId, job.userId);
  const run = await getMigrationRun(worker, job.conversionRunId, database);
  if (!run) throw new Error('Conversion run not found for AI generation job.');
  options.signal?.throwIfAborted();
  const result = await generateQuestionsForConversionRun({
    ctx: worker,
    run,
    job: {
      id: job.id,
      conversionRunId: job.conversionRunId,
      tenantId: job.tenantId,
      leaseToken,
      input: job.input,
    },
    provider: options.provider,
    providerCheckpoint: job.output?._tag === 'provider_result' ? job.output : null,
    onProviderCheckpoint: (checkpoint) =>
      storeAIGenerationProviderCheckpoint(job.id, leaseToken, checkpoint, database),
    onProgress: async (progress) => {
      await markAIGenerationJobProgress(job.id, leaseToken, progress, database);
      await options.onProgress?.(progress);
    },
    database,
    storage: options.storage,
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  return result;
}
