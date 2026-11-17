import {
  assessmentBlueprintQuestionCount,
  type DefinedAssessmentBlueprint,
  parseAssessmentBlueprint,
  requireDefinedAssessmentBlueprint,
} from './assessment_blueprint.ts';
import { AIDraftParseFatalError } from './ai/draft_parser.ts';
import { CloudflareWorkersAiError } from './ai/cloudflare_workers.ts';
import { AIGenerationProviderConfigError } from './ai/assessment_generation_provider.ts';
import { OpenRouterGenerationError } from './ai/generation.ts';
import {
  OpenRouterConfigError,
  type OpenRouterMode,
  OpenRouterRequestError,
} from './ai/openrouter.ts';
import { canonicalJsonStringify } from './canonical_json.ts';
import { AIGenerationLeaseLostError } from './conversion/generation_checkpoint.ts';
import type {
  LeaseLostJobFailure,
  PermanentJobFailure,
  RetryableJobFailure,
} from './job_failure.ts';

/** Persisted AI job lifecycle states. */
export type AIGenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed';

declare const aiGenerationJobInputBrand: unique symbol;

type AIGenerationFailureDisposition = 'lease_lost' | 'permanent' | 'retryable';

const AI_GENERATION_FAILURE_POLICY = {
  provider_config: {
    disposition: 'permanent',
    message: 'The AI provider is not configured for this environment.',
  },
  provider_request_retryable: {
    disposition: 'retryable',
    message: 'The AI provider did not complete the request.',
  },
  provider_request_rejected: {
    disposition: 'permanent',
    message: 'The AI provider rejected the generation request.',
  },
  source_conversion: {
    disposition: 'permanent',
    message: 'QFlowLearn could not prepare this source for AI generation.',
  },
  model: {
    disposition: 'permanent',
    message: 'The AI provider did not return usable assessment questions.',
  },
  processing_cancelled: {
    disposition: 'retryable',
    message: 'AI generation stopped before it finished.',
  },
  lease_lost: {
    disposition: 'lease_lost',
    message: 'Another worker owns this AI generation attempt.',
  },
  unknown: {
    disposition: 'retryable',
    message: 'AI generation could not finish because an internal dependency failed.',
  },
} as const satisfies Record<
  string,
  { readonly disposition: AIGenerationFailureDisposition; readonly message: string }
>;

/** Stable classifications used in worker telemetry and persisted job state. */
export type AIGenerationJobErrorCode = keyof typeof AI_GENERATION_FAILURE_POLICY;

type AIGenerationFailurePolicy = typeof AI_GENERATION_FAILURE_POLICY;
type AIGenerationCodesWithDisposition<Disposition extends AIGenerationFailureDisposition> = {
  [Code in AIGenerationJobErrorCode]: AIGenerationFailurePolicy[Code]['disposition'] extends
    Disposition ? Code : never;
}[AIGenerationJobErrorCode];

/** AI generation failures eligible for another durable attempt. */
export type RetryableAIGenerationJobErrorCode = AIGenerationCodesWithDisposition<'retryable'>;

const AI_GENERATION_RETRY_DELAYS = {
  provider_request_retryable: '1 minute',
  processing_cancelled: '10 seconds',
  unknown: '30 seconds',
} as const satisfies Record<RetryableAIGenerationJobErrorCode, string>;

/** AI generation failures that may terminally end one durable attempt. */
export type TerminalAIGenerationJobErrorCode =
  | RetryableAIGenerationJobErrorCode
  | AIGenerationCodesWithDisposition<'permanent'>;

type AIGenerationFailureForCode<Code extends AIGenerationJobErrorCode> = Code extends
  AIGenerationJobErrorCode
  ? AIGenerationFailurePolicy[Code]['disposition'] extends 'retryable'
    ? RetryableJobFailure<Code> & { readonly cause: unknown }
  : AIGenerationFailurePolicy[Code]['disposition'] extends 'permanent'
    ? PermanentJobFailure<Code> & { readonly cause: unknown }
  : LeaseLostJobFailure<Code> & { readonly cause: unknown }
  : never;

/** One catalog-classified AI generation failure for the active Workflow attempt. */
export type AIGenerationJobFailure = AIGenerationFailureForCode<AIGenerationJobErrorCode>;

/** Return the durable wait applied before another AI-generation attempt. */
export function aiGenerationRetryDelay(
  code: RetryableAIGenerationJobErrorCode,
): (typeof AI_GENERATION_RETRY_DELAYS)[RetryableAIGenerationJobErrorCode] {
  return AI_GENERATION_RETRY_DELAYS[code];
}

