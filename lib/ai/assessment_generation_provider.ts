import {
  type AIGenerationParserInput,
  mapOpenRouterChatCompletionToParserInput,
} from './generation.ts';
import {
  type CloudflareWorkersAiBinding,
  convertCloudflareFileToMarkdown,
  createCloudflareWorkersAiClient,
} from './cloudflare_workers.ts';
import {
  createOpenRouterClientFromEnv,
  type OpenRouterChatCompletionsRequest,
  type OpenRouterChatContentPart,
  type OpenRouterMode,
  postChatCompletionsWithRetry,
} from './openrouter.ts';
import { encodeBase64 } from '../base64.ts';
import { awaitWithAbortSignal } from '../cancellation.ts';
import { getEnv } from '../config.ts';
import { getRuntimeBinding, type RuntimeSource } from '../runtime.ts';
import type { AIGenerationReference } from './generation_reference.ts';

/** Source file made available to an assessment-generation provider. */
export type AssessmentGenerationSourceFile = {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
};

/** Provider-neutral generation command assembled by the conversion service. */
export type AssessmentGenerationProviderRequest = {
  readonly mode: OpenRouterMode;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly sourceFile: AssessmentGenerationSourceFile | undefined;
  readonly maxTokens: number;
  readonly temperature: number;
};

/** Safe operational identity included with provider telemetry. */
export type AssessmentGenerationOperation = {
  readonly tenantId: string;
  readonly conversionRunId: string;
};

/** Service-facing assessment-generation capability implemented by one configured provider. */
export type AssessmentGenerationProvider = {
  readonly generationProvider: AIGenerationReference['provider'];
  prepareSourceMaterial(
    sourceText: string,
    sourceFile: AssessmentGenerationSourceFile | undefined,
    options?: { readonly signal?: AbortSignal },
  ): Promise<string>;
  generate(
    request: AssessmentGenerationProviderRequest,
    operation: AssessmentGenerationOperation,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIGenerationParserInput>;
};

/** Signals invalid or missing AI provider configuration at a composition boundary. */
export class AIGenerationProviderConfigError extends Error {
  readonly _tag = 'AIGenerationProviderConfigError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AIGenerationProviderConfigError';
  }
}

/** Parse runtime configuration and construct one typed assessment-generation provider. */
export function createAssessmentGenerationProvider(
  runtime: RuntimeSource,
): AssessmentGenerationProvider {
  const configured = getEnv('QFLOW_AI_PROVIDER', runtime)?.trim().toLowerCase();
  if (configured === 'cloudflare') return createCloudflareProvider(runtime);
  if (configured === 'openrouter') return createOpenRouterProvider(runtime);
  if (!configured) {
    throw new AIGenerationProviderConfigError(
      'Missing QFLOW_AI_PROVIDER. Expected "cloudflare" or "openrouter".',
    );
  }
  throw new AIGenerationProviderConfigError(
    'Invalid QFLOW_AI_PROVIDER. Expected "cloudflare" or "openrouter".',
  );
}

function createCloudflareProvider(runtime: RuntimeSource): AssessmentGenerationProvider {
  const binding = parseCloudflareAiBinding(getRuntimeBinding(runtime, 'AI'));
  if (!binding) {
    throw new AIGenerationProviderConfigError(
      'QFLOW_AI_PROVIDER=cloudflare requires the AI binding.',
    );
  }
  const client = createCloudflareWorkersAiClient(binding, (key) => getEnv(key, runtime));
  return {
    generationProvider: 'cloudflare_workers_ai',
    async prepareSourceMaterial(sourceText, sourceFile, options = {}) {
      if (!sourceFile) return sourceText;
      const markdown = await awaitWithAbortSignal(
        convertCloudflareFileToMarkdown(binding, {
          name: sourceFile.filename,
          blob: new Blob([arrayBufferFromBytes(sourceFile.bytes)], {
            type: sourceFile.mimeType,
          }),
        }),
        options,
      );
      return [
        sourceText,
        `Attached source file: ${sourceFile.filename}`,
        markdown,
      ].filter((part) => part.length > 0).join('\n\n').trim();
    },
    generate(request, _operation, options = {}) {
      return awaitWithAbortSignal(
        client.runChatCompletion(buildChatPayload(request, request.userPrompt)),
        options,
      );
    },
  };
}

function createOpenRouterProvider(runtime: RuntimeSource): AssessmentGenerationProvider {
  const client = createOpenRouterClientFromEnv((key) => getEnv(key, runtime));
  return {
    generationProvider: 'openrouter_chat_completions',
    prepareSourceMaterial(sourceText, sourceFile) {
      return Promise.resolve(
        sourceFile
          ? `${sourceText}\n\nAttached source file: ${sourceFile.filename}`.trim()
          : sourceText,
      );
    },
    async generate(request, operation, options = {}) {
      const payload = buildChatPayload(
        request,
        buildOpenRouterUserContent(request.userPrompt, request.sourceFile),
      );
      const response = await postChatCompletionsWithRetry(client, payload, {
        onAttemptFailure(failure) {
          console.error(JSON.stringify({
            event: 'openrouter_chat_completion_failure',
            tenantId: operation.tenantId,
            conversionRunId: operation.conversionRunId,
            mode: payload.mode,
            attempt: failure.attempt,
            failureClass: failure.failureClass,
            status: failure.status,
            retryable: failure.retryable,
          }));
        },
        signal: options.signal,
      });
      return mapOpenRouterChatCompletionToParserInput(response, payload.mode);
    },
  };
}

function buildChatPayload(
  request: AssessmentGenerationProviderRequest,
  userContent: string | OpenRouterChatContentPart[],
): OpenRouterChatCompletionsRequest {
  return {
    mode: request.mode,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: userContent },
    ],
    plugins: request.sourceFile && Array.isArray(userContent)
      ? [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }]
      : undefined,
  };
}

function buildOpenRouterUserContent(
  prompt: string,
  sourceFile: AssessmentGenerationSourceFile | undefined,
): string | OpenRouterChatContentPart[] {
  if (!sourceFile) return prompt;
  return [
    { type: 'text', text: prompt },
    {
      type: 'file',
      file: {
        filename: sourceFile.filename,
        file_data: `data:${sourceFile.mimeType};base64,${encodeBase64(sourceFile.bytes)}`,
      },
    },
  ];
}

function parseCloudflareAiBinding(input: unknown): CloudflareWorkersAiBinding | null {
  if (!input || typeof input !== 'object') return null;
  if (typeof (input as { readonly run?: unknown }).run !== 'function') return null;
  // SAFETY: the composition boundary established the exact binding operation used by the adapter.
  return input as CloudflareWorkersAiBinding;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
