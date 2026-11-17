import { parseNonEmptyString } from '../persistence_parse.ts';

/** Safe, durable configuration facts that identify one AI generation execution. */
export type AIGenerationReference = {
  readonly provider: 'openrouter_chat_completions' | 'cloudflare_workers_ai';
  readonly model: string;
  readonly mode: 'fast' | 'thorough';
  readonly promptVersion: string;
};

/** Build a generation reference from already typed execution values. */
export function createAIGenerationReference(
  input: AIGenerationReference,
): AIGenerationReference {
  return {
    provider: parseProvider(input.provider),
    model: parseNonEmptyString(input.model, 'AI model reference is required.'),
    mode: parseMode(input.mode),
    promptVersion: parseNonEmptyString(
      input.promptVersion,
      'AI prompt version is required.',
    ),
  };
}

/** Parse a persisted generation reference without defaults or coercion. */
export function parseAIGenerationReference(value: unknown): AIGenerationReference {
  const record = parseRecord(value);
  assertExactKeys(record, ['provider', 'model', 'mode', 'promptVersion']);
  return createAIGenerationReference({
    provider: parseProvider(record.provider),
    model: parseNonEmptyString(record.model, 'AI model reference is required.'),
    mode: parseMode(record.mode),
    promptVersion: parseNonEmptyString(
      record.promptVersion,
      'AI prompt version is required.',
    ),
  });
}

function parseProvider(value: unknown): AIGenerationReference['provider'] {
  if (value === 'openrouter_chat_completions' || value === 'cloudflare_workers_ai') return value;
  throw new Error(`Unsupported AI provider reference: ${String(value)}`);
}

function parseMode(value: unknown): AIGenerationReference['mode'] {
  if (value === 'fast' || value === 'thorough') return value;
  throw new Error(`Unsupported AI generation mode: ${String(value)}`);
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI generation reference must be an object.');
  }
  // SAFETY: the runtime checks above establish a non-array object boundary.
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  const expectedKeys = new Set(expected);
  const unknown = Object.keys(record).filter((key) => !expectedKeys.has(key));
  const missing = expected.filter((key) => !Object.hasOwn(record, key));
  if (unknown.length || missing.length) {
    throw new Error(
      `Invalid AI generation reference keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}