/** Canonical generation settings stored with a conversion job. */
export type AIGenerationJobInput = {
  readonly mode: OpenRouterMode;
  readonly blueprint: DefinedAssessmentBlueprint;
  readonly [aiGenerationJobInputBrand]: true;
};
/** Signals an invalid generation command or persisted job input. */
export class AIGenerationJobInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIGenerationJobInputError';
  }
}

export { AIGenerationLeaseLostError };
/** Parse one HTTP or persisted AI generation command through the canonical generation policy. */
export function parseAIGenerationJobInput(value: unknown): AIGenerationJobInput {
  const record = parseRecord(value, 'AI generation job input must be an object.');
  assertExactKeys(record, ['mode', 'blueprint']);
  const mode = parseMode(record.mode);
  const blueprint = requireDefinedAssessmentBlueprint(parseAssessmentBlueprint(record.blueprint));
  const count = assessmentBlueprintQuestionCount(blueprint);
  if (count > 50) {
    throw new AIGenerationJobInputError(
      'AI generation blueprint cannot request more than 50 questions.',
    );
  }
  for (const target of blueprint.targets) {
    if (
      target.questionType !== 'single_select' && target.questionType !== 'multi_select' &&
      target.questionType !== 'text_entry'
    ) {
      throw new AIGenerationJobInputError(
        `AI generation does not support blueprint type ${target.questionType}.`,
      );
    }
  }
  // SAFETY: mode, blueprint, count, and supported-type invariants are established above.
  return { mode, blueprint } as AIGenerationJobInput;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const expectedKeys = new Set(expected);
  const unknown = Object.keys(record).filter((key) => !expectedKeys.has(key));
  const missing = expected.filter((key) => !(key in record));
  if (unknown.length || missing.length) {
    throw new AIGenerationJobInputError(
      `Invalid AI generation input keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}

function parseMode(value: unknown): OpenRouterMode {
  if (value === 'fast' || value === 'thorough') return value;
  throw new AIGenerationJobInputError('AI generation mode must be "fast" or "thorough".');
}

/** Compare canonical AI generation inputs for idempotent enqueue. */
export function sameAIGenerationJobInput(
  left: AIGenerationJobInput,
  right: AIGenerationJobInput,
): boolean {
  return left.mode === right.mode &&
    canonicalJsonStringify(left.blueprint) === canonicalJsonStringify(right.blueprint);
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new AIGenerationJobInputError(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Classify a generation failure with its one catalog-defined retry decision and safe message. */
export function classifyAIGenerationJobFailure(cause: unknown): AIGenerationJobFailure {
  if (cause instanceof AIGenerationLeaseLostError) return aiGenerationFailure('lease_lost', cause);
  if (
    cause instanceof AIGenerationProviderConfigError ||
    cause instanceof OpenRouterConfigError
  ) {
    return aiGenerationFailure('provider_config', cause);
  }
  if (cause instanceof OpenRouterRequestError) {
    return aiGenerationFailure(
      cause.failure.retryable ? 'provider_request_retryable' : 'provider_request_rejected',
      cause,
    );
  }
  if (cause instanceof OpenRouterGenerationError) return aiGenerationFailure('model', cause);
  if (cause instanceof AIDraftParseFatalError) return aiGenerationFailure('model', cause);
  if (cause instanceof CloudflareWorkersAiError) return aiGenerationFailure(cause.code, cause);
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return aiGenerationFailure('processing_cancelled', cause);
  }
  return aiGenerationFailure('unknown', cause);
}

/** Return the approved message for one classified AI generation failure. */
export function safeAIGenerationJobErrorMessage(
  code: AIGenerationJobErrorCode,
): string {
  return AI_GENERATION_FAILURE_POLICY[code].message;
}

function aiGenerationFailure<Code extends AIGenerationJobErrorCode>(
  code: Code,
  cause: unknown,
): AIGenerationFailureForCode<Code> {
  const policy = AI_GENERATION_FAILURE_POLICY[code];
  if (policy.disposition === 'lease_lost') {
    // SAFETY: the catalog lookup proves this code's lease-lost disposition.
    return {
      _tag: 'LeaseLost',
      code,
      message: policy.message,
      cause,
    } as AIGenerationFailureForCode<Code>;
  }
  if (policy.disposition === 'permanent') {
    // SAFETY: the catalog lookup proves this code's permanent disposition.
    return {
      _tag: 'Permanent',
      code,
      message: policy.message,
      cause,
    } as AIGenerationFailureForCode<Code>;
  }
  // SAFETY: the catalog lookup proves this code's retryable disposition.
  return { _tag: 'Retryable', code, message: policy.message, cause } as AIGenerationFailureForCode<
    Code
  >;
}
