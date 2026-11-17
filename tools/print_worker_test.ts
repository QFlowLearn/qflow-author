import { resolve } from 'node:path';
import { builtWorkerOptions, readAuthorBuild } from './cloudflare_build.ts';
import type { LegacyWorkerOptions } from 'miniflare';

/** The test plugin accepts legacy auxiliary module descriptors; source remains the native build. */
export async function printTestWorker(): Promise<LegacyWorkerOptions> {
  const { renderer } = await readAuthorBuild();
  const worker = await builtWorkerOptions(renderer, {});
  const manifest = worker.config.manifest;
  if (!manifest || !manifest.modulesRoot) {
    throw Error('Build the print renderer before running Worker tests.');
  }
  const modulesRoot = manifest.modulesRoot;
  const types = {
    esm: 'ESModule',
    cjs: 'CommonJS',
    wasm: 'CompiledWasm',
    data: 'Data',
    text: 'Text',
  } as const;
  return {
    name: 'qflow-test-print-renderer',
    compatibilityDate: worker.config.compatibilityDate,
    compatibilityFlags: worker.config.compatibilityFlags,
    modules: Object.entries(manifest.modules).filter(([, module]) => module.type !== 'sourcemap')
      .map(
        ([name, module]) => {
          if (
            !(module.type in types) || module.type === 'json' || module.type === 'sourcemap' ||
            module.type === 'python' || module.type === 'python-requirement'
          ) throw Error('Unsupported test compiler module.');
          return {
            type: types[module.type],
            path: resolve(modulesRoot, name),
            contents: module.contents,
          };
        },
      ),
    modulesRoot: manifest.modulesRoot,
  };
}
