import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Miniflare } from 'miniflare';
import { startBuiltWorker } from '../../tools/start_built_worker.ts';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';

const browserOrigin = 'https://qflow-preview-5173.app.github.dev';
let runtime: Miniflare | undefined;
let directory: string | undefined;

beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true });
  directory = await mkdtemp(resolve('.artifacts/local-preview-'));
  const scriptPath = resolve(directory, 'worker.mjs');
  const entry = JSON.stringify(relative(directory, resolve('build/ssr/index.js')));
  const script = `import { createLocalWorker } from ${entry};
export * from ${entry};
export default createLocalWorker(${JSON.stringify(browserOrigin)});
`;
  runtime = await startBuiltWorker({
    mode: 'qa',
    databaseUrl: null,
    bindings: {
      ...builtWorkerBrowserEnvironment,
      QFLOW_SECURE_COOKIES: 'true',
      QFLOW_APP_ORIGIN: browserOrigin,
    },
    workerOverrides: { script, scriptPath },
  });
});

afterAll(async () => {
  await runtime?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('HTTP preview ingress preserves HTTPS cookies and accepts only the configured browser origin', async () => {
  if (!runtime) throw Error('Preview runtime did not start.');
  for (
    const [origin, expected] of [[browserOrigin, 200], [
      'https://attacker.example.test',
      403,
    ]] as const
  ) {
    const response = await runtime.dispatchFetch('http://127.0.0.1:5173/password/forgot', {
      method: 'POST',
      headers: { origin, 'x-forwarded-host': 'attacker.example.test', 'x-forwarded-proto': 'http' },
      body: new URLSearchParams({ email: 'invalid' }),
    });
    expect(response.status).toBe(expected);
    expect(response.headers.get('strict-transport-security')).toBeTruthy();
    if (expected === 200) {
      expect(response.headers.get('set-cookie')).toContain('Secure');
      expect(await response.text()).toContain('id="forgot-error"');
    } else await response.body?.cancel();
  }
});
