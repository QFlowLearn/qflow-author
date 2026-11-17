import type { AIGenerationParserInput, AIGenerationUsage } from '../ai/generation.ts';
import {
  type AIGenerationReference,
  createAIGenerationReference,
  parseAIGenerationReference,
} from '../ai/generation_reference.ts';
import type { PlanTier } from '../services/ai_usage.ts';

/** Source-volume facts retained with a provider response for deterministic resume. */
export type AIGenerationSourceSummary = {
  readonly totalChars: number;
  readonly includedChars: number;
  readonly maxChars: number;
  readonly truncated: boolean;
  readonly fileBacked: boolean;
};

/** Allowed-plan facts retained with a provider response for audit and response consistency. */
export type AIGenerationAllowanceSnapshot = {
  readonly plan: PlanTier;
  readonly limit: number | null;
  readonly used: number;
  readonly remaining: number | null;
  readonly resetDate: string;
  readonly allowThorough: boolean;
  readonly maxQuestionsPerGeneration: number;
};

/** Durable provider response and preparation facts used to resume without external source work. */
export type AIGenerationProviderCheckpoint = {
  readonly _tag: 'provider_result';
  readonly generation: AIGenerationReference;
  readonly content: string;
  readonly usage: AIGenerationUsage;
  readonly source: AIGenerationSourceSummary;
  readonly allowance: AIGenerationAllowanceSnapshot;
};

/** Durable terminal output for a completed generation job. */
export type AIGenerationCompletedResult = {
  readonly requestedCount: number;
  readonly parsedCount: number;
  readonly persistedCount: number;
  readonly errorCount: number;
  readonly providerUsage: AIGenerationUsage;
};

/** Durable terminal output for a completed generation job. */
export type AIGenerationCompletedOutput = {
  readonly _tag: 'completed';
  readonly generation: AIGenerationReference;
  readonly result: AIGenerationCompletedResult;
};

/** Canonical persisted output variants for an AI generation job. */
export type AIGenerationJobOutput =
  | AIGenerationProviderCheckpoint
  | AIGenerationCompletedOutput;

/** Signals that a worker no longer owns the job attempt it tried to mutate. */
export class AIGenerationLeaseLostError extends Error {
  constructor(readonly jobId: string) {
    super('AI generation job lease is no longer active.');
    this.name = 'AIGenerationLeaseLostError';
  }
}

/** Project a provider response into the resumable, serialization-safe checkpoint. */
export function checkpointFromParserInput(
  input: AIGenerationParserInput,
  promptVersion: string,
  source: AIGenerationSourceSummary,
  allowance: AIGenerationAllowanceSnapshot,
): AIGenerationProviderCheckpoint {
  const generation = createAIGenerationReference({
    provider: input.source,
    mode: input.mode,
    model: input.model,
    promptVersion,
  });
  return {
    _tag: 'provider_result',
    generation,
    content: input.content,
    usage: input.usage,
    source,
    allowance,
  };
}

/** Reconstruct parser input from a durable provider checkpoint. */
export function parserInputFromCheckpoint(
  checkpoint: AIGenerationProviderCheckpoint,
): AIGenerationParserInput {
  return {
    source: checkpoint.generation.provider,
    mode: checkpoint.generation.mode,
    model: checkpoint.generation.model,
    content: checkpoint.content,
    usage: checkpoint.usage,
    raw: null,
  };
}

/** Parse persisted generation output without coercion or defaults. */
export function parseAIGenerationJobOutput(
  value: unknown,
): AIGenerationJobOutput | null {
  if (value === null) return null;
  const record = parseRecord(value, 'AI generation job output must be an object or null.');
  if (record._tag === 'provider_result') {
    assertExactKeys(
      record,
      ['_tag', 'generation', 'content', 'usage', 'source', 'allowance'],
    );
    return {
      _tag: 'provider_result',
      generation: parseAIGenerationReference(record.generation),
      content: parseNonEmptyString(record.content, 'Provider checkpoint content is required.'),
      usage: parseUsage(record.usage),
      source: parseSourceSummary(record.source),
      allowance: parseAllowanceSnapshot(record.allowance),
    };
  }
  if (record._tag === 'completed') {
    assertExactKeys(record, ['_tag', 'generation', 'result']);
    return {
      _tag: 'completed',
      generation: parseAIGenerationReference(record.generation),
      result: parseCompletedResult(record.result),
    };
  }
  throw new Error(`Invalid AI generation output tag: ${String(record._tag)}`);
}

function parseSourceSummary(value: unknown): AIGenerationSourceSummary {
  const record = parseRecord(value, 'Provider checkpoint source summary must be an object.');
  assertExactKeys(record, [
    'totalChars',
    'includedChars',
    'maxChars',
    'truncated',
    'fileBacked',
  ]);
  const totalChars = parseNonNegativeInteger(
    record.totalChars,
    'Provider checkpoint source total is invalid.',
  );
  const includedChars = parseNonNegativeInteger(
    record.includedChars,
    'Provider checkpoint included source total is invalid.',
  );
  const maxChars = parsePositiveInteger(
    record.maxChars,
    'Provider checkpoint source limit is invalid.',
  );
  const truncated = parseBoolean(
    record.truncated,
    'Provider checkpoint source truncation flag is invalid.',
  );
  const fileBacked = parseBoolean(
    record.fileBacked,
    'Provider checkpoint file-backed flag is invalid.',
  );
  if (includedChars > totalChars || includedChars > maxChars) {
    throw new Error('Provider checkpoint source totals are contradictory.');
  }
  if (truncated ? totalChars <= maxChars : totalChars !== includedChars) {
    throw new Error('Provider checkpoint source truncation facts are contradictory.');
  }
  return { totalChars, includedChars, maxChars, truncated, fileBacked };
}

