import { defineConfig } from 'cf/config';
import { testWorkerConfig } from './cloudflare_test_config.ts';

export default defineConfig({ worker: testWorkerConfig('workflow-test') });
