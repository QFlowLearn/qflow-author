import { expect, test as testCase } from 'vitest';

import { AIDraftParseFatalError } from '../lib/ai/draft_parser.ts';
import { OpenRouterGenerationError } from '../lib/ai/generation.ts';
import { OpenRouterRequestError } from '../lib/ai/openrouter.ts';
import {
  AIGenerationProviderConfigError,
  createAssessmentGenerationProvider,
} from '../lib/ai/assessment_generation_provider.ts';
import { classifyAIGenerationJobFailure } from '../lib/ai_generation_job.ts';
import { generationImportRoute as generateHandlerEndpoint } from '../lib/http/routes/import_api/generation.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const generateHandler = generateHandlerEndpoint.handle;

testCase('createAssessmentGenerationProvider rejects missing provider profile', () => {
  expect(() => createAssessmentGenerationProvider({ bindings: {} })).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof AIGenerationProviderConfigError &&
      caught.message.includes('Missing QFLOW_AI_PROVIDER. Expected "cloudflare" or "openrouter".')
    ),
  );
});

testCase('createAssessmentGenerationProvider rejects auto provider fallback', () => {
  expect(() =>
    createAssessmentGenerationProvider({
      bindings: {
        QFLOW_AI_PROVIDER: 'auto',
        AI: {
          run() {
            return Promise.resolve({ response: '[]' });
          },
        },
      },
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof AIGenerationProviderConfigError &&
      caught.message.includes('Invalid QFLOW_AI_PROVIDER. Expected "cloudflare" or "openrouter".')
    ),
  );
});

testCase(
  'createAssessmentGenerationProvider rejects explicit Cloudflare without AI binding',
  () => {
    expect(() =>
      createAssessmentGenerationProvider({
        bindings: {
          QFLOW_AI_PROVIDER: 'cloudflare',
        },
      })
    ).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof AIGenerationProviderConfigError &&
        caught.message.includes('QFLOW_AI_PROVIDER=cloudflare requires the AI binding.')
      ),
    );
  },
);

testCase('AI generation route reports missing provider configuration as unavailable', async () => {
  const workflow = {
    createBatch: () => Promise.resolve([]),
    get: () => {
      throw new Error('Workflow instance not found.');
    },
  };
  const response = await invokeHttpRoute(
    generateHandler,
    makeHttpRequest(
      new Request(`http://local/api/imports/${crypto.randomUUID()}/generate`, {
        ...{ duplex: 'half' },
        method: 'POST',
        body: JSON.stringify({}),
      }),
      {
        params: { id: crypto.randomUUID() },
        state: {
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
        },
      },
    ),
  );

  expect(response.status).toStrictEqual(503);
  expect(await response.json()).toStrictEqual({
    error: 'AI generation is not configured for this environment.',
  });
});

testCase('AI generation failure policy makes model-output failures permanent', () => {
  const generationCause = new OpenRouterGenerationError('OpenRouter content was empty.');
  expect(classifyAIGenerationJobFailure(generationCause)).toStrictEqual({
    _tag: 'Permanent',
    code: 'model',
    message: 'The AI provider did not return usable assessment questions.',
    cause: generationCause,
  });
  const parseCause = new AIDraftParseFatalError(
    'Could not extract JSON question array from AI response.',
  );
  expect(classifyAIGenerationJobFailure(parseCause)).toStrictEqual({
    _tag: 'Permanent',
    code: 'model',
    message: 'The AI provider did not return usable assessment questions.',
    cause: parseCause,
  });
});

testCase(
  'AI generation failure policy distinguishes rejected and retryable provider requests',
  () => {
    expect(
      classifyAIGenerationJobFailure(
        new OpenRouterRequestError('Bad request.', {
          attempt: 1,
          status: 400,
          retryable: false,
          failureClass: 'http',
          message: 'Bad request.',
        }),
      )._tag,
    ).toStrictEqual('Permanent');
    expect(
      classifyAIGenerationJobFailure(
        new OpenRouterRequestError('Rate limited.', {
          attempt: 1,
          status: 429,
          retryable: true,
          failureClass: 'http',
          message: 'Rate limited.',
        }),
      )._tag,
    ).toStrictEqual('Retryable');
  },
);

testCase('AI generation failure policy keeps generic dependency failures retryable', () => {
  expect(classifyAIGenerationJobFailure(new Error('database unavailable'))._tag).toStrictEqual(
    'Retryable',
  );
});
