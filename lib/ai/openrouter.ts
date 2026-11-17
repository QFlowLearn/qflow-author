import { getEnv } from '../config.ts';
import { sleepWithSignal } from '../cancellation.ts';

export const OPENROUTER_REQUIRED_ENV_KEYS = [
  'OPENROUTER_API_KEY',
] as const;

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = 'liquid/lfm-2.5-1.2b-instruct:free';
export const OPENROUTER_DEFAULT_SITE_URL = 'http://localhost:8000';
export const OPENROUTER_DEFAULT_APP_NAME = 'QFlowLearn';

export type OpenRouterEnvKey =
  | 'OPENROUTER_API_KEY'
  | 'OPENROUTER_BASE_URL'
  | 'OPENROUTER_MODEL_FAST'
  | 'OPENROUTER_MODEL_THOROUGH'
  | 'OPENROUTER_SITE_URL'
  | 'OPENROUTER_APP_NAME';
export type OpenRouterMode = 'fast' | 'thorough';

export type OpenRouterConfig = {
  apiKey: string;
  baseUrl: string;
  siteUrl: string;
  appName: string;
  models: Record<OpenRouterMode, string>;
};

export type OpenRouterEnvReader = (key: string) => string | undefined;

export class OpenRouterConfigError extends Error {
  readonly missingKeys: OpenRouterEnvKey[];

  constructor(message: string, missingKeys: OpenRouterEnvKey[] = []) {
    super(message);
    this.name = 'OpenRouterConfigError';
    this.missingKeys = missingKeys;
  }
}

export type OpenRouterClient = {
  config: OpenRouterConfig;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  postJson: (
    path: string,
    payload: unknown,
    init?: Omit<RequestInit, 'body' | 'method'>,
  ) => Promise<Response>;
  postChatCompletions: (
    payload: OpenRouterChatCompletionsRequest,
    init?: Omit<RequestInit, 'body' | 'method'>,
  ) => Promise<Response>;
};

export type OpenRouterChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type OpenRouterChatContentPart =
  | { type: 'text'; text: string }
  | {
    type: 'file';
    file: {
      filename: string;
      file_data: string;
    };
  };

export type OpenRouterChatMessage = {
  role: OpenRouterChatRole;
  content: string | OpenRouterChatContentPart[];
};

export type OpenRouterPlugin = {
  id: string;
  pdf?: {
    engine?: 'cloudflare-ai' | 'mistral-ocr' | 'native';
  };
};

export type OpenRouterChatCompletionsRequest = {
  mode: OpenRouterMode;
  messages: OpenRouterChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  reasoning?: {
    effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
    max_tokens?: number;
    exclude?: boolean;
    enabled?: boolean;
  };
  include_reasoning?: boolean;
  plugins?: OpenRouterPlugin[];
};

export type OpenRouterRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

const DEFAULT_OPENROUTER_RETRY_POLICY: OpenRouterRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 3000,
};

export type OpenRouterAttemptFailure = {
  attempt: number;
  status: number | null;
  retryable: boolean;
  failureClass: 'http' | 'network' | 'response_parse';
  message: string;
};

export class OpenRouterRequestError extends Error {
  readonly failure: OpenRouterAttemptFailure;

  constructor(message: string, failure: OpenRouterAttemptFailure) {
    super(message);
    this.name = 'OpenRouterRequestError';
    this.failure = failure;
  }
}

export function loadOpenRouterConfig(readEnv: OpenRouterEnvReader = getEnv): OpenRouterConfig {
  const values = {} as Partial<Record<OpenRouterEnvKey, string>>;
  const missing: OpenRouterEnvKey[] = [];

  for (const key of OPENROUTER_REQUIRED_ENV_KEYS) {
    const raw = readEnv(key);
    const value = raw?.trim() ?? '';
    if (!value) {
      missing.push(key);
      continue;
    }
    values[key] = value;
  }

  if (missing.length) {
    throw new OpenRouterConfigError(
      `Missing required OpenRouter env var(s): ${missing.join(', ')}`,
      missing,
    );
  }

  const baseUrl = readOptionalEnv(readEnv, 'OPENROUTER_BASE_URL') || OPENROUTER_DEFAULT_BASE_URL;
  const siteUrl = readOptionalEnv(readEnv, 'OPENROUTER_SITE_URL') || OPENROUTER_DEFAULT_SITE_URL;
  const appName = readOptionalEnv(readEnv, 'OPENROUTER_APP_NAME') || OPENROUTER_DEFAULT_APP_NAME;
  const fastModel = readOptionalEnv(readEnv, 'OPENROUTER_MODEL_FAST') || OPENROUTER_DEFAULT_MODEL;
  const thoroughModel = readOptionalEnv(readEnv, 'OPENROUTER_MODEL_THOROUGH') ||
    OPENROUTER_DEFAULT_MODEL;

  return {
    apiKey: values.OPENROUTER_API_KEY as string,
    baseUrl: normalizeBaseUrl(baseUrl),
    siteUrl: normalizeAbsoluteUrl(siteUrl, 'OPENROUTER_SITE_URL'),
    appName,
    models: {
      fast: fastModel,
      thorough: thoroughModel,
    },
  };
}

