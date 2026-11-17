import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Resolve the pinned runner executable once for every test entry point. */
export const vitestCli = fileURLToPath(
  new URL('./vitest.mjs', import.meta.resolve('vitest/package.json')),
);

/** An owned command's terminal status and captured byte streams. */
export type CommandResult = {
  readonly success: boolean;
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
};

/** Observe process errors, drain captured streams and resolve only after the child has closed. */
export function runCommand(executable: string, args: readonly string[], options: {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly output?: 'capture' | 'inherit';
  readonly stdin?: 'ignore' | 'inherit';
} = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      signal: options.signal,
      stdio: [
        options.stdin ?? 'ignore',
        options.output === 'inherit' ? 'inherit' : 'pipe',
        options.output === 'inherit' ? 'inherit' : 'pipe',
      ],
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let failure: unknown;
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (cause: unknown) => {
      failure = cause;
    });
    child.once('close', (code, signal) => {
      if (failure) reject(failure);
      else {
        resolve({
          success: code === 0 && signal === null,
          code: code ?? 1,
          stdout: new Uint8Array(Buffer.concat(stdout)),
          stderr: new Uint8Array(Buffer.concat(stderr)),
        });
      }
    });
  });
}
