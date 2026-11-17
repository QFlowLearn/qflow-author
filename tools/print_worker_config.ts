import { resolve } from 'node:path';
import { WorkerConfigSchema } from '@cloudflare/config';
import type { WorkerConfig } from '@cloudflare/vite-plugin';

/** Derive the separate compiler Worker from the application's explicit service target. */
export function printWorkerConfig(input: WorkerConfig): WorkerConfig {
  const binding = input.env?.QFLOW_PRINT_RENDERER;
  if (
    binding?.type !== 'worker' || typeof binding.worker !== 'string' ||
    binding.worker === input.name || binding.exportName
  ) {
    throw Error('Configure one default-entrypoint QFLOW_PRINT_RENDERER service target.');
  }
  const result = WorkerConfigSchema.safeParse({
    name: binding.worker,
    entrypoint: resolve('deploy/cloudflare/print_worker.entry.ts'),
    compatibilityDate: input.compatibilityDate,
    compatibilityFlags: input.compatibilityFlags,
    workersDev: false,
    previewUrls: false,
    limits: input.limits,
    observability: { enabled: true },
  });
  if (!result.success) {
    throw Error('Invalid print renderer configuration.', { cause: result.error });
  }
  return result.data;
}
