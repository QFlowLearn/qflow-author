import { awaitWithAbortSignal } from '../cancellation.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { getRuntimeBinding, type RuntimeSource } from '../runtime.ts';
import type { CloudflareWorkersAiBinding } from './cloudflare_workers.ts';
import { type EnrichmentAIConfig, isEnrichmentRecord } from './bank_enrichment_config.ts';

/** A bounded, non-streaming request; the caller reserves its maximum cost before execution. */
export type EnrichmentAIRequest = {
  readonly system: string;
  readonly data: string;
  readonly schema: Readonly<Record<string, unknown>>;
};
/** Provider usage is retained even when classification JSON is invalid. */
export type EnrichmentAIUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
  readonly requestId: string;
};
/** A receipt never includes provider error text, secrets or a raw binding value. */
export type EnrichmentAIReceipt =
  | { readonly ok: true; readonly content: string; readonly usage: EnrichmentAIUsage }
  | {
    readonly ok: false;
    readonly code: 'aborted' | 'provider_failed' | 'invalid_response';
    readonly usage: EnrichmentAIUsage | null;
  };
/** Intentional external capability, supplied only at the composition seam. */
export type EnrichmentAIProvider = (
  request: EnrichmentAIRequest,
  options?: { readonly signal?: AbortSignal },
) => Promise<EnrichmentAIReceipt>;

/** Fixed per-request output ceiling includes reasoning tokens. */
export const ENRICHMENT_MAX_OUTPUT_TOKENS = 8192;
/** Upper bound for serialized data, schema and instructions before adding token framing reserve. */
export const ENRICHMENT_MAX_REQUEST_BYTES = 196_608;

/** Bound prompt cost conservatively using UTF-8 bytes, never a characters/4 estimate. */
export function enrichmentRequestInputBound(request: EnrichmentAIRequest): number | null {
  const bytes = new TextEncoder().encode(JSON.stringify(request)).length;
  return bytes <= ENRICHMENT_MAX_REQUEST_BYTES ? bytes + 4096 : null;
}

/** One provider attempt only. Durable orchestration owns retries and reserves each attempt. */
export function createEnrichmentAIProvider(
  binding: CloudflareWorkersAiBinding,
  config: EnrichmentAIConfig,
): EnrichmentAIProvider {
  return async (request, options = {}) => {
    const { signal } = options;
    if (signal?.aborted) return { ok: false, code: 'aborted', usage: null };
    if (enrichmentRequestInputBound(request) === null) {
      return { ok: false, code: 'invalid_response', usage: null };
    }
    try {
      const raw = await awaitWithAbortSignal(
        binding.run(config.model, {
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.data },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'bank_enrichment', strict: true, schema: request.schema },
          },
          max_completion_tokens: ENRICHMENT_MAX_OUTPUT_TOKENS,
          // The supported deployed chat templates accept `thinking: false` for direct JSON output.
          chat_template_kwargs: { thinking: false },
          temperature: 0,
          stream: false,
          store: false,
        }),
        { signal },
      );
      if (signal?.aborted) return { ok: false, code: 'aborted', usage: null };
      return parseEnrichmentAIReceipt(raw);
    } catch (cause: unknown) {
      if (signal?.aborted) return { ok: false, code: 'aborted', usage: null };
      console.error('Enrichment provider attempt failed', safeErrorSummary(cause));
      return { ok: false, code: 'provider_failed', usage: null };
    }
  };
}

/** Validate the raw Cloudflare binding only at the runtime composition seam. */
export function createRuntimeEnrichmentAIProvider(
  runtime: RuntimeSource,
  config: EnrichmentAIConfig,
): EnrichmentAIProvider {
  const binding = getRuntimeBinding(runtime, 'AI');
  if (!isEnrichmentRecord(binding) || typeof binding.run !== 'function') {
    throw new Error('Enrichment requires the Cloudflare AI binding.');
  }
  // SAFETY: the adapter checked the run capability; every returned provider value is parsed below.
  return createEnrichmentAIProvider(binding as CloudflareWorkersAiBinding, config);
}

/** The supported Workers AI models use one non-streaming chat-completion response contract. */
export function parseEnrichmentAIReceipt(raw: unknown): EnrichmentAIReceipt {
  const usage = parseUsage(raw);
  if (!isEnrichmentRecord(raw) || !Array.isArray(raw.choices) || raw.choices.length !== 1) {
    return { ok: false, code: 'invalid_response', usage };
  }
  const choice: unknown = raw.choices[0];
  if (
    !isEnrichmentRecord(choice) || choice.finish_reason !== 'stop' ||
    !isEnrichmentRecord(choice.message)
  ) {
    return { ok: false, code: 'invalid_response', usage };
  }
  const content = choice.message.content;
  if (
    !usage || typeof content !== 'string' || !content.trim() ||
    new TextEncoder().encode(content).length > 524_288
  ) {
    return { ok: false, code: 'invalid_response', usage };
  }
  return { ok: true, content, usage };
}

function parseUsage(raw: unknown): EnrichmentAIUsage | null {
  if (
    !isEnrichmentRecord(raw) || !isEnrichmentRecord(raw.usage) ||
    typeof raw.model !== 'string' || raw.model.length < 1 || raw.model.length > 256 ||
    typeof raw.id !== 'string' || raw.id.length < 1 || raw.id.length > 256
  ) return null;
  const inputTokens = raw.usage.prompt_tokens;
  const outputTokens = raw.usage.completion_tokens;
  if (!tokenCount(inputTokens) || !tokenCount(outputTokens)) return null;
  return { inputTokens, outputTokens, model: raw.model, requestId: raw.id };
}

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
    value <= 10_000_000;
}
