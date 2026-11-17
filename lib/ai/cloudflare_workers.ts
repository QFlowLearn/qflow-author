import { getEnv } from '../config.ts';
import type { AIGenerationParserInput, AIGenerationUsage } from './generation.ts';
import type { OpenRouterChatCompletionsRequest, OpenRouterMode } from './openrouter.ts';

export const CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.6';

export type CloudflareWorkersAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  toMarkdown?: CloudflareMarkdownConverter;
};

export type CloudflareMarkdownConverter = {
  (files: CloudflareMarkdownDocument | CloudflareMarkdownDocument[]): Promise<unknown>;
  (): CloudflareMarkdownConverterHandle;
};

export type CloudflareMarkdownConverterHandle = {
  transform(
    files: CloudflareMarkdownDocument | CloudflareMarkdownDocument[],
  ): Promise<unknown>;
  supported(): Promise<unknown>;
};

export type CloudflareMarkdownDocument = {
  name: string;
  blob: Blob;
};

export type CloudflareWorkersAiClient = {
  model: string;
  runChatCompletion(
    payload: OpenRouterChatCompletionsRequest,
  ): Promise<AIGenerationParserInput>;
};

export class CloudflareWorkersAiError extends Error {
  code: 'provider_config' | 'source_conversion' | 'model';

  constructor(
    message: string,
    code: 'provider_config' | 'source_conversion' | 'model' = 'model',
  ) {
    super(message);
    this.name = 'CloudflareWorkersAiError';
    this.code = code;
  }
}

export async function convertCloudflareFileToMarkdown(
  binding: CloudflareWorkersAiBinding,
  document: CloudflareMarkdownDocument,
): Promise<string> {
  if (!binding.toMarkdown) {
    throw new CloudflareWorkersAiError(
      'Workers AI markdown conversion is not available.',
      'provider_config',
    );
  }
  const raw = await binding.toMarkdown(document);
  return mapCloudflareMarkdownResult(raw);
}

export function createCloudflareWorkersAiClient(
  binding: CloudflareWorkersAiBinding,
  readEnv: (key: string) => string | undefined = getEnv,
): CloudflareWorkersAiClient {
  const configuredModel = readEnv('QFLOW_CLOUDFLARE_AI_MODEL')?.trim();
  const model = configuredModel || CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL;
  return {
    model,
    async runChatCompletion(payload) {
      const raw = await binding.run(model, {
        messages: payload.messages,
        max_tokens: payload.max_tokens,
        temperature: payload.temperature,
        stream: false,
      });
      return mapCloudflareWorkersAiResponse(raw, payload.mode, model);
    },
  };
}

export function mapCloudflareWorkersAiResponse(
  payload: unknown,
  mode: OpenRouterMode,
  model: string,
): AIGenerationParserInput {
  const obj = asRecord(payload, 'Workers AI response payload must be an object.');
  const choices = Array.isArray(obj.choices) ? obj.choices : undefined;
  const content = choices?.length ? parseChoiceContent(choices[0]) : parseResponseText(obj);
  if (!content) {
    throw new CloudflareWorkersAiError('Workers AI response content was empty.');
  }

  return {
    source: 'cloudflare_workers_ai',
    mode,
    model: typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : model,
    content,
    usage: parseUsage(obj.usage),
    raw: payload,
  };
}

export function mapCloudflareMarkdownResult(payload: unknown): string {
  const result = Array.isArray(payload) ? payload[0] : payload;
  const obj = asRecord(result, 'Workers AI markdown conversion result must be an object.');
  if (obj.format === 'error') {
    const message = typeof obj.error === 'string' && obj.error.trim()
      ? obj.error.trim()
      : 'Workers AI markdown conversion failed.';
    throw new CloudflareWorkersAiError(message, 'source_conversion');
  }
  const data = typeof obj.data === 'string' ? obj.data.trim() : '';
  if (!data) {
    throw new CloudflareWorkersAiError(
      'Workers AI markdown conversion returned empty content.',
      'source_conversion',
    );
  }
  return data;
}

function parseChoiceContent(value: unknown): string {
  const choice = asRecord(value, 'Workers AI response choice must be an object.');
  const message = choice.message && typeof choice.message === 'object'
    ? choice.message as Record<string, unknown>
    : undefined;
  return parseContent(message?.content ?? choice.text);
}

function parseResponseText(obj: Record<string, unknown>): string {
  return parseContent(obj.response ?? obj.result ?? obj.text);
}

function parseContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  const parts: string[] = [];
  for (const part of value) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    }
  }
  return parts.join('').trim();
}

function parseUsage(value: unknown): AIGenerationUsage {
  const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    promptTokens: asOptionalNumber(usage.prompt_tokens ?? usage.promptTokens),
    completionTokens: asOptionalNumber(usage.completion_tokens ?? usage.completionTokens),
    totalTokens: asOptionalNumber(usage.total_tokens ?? usage.totalTokens),
  };
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CloudflareWorkersAiError(message);
  }
  return value as Record<string, unknown>;
}
