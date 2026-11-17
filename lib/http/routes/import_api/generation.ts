import { defineHttpRoute, type HttpRequest } from '../../route.ts';

import {
  AIGenerationJobInputError,
  parseAIGenerationJobInput,
} from '../../../ai_generation_job.ts';
import { enqueueAIGenerationJob } from '../../../services/ai_generation_job_store.ts';
import {
  AIGenerationProviderConfigError,
  createAssessmentGenerationProvider,
} from '../../../ai/assessment_generation_provider.ts';
import { OpenRouterConfigError } from '../../../ai/openrouter.ts';
import { checkAIGenerationAllowance } from '../../../services/ai_usage.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { assessmentBlueprintQuestionCount } from '../../../assessment_blueprint.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
  WorkflowBindingConfigError,
} from '../../../workflows/workflow_dispatch.ts';

export const generationImportRoute = defineHttpRoute('/api/imports/:id/generate', {
  'POST': handle,
});

async function parseRequest(req: Request) {
  const value: unknown = await req.json();
  return parseAIGenerationJobInput(value);
}

function isGenerationConfigurationFailure(
  cause: unknown,
): cause is WorkflowBindingConfigError | AIGenerationProviderConfigError | OpenRouterConfigError {
  return cause instanceof WorkflowBindingConfigError ||
    cause instanceof AIGenerationProviderConfigError ||
    cause instanceof OpenRouterConfigError;
}

function configurationFailureTag(
  cause: WorkflowBindingConfigError | AIGenerationProviderConfigError | OpenRouterConfigError,
): string {
  if (cause instanceof WorkflowBindingConfigError) return cause._tag;
  if (cause instanceof AIGenerationProviderConfigError) return cause._tag;
  return 'OpenRouterConfigError';
}

async function handle(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);

  try {
    requireWorkflowBindings(ctx.runtime);
    createAssessmentGenerationProvider(ctx.runtime);
  } catch (cause: unknown) {
    if (isGenerationConfigurationFailure(cause)) {
      console.error(JSON.stringify({
        event: 'ai_generation_configuration_invalid',
        errorTag: configurationFailureTag(cause),
      }));
      return Response.json({ error: 'AI generation is not configured for this environment.' }, {
        status: 503,
      });
    }
    throw cause;
  }

  try {
    const input = await parseRequest(ctx.req);
    const allowance = await checkAIGenerationAllowance(auth, {
      mode: input.mode,
      requestedQuestions: assessmentBlueprintQuestionCount(input.blueprint),
    });
    if (!allowance.allowed) {
      return Response.json({ error: 'AI generation is not available for this request.' }, {
        status: 403,
      });
    }
    const job = await enqueueAIGenerationJob(auth, ctx.params.id, input);
    const dispatch = await dispatchPendingWorkflowJobs(ctx.runtime, {
      jobIds: [job.id],
      tenantId: auth.tenantId,
    });
    if (!dispatch.ok) {
      console.error(JSON.stringify({
        event: 'ai_generation_workflow_dispatch_deferred',
        jobId: job.id,
        errorTag: dispatch.error._tag,
      }));
    }
    return Response.json({
      jobId: job.id,
      status: job.status,
      pollUrl: `/api/imports/${ctx.params.id}/generate/jobs/${job.id}`,
    }, { status: 202 });
  } catch (cause: unknown) {
    if (cause instanceof AIGenerationJobInputError) {
      return Response.json({ error: cause.message }, { status: 422 });
    }
    if (cause instanceof SyntaxError) {
      return Response.json({ error: 'Enter valid generation settings.' }, { status: 422 });
    }
    console.error(JSON.stringify({ event: 'ai_generation_start_failed' }));
    return Response.json({ error: 'QFlowLearn could not start AI generation.' }, { status: 500 });
  }
}
