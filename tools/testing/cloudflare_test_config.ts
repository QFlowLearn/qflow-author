import { resolve } from 'node:path';
import type { WorkerConfig } from 'cf/config';

// Synthetic settings for the real local Worker test projects.
const workers = {
  'workflow-test': {
    'name': 'qflow-workflows-test',
    'entrypoint': 'deploy/cloudflare/workflows.entry.ts',
    'compatibilityDate': '2026-06-03',
    'compatibilityFlags': [
      'nodejs_compat',
    ],
    'env': {
      'QFLOW_ENRICHMENT_PROVIDER': {
        'type': 'text',
        'value': 'cloudflare',
      },
      'QFLOW_ENRICHMENT_MODEL': {
        'type': 'text',
        'value': '@cf/deepseek-ai/deepseek-v4-flash-0731',
      },
      'QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION': {
        'type': 'text',
        'value': '440000',
      },
      'QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION': {
        'type': 'text',
        'value': '1320000',
      },
      'QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS': {
        'type': 'text',
        'value': '1000000',
      },
      'QFLOW_ENRICHMENT_RUN_BUDGET_MICROS': {
        'type': 'text',
        'value': '25000000',
      },
      'QFLOW_STORAGE_BACKEND': {
        'type': 'text',
        'value': 'r2-binding',
      },
      'QFLOW_AI_PROVIDER': {
        'type': 'text',
        'value': 'openrouter',
      },
      'OPENROUTER_API_KEY': {
        'type': 'text',
        'value': 'checkpoint-resume-test',
      },
      'QFLOW_PRINT_RENDERER': {
        'type': 'worker',
        'worker': 'qflow-test-print-renderer',
      },
      'QFLOW_UPLOADS': {
        'type': 'r2',
        'name': 'qflow-workflows-test',
      },
      'QFLOW_ASSESSMENT_PRINT_WORKFLOW': {
        'type': 'workflow',
        'name': 'qflow-assessment-print-test',
        'worker': 'qflow-workflows-test',
        'exportName': 'AssessmentPrintWorkflow',
      },
      'QFLOW_QUESTION_ORGANIZATION_WORKFLOW': {
        'type': 'workflow',
        'name': 'qflow-question-organization-test',
        'worker': 'qflow-workflows-test',
        'exportName': 'QuestionOrganizationWorkflow',
      },
      'QFLOW_BANK_ENRICHMENT_WORKFLOW': {
        'type': 'workflow',
        'name': 'qflow-bank-enrichment-test',
        'worker': 'qflow-workflows-test',
        'exportName': 'BankEnrichmentWorkflow',
      },
      'QFLOW_MIGRATION_COMMIT_WORKFLOW': {
        'type': 'workflow',
        'name': 'qflow-migration-commit-test',
        'worker': 'qflow-workflows-test',
        'exportName': 'MigrationCommitWorkflow',
      },
      'QFLOW_SOURCE_MIGRATION_WORKFLOW': {
        'type': 'workflow',
        'name': 'qflow-source-migration-test',
        'worker': 'qflow-workflows-test',
        'exportName': 'SourceMigrationWorkflow',
      },
      'QFLOW_AI_GENERATION_WORKFLOW': {
        'type': 'workflow',
        'name': 'qflow-ai-generation-test',
        'worker': 'qflow-workflows-test',
        'exportName': 'AiGenerationWorkflow',
      },
      'QFLOW_RELEASE_BUILD_WORKFLOW': {
        'type': 'workflow',
        'name': 'qflow-release-build-test',
        'worker': 'qflow-workflows-test',
        'exportName': 'ReleaseBuildWorkflow',
      },
    },
    'exports': {
      'AssessmentPrintWorkflow': {
        'type': 'workflow',
        'name': 'qflow-assessment-print-test',
      },
      'QuestionOrganizationWorkflow': {
        'type': 'workflow',
        'name': 'qflow-question-organization-test',
      },
      'BankEnrichmentWorkflow': {
        'type': 'workflow',
        'name': 'qflow-bank-enrichment-test',
      },
      'MigrationCommitWorkflow': {
        'type': 'workflow',
        'name': 'qflow-migration-commit-test',
      },
      'SourceMigrationWorkflow': {
        'type': 'workflow',
        'name': 'qflow-source-migration-test',
      },
      'AiGenerationWorkflow': {
        'type': 'workflow',
        'name': 'qflow-ai-generation-test',
      },
      'ReleaseBuildWorkflow': {
        'type': 'workflow',
        'name': 'qflow-release-build-test',
      },
    },
  },
  'web-test': {
    'name': 'qflow-web-test',
    'entrypoint': 'deploy/cloudflare/worker.entry.ts',
    'compatibilityDate': '2026-06-03',
    'compatibilityFlags': [
      'nodejs_compat',
    ],
    'env': {
      'QFLOW_APP_ORIGIN': {
        'type': 'text',
        'value': 'https://app.example.test',
      },
      'QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1': {
        'type': 'text',
        'value': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      'QFLOW_EMAIL_FROM': {
        'type': 'text',
        'value': 'QFlowLearn <hello@qflowlearn.com>',
      },
      'QFLOW_PRINT_RENDERER': {
        'type': 'worker',
        'worker': 'qflow-test-print-renderer',
      },
      'QFLOW_EMAIL': {
        'type': 'send-email',
        'allowedSenderAddresses': [
          'hello@qflowlearn.com',
        ],
      },
      'QFLOW_PASSWORD_RESET_ACCOUNT_RATE_LIMIT': {
        'type': 'rate-limit',
        'namespace': '51001',
        'simple': {
          'limit': 3,
          'period': 60,
        },
      },
      'QFLOW_PASSWORD_RESET_ORIGIN_RATE_LIMIT': {
        'type': 'rate-limit',
        'namespace': '51002',
        'simple': {
          'limit': 10,
          'period': 60,
        },
      },
    },
    'exports': {},
  },
} satisfies Record<string, WorkerConfig>;

export function testWorkerConfig(mode: 'workflow-test' | 'web-test'): WorkerConfig {
  const worker = workers[mode];
  return { ...worker, entrypoint: resolve(import.meta.dirname, '../..', worker.entrypoint) };
}
