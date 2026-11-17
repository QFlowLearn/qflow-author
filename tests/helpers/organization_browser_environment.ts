import { enrichmentConfigFixture as config } from './enrichment_provider_fixture.ts';

/** Explicit test model settings used by both the local Fresh renderer and the owned job dispatcher. */
export const organizationBrowserEnvironment = {
  QFLOW_ORGANIZATION_GATEWAY_ID: 'organization-test',
  QFLOW_ORGANIZATION_MODEL_VERSION: 'clef',
  QFLOW_ORGANIZATION_INPUT_MICROS_PER_MILLION: '240000',
  QFLOW_ORGANIZATION_RUN_BUDGET_MICROS: '1000000',
  QFLOW_ENRICHMENT_PROVIDER: config.provider,
  QFLOW_ENRICHMENT_MODEL: config.model,
  QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION: String(config.inputMicrosPerMillion),
  QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION: String(config.outputMicrosPerMillion),
  QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS: String(config.previewBudgetMicros),
  QFLOW_ENRICHMENT_RUN_BUDGET_MICROS: String(config.runBudgetMicros),
};
