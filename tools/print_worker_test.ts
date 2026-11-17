import { resolve } from 'node:path';
import { unstable_getMiniflareWorkerOptions, unstable_readConfig } from 'wrangler';

/** Explicit test-only name connects both Worker test projects to the real built compiler Worker. */
export function printTestWorker() {
  const config = unstable_readConfig({ config: resolve('build/print_renderer/wrangler.json') });
  const { workerOptions, main } = unstable_getMiniflareWorkerOptions(config, undefined, {
    overrides: { enableContainers: false },
  });
  if (!main) throw Error('Build the print renderer before running Worker tests.');
  return {
    ...workerOptions,
    name: 'qflow-test-print-renderer',
    modules: true as const,
    scriptPath: main,
  };
}