function parseAllowanceSnapshot(value: unknown): AIGenerationAllowanceSnapshot {
  const record = parseRecord(value, 'Provider checkpoint allowance must be an object.');
  assertExactKeys(record, [
    'plan',
    'limit',
    'used',
    'remaining',
    'resetDate',
    'allowThorough',
    'maxQuestionsPerGeneration',
  ]);
  const plan = parsePlan(record.plan);
  const limit = parseNullablePositiveInteger(
    record.limit,
    'Provider checkpoint generation limit is invalid.',
  );
  const used = parseNonNegativeInteger(
    record.used,
    'Provider checkpoint generation usage is invalid.',
  );
  const remaining = parseNullableNonNegativeInteger(
    record.remaining,
    'Provider checkpoint remaining generation count is invalid.',
  );
  if ((limit === null) !== (remaining === null)) {
    throw new Error('Provider checkpoint allowance limits are contradictory.');
  }
  if (
    limit !== null && remaining !== null &&
    (used >= limit || remaining !== limit - used)
  ) {
    throw new Error('Provider checkpoint allowance counts are contradictory.');
  }
  return {
    plan,
    limit,
    used,
    remaining,
    resetDate: parseIsoTimestamp(
      record.resetDate,
      'Provider checkpoint reset date is invalid.',
    ),
    allowThorough: parseBoolean(
      record.allowThorough,
      'Provider checkpoint thorough-mode flag is invalid.',
    ),
    maxQuestionsPerGeneration: parsePositiveInteger(
      record.maxQuestionsPerGeneration,
      'Provider checkpoint question limit is invalid.',
    ),
  };
}

function parseCompletedResult(value: unknown): AIGenerationCompletedResult {
  const record = parseRecord(value, 'Completed generation result must be an object.');
  assertExactKeys(record, [
    'requestedCount',
    'parsedCount',
    'persistedCount',
    'errorCount',
    'providerUsage',
  ]);
  const requestedCount = parsePositiveInteger(
    record.requestedCount,
    'Completed generation requested count must be positive.',
  );
  const parsedCount = parseNonNegativeInteger(
    record.parsedCount,
    'Completed generation parsed count is invalid.',
  );
  const persistedCount = parsePositiveInteger(
    record.persistedCount,
    'Completed generation persisted count must be positive.',
  );
  const errorCount = parseNonNegativeInteger(
    record.errorCount,
    'Completed generation error count is invalid.',
  );
  if (parsedCount !== persistedCount + errorCount) {
    throw new Error('Completed generation counts are contradictory.');
  }
  return {
    requestedCount,
    parsedCount,
    persistedCount,
    errorCount,
    providerUsage: parseUsage(record.providerUsage),
  };
}

function parseUsage(value: unknown): AIGenerationUsage {
  const record = parseRecord(value, 'Provider checkpoint usage must be an object.');
  assertExactKeys(record, ['promptTokens', 'completionTokens', 'totalTokens']);
  return {
    promptTokens: parseNullableNumber(record.promptTokens, 'Invalid prompt token count.'),
    completionTokens: parseNullableNumber(
      record.completionTokens,
      'Invalid completion token count.',
    ),
    totalTokens: parseNullableNumber(record.totalTokens, 'Invalid total token count.'),
  };
}

function parseNullableNumber(value: unknown, message: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(message);
  return value;
}

function parseNullableNonNegativeInteger(value: unknown, message: string): number | null {
  return value === null ? null : parseNonNegativeInteger(value, message);
}

function parseNullablePositiveInteger(value: unknown, message: string): number | null {
  return value === null ? null : parsePositiveInteger(value, message);
}

function parseNonNegativeInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(message);
  }
  return value;
}

function parsePositiveInteger(value: unknown, message: string): number {
  const parsed = parseNonNegativeInteger(value, message);
  if (parsed === 0) throw new Error(message);
  return parsed;
}

function parseBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message);
  return value;
}

function parsePlan(value: unknown): PlanTier {
  if (value === 'free' || value === 'pro' || value === 'enterprise') return value;
  throw new Error(`Invalid provider checkpoint plan: ${String(value)}`);
}

function parseIsoTimestamp(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(message);
  }
  return value;
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  // SAFETY: the runtime checks above establish a non-array object boundary.
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const expectedSet = new Set(expected);
  const unknown = Object.keys(record).filter((key) => !expectedSet.has(key));
  const missing = expected.filter((key) => !(key in record));
  if (unknown.length || missing.length) {
    throw new Error(
      `Invalid generation output keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}

function parseNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}
