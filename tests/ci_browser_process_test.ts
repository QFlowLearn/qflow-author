import { expect, test as testCase } from 'vitest';

import { spawn } from 'node:child_process';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import { hasFileErrorCode } from '../tools/file_errors.ts';

import { runBrowserChecks } from '../tools/ci_browser_process.ts';

testCase(
  'browser process reports normal exit and fails if the built server exits during tests',
  async () => {
    const signal = new AbortController().signal;
    expect(
      await runBrowserChecks({
        args: ['--input-type=module', '--eval', 'process.exit(0)'],
        environment: {},
        signal,
      }),
    ).toStrictEqual(0);
    const server = spawn(process.execPath, ['--input-type=module', '--eval', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const serverExited = new Promise<{ code: number }>((resolve, reject) => {
      server.once('error', reject);
      server.once('close', (code) => resolve({ code: code ?? 1 }));
    });
    await expect(
      Promise.resolve().then(() =>
        runBrowserChecks({
          args: [
            '--input-type=module',
            '--eval',
            'setInterval(() => {}, 1000); await new Promise(() => {});',
          ],
          environment: {},
          signal,
          serverExited,
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Built app exited')
    );
  },
);

testCase('browser process bounds shutdown of a real child that ignores termination', async () => {
  const controller = new AbortController();
  const directory = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qflow-cancellation-test-'));
  const marker = `${directory}/ready`;
  // The child signals readiness through a file so cancellation cannot race signal installation.
  const child = runBrowserChecks({
    args: [
      '--input-type=module',
      '--eval',
      `import {writeFile} from 'node:fs/promises'; process.on('SIGTERM', () => {}); setInterval(()=>{},1000); await writeFile(${
        JSON.stringify(marker)
      }, 'ready'); await new Promise(() => {});`,
    ],
    environment: {},
    signal: controller.signal,
  });
  const deadline = Date.now() + 10000;
  try {
    while (Date.now() < deadline) {
      try {
        await _fs.stat(marker);
        break;
      } catch (cause: unknown) {
        if (!(hasFileErrorCode(cause, 'ENOENT'))) throw cause;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await _fs.stat(marker);
    controller.abort();
    await expect(Promise.resolve().then(() => child)).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Browser run cancelled')
    );
  } finally {
    controller.abort();
    await child.catch(() => {});
    await _fs.rm(directory, { recursive: true });
  }
});
