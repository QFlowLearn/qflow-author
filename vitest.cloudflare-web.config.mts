import { printTestWorker } from './tools/print_worker_test.ts';
import { clientAssetsPlugin } from './tools/client_assets.ts';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { requirePostgresDatabaseUrl } from './tools/test_database_url.ts';

const databaseUrl = requirePostgresDatabaseUrl(process.env.DATABASE_URL);

export default defineConfig({
  plugins: [
    clientAssetsPlugin({ edgeBuild: true, mode: 'built' }),
    cloudflareTest({
      config: './tools/testing/cloudflare_web.config.ts',
      remoteBindings: false,
      miniflare: {
        workers: [await printTestWorker()],
        hyperdrives: { QFLOW_DB: databaseUrl },
      },
    }),
  ],
  test: {
    allowOnly: false,
    include: [
      'cloudflare-tests/web_runtime.spec.ts',
      'cloudflare-tests/bank_topic_selection_runtime.spec.ts',
    ],
  },
});
