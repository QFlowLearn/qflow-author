import { printTestWorker } from './tools/print_worker_test.ts';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import { requirePostgresDatabaseUrl } from './tools/test_database_url.ts';

const databaseUrl = requirePostgresDatabaseUrl(process.env.DATABASE_URL);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.workflow-test.jsonc' },
      miniflare: {
        workers: [printTestWorker()],
        bindings: { DATABASE_URL: databaseUrl },
        hyperdrives: { QFLOW_DB: databaseUrl },
      },
    }),
  ],
  test: {
    allowOnly: false,
    // These suites share one real PostgreSQL outbox and assert complete dispatcher results.
    fileParallelism: false,
    include: [
      'cloudflare-tests/workflows_runtime.spec.ts',
      'cloudflare-tests/bank_enrichment_runtime.spec.ts',
      'cloudflare-tests/question_organization_runtime.spec.ts',
      'cloudflare-tests/package_zip_runtime.spec.ts',
      'cloudflare-tests/pdf_source_runtime.spec.ts',
      ...(process.env.QFLOW_ARC_PACKAGE ? ['cloudflare-tests/arc_scale_runtime.spec.ts'] : []),
      ...(process.env.QFLOW_ORGANIZATION_SCALE === '1'
        ? ['cloudflare-tests/organization_scale_runtime.spec.ts']
        : []),
      'cloudflare-tests/bank_release_runtime.spec.ts',
      'cloudflare-tests/release_artifact_runtime.spec.ts',
      'cloudflare-tests/assessment_print_runtime.spec.ts',
    ],
  },
});
