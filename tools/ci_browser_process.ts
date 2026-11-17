import { spawn } from 'node:child_process';

/** Runs one serial Node browser command with bounded cancellation and production-server monitoring. */
export async function runBrowserChecks(input: {
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly serverExited?: Promise<{ readonly code: number }>;
  readonly cwd?: string;
}): Promise<number> {
  if (input.signal.aborted) throw new Error('Browser run cancelled before spawning tests.');
  const child = spawn(process.execPath, [...input.args], {
    env: { ...process.env, ...input.environment },
    cwd: input.cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const status = new Promise<{ code: number }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1 }));
  });
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let serverStopped = false;
  const stop = () => {
    if (finished || shutdownTimer !== undefined) return;
    try {
      child.kill('SIGTERM');
    } catch { /* Already stopped. */ }
    shutdownTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch { /* Already stopped. */ }
    }, 5000);
  };
  input.signal.addEventListener('abort', stop, { once: true });
  try {
    const code = await Promise.race([
      status.then((result) => result.code),
      ...(input.serverExited
        ? [input.serverExited.then(async () => {
          if (finished) return 0;
          serverStopped = true;
          stop();
          await status;
          throw new Error('Built app exited while browser checks were running.');
        })]
        : []),
    ]);
    if (input.signal.aborted) throw new Error('Browser run cancelled.');
    if (serverStopped) throw new Error('Built app exited while browser checks were running.');
    return code;
  } finally {
    finished = true;
    input.signal.removeEventListener('abort', stop);
    clearTimeout(shutdownTimer);
  }
}