export function buildOpenRouterHeaders(config: OpenRouterConfig, headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  merged.set('Authorization', `Bearer ${config.apiKey}`);
  merged.set('HTTP-Referer', config.siteUrl);
  merged.set('X-Title', config.appName);
  if (!merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return merged;
}

export function createOpenRouterClient(
  config: OpenRouterConfig,
  fetchImpl: typeof fetch = fetch,
): OpenRouterClient {
  return {
    config,
    request(path, init = {}) {
      return fetchImpl(buildOpenRouterUrl(config, path), {
        ...init,
        headers: buildOpenRouterHeaders(config, init.headers),
      });
    },
    postJson(path, payload, init = {}) {
      return fetchImpl(buildOpenRouterUrl(config, path), {
        ...init,
        method: 'POST',
        headers: buildOpenRouterHeaders(config, init.headers),
        body: JSON.stringify(payload),
      });
    },
    postChatCompletions(payload, init = {}) {
      return fetchImpl(buildOpenRouterUrl(config, '/chat/completions'), {
        ...init,
        method: 'POST',
        headers: buildOpenRouterHeaders(config, init.headers),
        body: JSON.stringify({
          model: config.models[payload.mode],
          messages: payload.messages,
          max_tokens: payload.max_tokens,
          temperature: payload.temperature,
          stream: payload.stream,
          reasoning: payload.reasoning,
          include_reasoning: payload.include_reasoning,
          plugins: payload.plugins,
        }),
      });
    },
  };
}

export function createOpenRouterClientFromEnv(
  readEnv: OpenRouterEnvReader = getEnv,
  fetchImpl: typeof fetch = fetch,
): OpenRouterClient {
  return createOpenRouterClient(loadOpenRouterConfig(readEnv), fetchImpl);
}

export async function postChatCompletionsWithRetry(
  client: OpenRouterClient,
  payload: OpenRouterChatCompletionsRequest,
  opts: {
    retryPolicy?: Partial<OpenRouterRetryPolicy>;
    sleep?: (ms: number, options: { readonly signal?: AbortSignal }) => Promise<void>;
    onAttemptFailure?: (failure: OpenRouterAttemptFailure) => void;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const retryPolicy = mergeRetryPolicy(opts.retryPolicy);
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    opts.signal?.throwIfAborted();
    try {
      const res = await client.postChatCompletions(payload, { signal: opts.signal });
      if (res.ok) {
        try {
          return await res.json();
        } catch (_err) {
          throw new OpenRouterRequestError('OpenRouter response was not valid JSON.', {
            attempt,
            status: res.status,
            retryable: false,
            failureClass: 'response_parse',
            message: 'OpenRouter response body could not be parsed as JSON.',
          });
        }
      }

      const bodyText = (await res.text()).slice(0, 400);
      const failure: OpenRouterAttemptFailure = {
        attempt,
        status: res.status,
        retryable: isRetryableOpenRouterStatus(res.status),
        failureClass: 'http',
        message: `OpenRouter request failed with status ${res.status}. ${bodyText}`.trim(),
      };
      opts.onAttemptFailure?.(failure);

      if (failure.retryable && attempt < retryPolicy.maxAttempts) {
        await sleep(computeRetryDelayMs(attempt, retryPolicy), { signal: opts.signal });
        continue;
      }

      throw new OpenRouterRequestError('OpenRouter request failed.', failure);
    } catch (err: unknown) {
      if (opts.signal?.aborted) {
        throw opts.signal.reason ?? new DOMException('OpenRouter request aborted.', 'AbortError');
      }
      if (err instanceof OpenRouterRequestError) throw err;

      const failure: OpenRouterAttemptFailure = {
        attempt,
        status: null,
        retryable: true,
        failureClass: 'network',
        message: err instanceof Error ? err.message : 'Unknown network error',
      };
      opts.onAttemptFailure?.(failure);
      if (attempt < retryPolicy.maxAttempts) {
        await sleep(computeRetryDelayMs(attempt, retryPolicy), { signal: opts.signal });
        continue;
      }
      throw new OpenRouterRequestError('OpenRouter network request failed.', failure);
    }
  }

  throw new OpenRouterRequestError('OpenRouter request failed after retries.', {
    attempt: retryPolicy.maxAttempts,
    status: null,
    retryable: true,
    failureClass: 'network',
    message: 'Request attempts exhausted.',
  });
}

export function isRetryableOpenRouterStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function computeRetryDelayMs(
  attempt: number,
  retryPolicy: OpenRouterRetryPolicy = DEFAULT_OPENROUTER_RETRY_POLICY,
): number {
  const exponent = Math.max(0, attempt - 1);
  const backoff = retryPolicy.baseDelayMs * (2 ** exponent);
  return Math.min(backoff, retryPolicy.maxDelayMs);
}

function mergeRetryPolicy(policy?: Partial<OpenRouterRetryPolicy>): OpenRouterRetryPolicy {
  return {
    maxAttempts: Math.max(1, policy?.maxAttempts ?? DEFAULT_OPENROUTER_RETRY_POLICY.maxAttempts),
    baseDelayMs: Math.max(1, policy?.baseDelayMs ?? DEFAULT_OPENROUTER_RETRY_POLICY.baseDelayMs),
    maxDelayMs: Math.max(1, policy?.maxDelayMs ?? DEFAULT_OPENROUTER_RETRY_POLICY.maxDelayMs),
  };
}

const defaultSleep = sleepWithSignal;

function normalizeBaseUrl(value: string): string {
  const normalized = normalizeAbsoluteUrl(value, 'OPENROUTER_BASE_URL');
  return normalized.replace(/\/+$/, '');
}

function normalizeAbsoluteUrl(value: string, key: OpenRouterEnvKey): string {
  try {
    return new URL(value).toString();
  } catch (_) {
    throw new OpenRouterConfigError(`Invalid URL in ${key}: "${value}"`);
  }
}

function buildOpenRouterUrl(config: OpenRouterConfig, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${config.baseUrl}${suffix}`;
}

function readOptionalEnv(readEnv: OpenRouterEnvReader, key: OpenRouterEnvKey): string {
  return readEnv(key)?.trim() ?? '';
}
