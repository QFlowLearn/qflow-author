import { bindings, defineConfig, exports, triggers, type WorkerConfig } from 'cf/config';

export const authorVariables = {
  'QFLOW_ORGANIZATION_GATEWAY_ID': 'YOUR_GATEWAY_ID',
  'QFLOW_ORGANIZATION_MODEL_VERSION': 'clef',
  'QFLOW_ORGANIZATION_INPUT_MICROS_PER_MILLION': '240000',
  'QFLOW_ORGANIZATION_RUN_BUDGET_MICROS': '1000000',
  'QFLOW_ENRICHMENT_PROVIDER': 'cloudflare',
  'QFLOW_ENRICHMENT_MODEL': '@cf/deepseek-ai/deepseek-v4-flash-0731',
  'QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION': '440000',
  'QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION': '1320000',
  'QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS': '1000000',
  'QFLOW_ENRICHMENT_RUN_BUDGET_MICROS': '25000000',
  'QFLOW_APP_ORIGIN': 'https://app.example.com',
  'QFLOW_DELIVERY_PUBLISH_URL': 'https://take.example.com/internal/qflow/publish',
  'QFLOW_DELIVERY_CAPABILITY_URL': 'https://take.example.com/internal/qflow/capability',
  'QFLOW_DELIVERY_STATE_URL': 'https://take.example.com/internal/qflow/state',
  'QFLOW_DELIVERY_SSO_LAUNCH_URL': 'https://take.example.com/api/qflow/sso/launch',
  'QFLOW_AI_PROVIDER': 'cloudflare',
  'QFLOW_CLOUDFLARE_AI_MODEL': '@cf/moonshotai/kimi-k2.6',
  'QFLOW_EMAIL_FROM': 'QFlowLearn <hello@example.test>',
  'QFLOW_STORAGE_BACKEND': 'r2-binding',
  'QFLOW_SECURE_COOKIES': 'true',
  'QFLOW_AUTHORING_GATEWAY_ID': 'qflow-authoring',
  'QFLOW_AUTHORING_MODEL_VERSION': 'clef',
};

