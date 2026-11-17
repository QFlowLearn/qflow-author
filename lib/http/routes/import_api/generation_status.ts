import { defineHttpRoute, type HttpRequest } from '../../route.ts';

import { getAIGenerationJob } from '../../../services/ai_generation_job_store.ts';
import { getMigrationRun } from '../../../import/migration_run_queries.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const generationStatusImportRoute = defineHttpRoute(
  '/api/imports/:id/generate/jobs/:jobId',
  { 'GET': handle },
);

async function handle(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const run = await getMigrationRun(auth, ctx.params.id);
  if (!run) return new Response('Not Found', { status: 404 });
  const job = await getAIGenerationJob(auth, run.id, ctx.params.jobId);
  if (!job) return new Response('Not Found', { status: 404 });
  return Response.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  });
}
