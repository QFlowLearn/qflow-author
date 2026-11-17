import { resolve } from 'node:path';
import { testLane } from './lanes.ts';

/** Startup diagnostics are owned messages and never interpolate user-supplied values. */
export class TestCommandError extends Error {}

/** A guarded invocation: selection is resolved before any database connection or runner starts. */
export type TestCommand =
  | { readonly kind: 'help' }
  | {
    readonly kind: 'suite';
    readonly lane: 'ordinary' | 'browser';
    readonly database: 'qflow_test' | 'qflow_ci_test';
    readonly files: readonly string[];
    readonly watch: boolean;
  }
  | {
    readonly kind: 'worker';
    readonly database: 'qflow_test' | 'qflow_ci_test';
  }
  | {
    readonly kind: 'a11y';
    readonly database: 'qflow_test' | 'qflow_ci_test';
  };

/** Interpret supported Vitest file filters and mode flags; never silently ignore arguments. */
export function parseTestCommand(args: readonly string[]): TestCommand {
  const [lane, selection, ...trailing] = args;
  if (!['ordinary', 'browser', 'worker', 'a11y'].includes(lane ?? '')) {
    throw new TestCommandError('Select an ordinary, browser, worker or a11y test lane.');
  }
  if (selection !== '--database=qflow_test' && selection !== '--database=qflow_ci_test') {
    throw new TestCommandError(
      'Explicitly select --database=qflow_test or --database=qflow_ci_test.',
    );
  }
  const database = selection === '--database=qflow_test' ? 'qflow_test' : 'qflow_ci_test';
  const filters: string[] = [];
  let mode: 'run' | 'watch' | undefined;
  let help = false;
  for (const arg of trailing) {
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--watch' || arg === '-w' || arg === '--run') {
      const next = arg === '--run' ? 'run' : 'watch';
      if (mode && mode !== next) throw new TestCommandError('Choose --watch or --run, not both.');
      mode = next;
      continue;
    }
    if (!arg || arg.startsWith('-')) {
      throw new TestCommandError(
        'Unsupported test option. Use --help for file filters, --watch and --run.',
      );
    }
    filters.push(arg.replace(/^\.\//, ''));
  }
  if (help) return { kind: 'help' };
  if (lane === 'worker' || lane === 'a11y') {
    if (filters.length || mode) {
      throw new TestCommandError('Worker and a11y lanes do not accept file filters or mode flags.');
    }
    return { kind: lane, database };
  }
  if (lane !== 'ordinary' && lane !== 'browser') throw new TestCommandError('Invalid suite lane.');
  const available = testLane(lane);
  for (const filter of filters) {
    if (!available.some((file) => file.includes(filter) || resolve(file).includes(filter))) {
      throw new TestCommandError(
        'A file filter matches no tests in this lane. Use pnpm test for ordinary tests or pnpm test:e2e:built for browser tests; use --help for examples.',
      );
    }
  }
  const files = filters.length
    ? available.filter((file) =>
      filters.some((filter) => file.includes(filter) || resolve(file).includes(filter))
    )
    : available;
  if (!files.length) throw new TestCommandError('The selected test lane has no registered files.');
  return { kind: 'suite', lane, database, files, watch: mode === 'watch' };
}

/** The CLI deliberately exposes file selection and watch without exposing config/database overrides. */
export const testCommandHelp = `QFlow tests (guarded PostgreSQL QA database)

  pnpm test                                  Run all ordinary tests once
  pnpm test -- tests/local_development_test.ts
  pnpm test -- local_development              Select files by path substring
  pnpm test -- --watch local_development      Watch selected files and dependencies
  pnpm test -- --run local_development        Explicit one-shot run
  pnpm test:e2e:built -- tests/hono/runtime.test.ts

Browser tests need a current pnpm build. Filters stay inside the selected lane.
--watch / -w, --run, --help / -h are supported; other options fail explicitly.
Watch is interactive development; pnpm verify retains the complete mandatory gates.
`;
