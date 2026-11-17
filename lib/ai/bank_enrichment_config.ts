/** Frozen configuration shared by preview, classification and the usage ledger. */
export type EnrichmentAIConfig = {
  readonly provider: 'cloudflare';
  readonly model: string;
  readonly promptVersion: 'bank-enrichment-v1';
  readonly inputMicrosPerMillion: number;
  readonly outputMicrosPerMillion: number;
  readonly previewBudgetMicros: number;
  readonly runBudgetMicros: number;
};

/** Require an explicitly selected model and prices; generation defaults do not apply. */
export function loadEnrichmentAIConfig(
  read: (key: string) => string | undefined,
): EnrichmentAIConfig | null {
  return parseEnrichmentAIConfig({
    provider: read('QFLOW_ENRICHMENT_PROVIDER'),
    model: read('QFLOW_ENRICHMENT_MODEL'),
    promptVersion: 'bank-enrichment-v1',
    inputMicrosPerMillion: Number(read('QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION')),
    outputMicrosPerMillion: Number(read('QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION')),
    previewBudgetMicros: Number(read('QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS')),
    runBudgetMicros: Number(read('QFLOW_ENRICHMENT_RUN_BUDGET_MICROS')),
  });
}

/** Parse configuration loaded from storage as well as deployment configuration. */
export function parseEnrichmentAIConfig(value: unknown): EnrichmentAIConfig | null {
  if (!isEnrichmentRecord(value)) return null;
  if (
    Object.keys(value).sort().join(',') !==
      'inputMicrosPerMillion,model,outputMicrosPerMillion,previewBudgetMicros,promptVersion,provider,runBudgetMicros'
  ) return null;
  if (value.provider !== 'cloudflare' || value.promptVersion !== 'bank-enrichment-v1') return null;
  // Explicitly supported Workers AI models share the non-streaming chat-completion contract.
  // Persisted jobs retain their selected model; configuration never substitutes another model.
  if (
    value.model !== '@cf/deepseek-ai/deepseek-v4-flash-0731' &&
    value.model !== '@cf/moonshotai/kimi-k2.6'
  ) return null;
  if (
    !positiveInteger(value.inputMicrosPerMillion) ||
    !positiveInteger(value.outputMicrosPerMillion) ||
    !positiveInteger(value.previewBudgetMicros) || !positiveInteger(value.runBudgetMicros)
  ) return null;
  return {
    provider: value.provider,
    model: value.model,
    promptVersion: value.promptVersion,
    inputMicrosPerMillion: value.inputMicrosPerMillion,
    outputMicrosPerMillion: value.outputMicrosPerMillion,
    previewBudgetMicros: value.previewBudgetMicros,
    runBudgetMicros: value.runBudgetMicros,
  };
}

/** One rounding operation in integer microdollars, with configured uncached input prices. */
export function enrichmentCostMicros(
  config: EnrichmentAIConfig,
  inputTokens: number,
  outputTokens: number,
): number {
  const numerator = BigInt(inputTokens) * BigInt(config.inputMicrosPerMillion) +
    BigInt(outputTokens) * BigInt(config.outputMicrosPerMillion);
  return Number((numerator + 999_999n) / 1_000_000n);
}

/** Narrow JSON object inputs without asserting a domain DTO. */
export function isEnrichmentRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 &&
    value <= 1_000_000_000;
}