export const authorWorker = {
  name: 'qflow-author',
  compatibilityDate: '2026-06-03',
  compatibilityFlags: [
    'nodejs_compat',
  ],
  entrypoint: 'deploy/cloudflare/worker.entry.ts',
  workersDev: false,
  limits: {
    cpuMs: 300000,
  },
  observability: {
    enabled: true,
  },
  triggers: [
    triggers.scheduled({
      schedule: '* * * * *',
    }),
    triggers.scheduled({
      schedule: '*/2 * * * *',
    }),
    triggers.scheduled({
      schedule: '0 3 * * *',
    }),
  ],
  env: {
    QFLOW_ORGANIZATION_GATEWAY_ID: bindings.text(authorVariables.QFLOW_ORGANIZATION_GATEWAY_ID),
    QFLOW_ORGANIZATION_MODEL_VERSION: bindings.text(
      authorVariables.QFLOW_ORGANIZATION_MODEL_VERSION,
    ),
    QFLOW_ORGANIZATION_INPUT_MICROS_PER_MILLION: bindings.text(
      authorVariables.QFLOW_ORGANIZATION_INPUT_MICROS_PER_MILLION,
    ),
    QFLOW_ORGANIZATION_RUN_BUDGET_MICROS: bindings.text(
      authorVariables.QFLOW_ORGANIZATION_RUN_BUDGET_MICROS,
    ),
    QFLOW_ENRICHMENT_PROVIDER: bindings.text(authorVariables.QFLOW_ENRICHMENT_PROVIDER),
    QFLOW_ENRICHMENT_MODEL: bindings.text(authorVariables.QFLOW_ENRICHMENT_MODEL),
    QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION: bindings.text(
      authorVariables.QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION,
    ),
    QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION: bindings.text(
      authorVariables.QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION,
    ),
    QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS: bindings.text(
      authorVariables.QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS,
    ),
    QFLOW_ENRICHMENT_RUN_BUDGET_MICROS: bindings.text(
      authorVariables.QFLOW_ENRICHMENT_RUN_BUDGET_MICROS,
    ),
    QFLOW_APP_ORIGIN: bindings.text(authorVariables.QFLOW_APP_ORIGIN),
    QFLOW_DELIVERY_PUBLISH_URL: bindings.text(authorVariables.QFLOW_DELIVERY_PUBLISH_URL),
    QFLOW_DELIVERY_CAPABILITY_URL: bindings.text(authorVariables.QFLOW_DELIVERY_CAPABILITY_URL),
    QFLOW_DELIVERY_STATE_URL: bindings.text(authorVariables.QFLOW_DELIVERY_STATE_URL),
    QFLOW_DELIVERY_SSO_LAUNCH_URL: bindings.text(authorVariables.QFLOW_DELIVERY_SSO_LAUNCH_URL),
    QFLOW_AI_PROVIDER: bindings.text(authorVariables.QFLOW_AI_PROVIDER),
    QFLOW_CLOUDFLARE_AI_MODEL: bindings.text(authorVariables.QFLOW_CLOUDFLARE_AI_MODEL),
    QFLOW_EMAIL_FROM: bindings.text(authorVariables.QFLOW_EMAIL_FROM),
    QFLOW_STORAGE_BACKEND: bindings.text(authorVariables.QFLOW_STORAGE_BACKEND),
    QFLOW_SECURE_COOKIES: bindings.text(authorVariables.QFLOW_SECURE_COOKIES),
    QFLOW_AUTHORING_GATEWAY_ID: bindings.text(authorVariables.QFLOW_AUTHORING_GATEWAY_ID),
    QFLOW_AUTHORING_MODEL_VERSION: bindings.text(authorVariables.QFLOW_AUTHORING_MODEL_VERSION),
    QFLOW_DB: bindings.hyperdrive({
      id: '00000000000000000000000000000000',
    }),
    QFLOW_UPLOADS: bindings.r2({
      name: 'qflow-example-uploads',
    }),
    QFLOW_EMAIL: bindings.sendEmail({
      allowedSenderAddresses: [
        'hello@example.test',
      ],
    }),
    QFLOW_PRINT_RENDERER: bindings.worker({
      worker: 'qflow-print-renderer',
    }),
    QFLOW_ASSESSMENT_PRINT_WORKFLOW: bindings.workflow({
      name: 'qflow-assessment-print',
      worker: 'qflow-author',
      exportName: 'AssessmentPrintWorkflow',
    }),
    QFLOW_QUESTION_ORGANIZATION_WORKFLOW: bindings.workflow({
      name: 'qflow-question-organization',
      worker: 'qflow-author',
      exportName: 'QuestionOrganizationWorkflow',
    }),
    QFLOW_BANK_ENRICHMENT_WORKFLOW: bindings.workflow({
      name: 'qflow-bank-enrichment',
      worker: 'qflow-author',
      exportName: 'BankEnrichmentWorkflow',
    }),
    QFLOW_MIGRATION_COMMIT_WORKFLOW: bindings.workflow({
      name: 'qflow-migration-commit',
      worker: 'qflow-author',
      exportName: 'MigrationCommitWorkflow',
    }),
    QFLOW_SOURCE_MIGRATION_WORKFLOW: bindings.workflow({
      name: 'qflow-source-migration',
      worker: 'qflow-author',
      exportName: 'SourceMigrationWorkflow',
    }),
    QFLOW_AI_GENERATION_WORKFLOW: bindings.workflow({
      name: 'qflow-ai-generation',
      worker: 'qflow-author',
      exportName: 'AiGenerationWorkflow',
    }),
    QFLOW_RELEASE_BUILD_WORKFLOW: bindings.workflow({
      name: 'qflow-release-build',
      worker: 'qflow-author',
      exportName: 'ReleaseBuildWorkflow',
    }),
    AI: bindings.ai({}),
    QFLOW_AUTHORING_RATE_LIMIT: bindings.rateLimit({
      namespace: '41003',
      simple: {
        limit: 20,
        period: 60,
      },
    }),
    QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT: bindings.rateLimit({
      namespace: '41001',
      simple: {
        limit: 3,
        period: 60,
      },
    }),
    QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT: bindings.rateLimit({
      namespace: '41002',
      simple: {
        limit: 10,
        period: 60,
      },
    }),
    ASSETS: bindings.assets(),
  },
  exports: {
    AssessmentPrintWorkflow: exports.workflow({
      name: 'qflow-assessment-print',
    }),
    QuestionOrganizationWorkflow: exports.workflow({
      name: 'qflow-question-organization',
    }),
    BankEnrichmentWorkflow: exports.workflow({
      name: 'qflow-bank-enrichment',
    }),
    MigrationCommitWorkflow: exports.workflow({
      name: 'qflow-migration-commit',
    }),
    SourceMigrationWorkflow: exports.workflow({
      name: 'qflow-source-migration',
    }),
    AiGenerationWorkflow: exports.workflow({
      name: 'qflow-ai-generation',
    }),
    ReleaseBuildWorkflow: exports.workflow({
      name: 'qflow-release-build',
    }),
  },
} satisfies WorkerConfig;

export default defineConfig(({ mode = 'production' }) => {
  if (mode !== 'production' && mode !== 'development') {
    throw Error('Select production or development mode.');
  }
  return {
    worker: mode === 'development'
      ? {
        ...authorWorker,
        name: 'qflow-local',
        env: {
          ...authorWorker.env,
          ...Object.fromEntries(
            Object.entries(authorWorker.env).map((
              [name, binding],
            ) => [
              name,
              binding.type === 'workflow' ? { ...binding, worker: 'qflow-local' } : binding,
            ]),
          ),
          ...Object.fromEntries(
            Object.keys(process.env).filter((name) => /^(QFLOW_|OPENROUTER_)/.test(name)).map(
              (name) => [name, bindings.secret()],
            ),
          ),
          QFLOW_PRINT_RENDERER: bindings.worker({ worker: 'qflow-local-print-renderer' }),
        },
      }
      : authorWorker,
  };
});
