import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { parseTestCommand, TestCommandError } from '../tools/testing/command.ts';
import { testLane } from '../tools/testing/lanes.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';

const prefix = ['ordinary', '--database=qflow_test'];
const selected = 'tests/local_development_test.ts';

it('conventional file filters select exactly their registered lane files', () => {
  for (const filter of [selected, './' + selected, resolve(selected), 'local_development']) {
    expect(parseTestCommand([...prefix, '--', filter])).toEqual({
      kind: 'suite',
      lane: 'ordinary',
      database: 'qflow_test',
      files: [selected],
      watch: false,
    });
  }
  expect(parseTestCommand([...prefix, selected, 'local_development'])).toMatchObject({
    files: [selected],
  });
  expect(parseTestCommand(prefix)).toMatchObject({ files: testLane('ordinary'), watch: false });
  expect(parseTestCommand(['browser', '--database=qflow_ci_test', 'hono/runtime.test.ts']))
    .toMatchObject({
      lane: 'browser',
      database: 'qflow_ci_test',
      files: ['tests/hono/runtime.test.ts'],
    });
});

it('watch and run flags are explicit and malformed selections never run a wider suite', () => {
  for (const flag of ['--watch', '-w']) {
    expect(parseTestCommand([...prefix, flag, selected])).toMatchObject({
      files: [selected],
      watch: true,
    });
  }
  expect(parseTestCommand([...prefix, selected, '--run'])).toMatchObject({ watch: false });
  for (
    const trailing of [
      ['missing-test-file'],
      [selected, 'missing-test-file'],
      ['--config=unowned.ts'],
      ['--watch', '--run'],
      ['--database=qflow_dev'],
      ['--passWithNoTests'],
      ['tests/hono/runtime.test.ts'],
      [''],
    ]
  ) expect(() => parseTestCommand([...prefix, ...trailing])).toThrow(TestCommandError);
  expect(() => parseTestCommand(['ordinary', '--database=qflow_dev'])).toThrow(TestCommandError);
  expect(() => parseTestCommand(['worker', '--database=qflow_test', '--watch'])).toThrow(
    TestCommandError,
  );
  expect(() => parseTestCommand(['a11y', '--database=qflow_test', selected])).toThrow(
    TestCommandError,
  );
  expect(parseTestCommand([...prefix, '--help'])).toEqual({ kind: 'help' });
});

it('CLI help and invalid filters return before connecting to a database or starting Vitest', async () => {
  const entry = fileURLToPath(new URL('../tools/testing/run.ts', import.meta.url));
  for (const [argument, success] of [['--help', true], ['missing-test-file', false]] as const) {
    const result = await runCommand(process.execPath, [
      '--import',
      import.meta.resolve('tsx'),
      entry,
      ...prefix,
      argument,
    ], {
      env: { DATABASE_URL: 'postgres://private:credential@nonlocal.example.test/qflow_dev' },
    });
    expect(result.success).toBe(success);
    const output = new TextDecoder().decode(result.stdout);
    expect(output).not.toContain('Guarded QA database identity verified');
    expect(output).not.toContain('RUN  v');
    if (success) expect(output).toContain('pnpm test -- --watch');
    else expect(new TextDecoder().decode(result.stderr)).toContain('matches no tests');
    expect(output).not.toContain('credential');
    expect(new TextDecoder().decode(result.stderr)).not.toContain('credential');
  }
});

it('focused run and watch reject a nonlocal database before launching a test process', async () => {
  const entry = fileURLToPath(new URL('../tools/testing/run.ts', import.meta.url));
  for (const mode of ['--run', '--watch']) {
    const result = await runCommand(process.execPath, [
      '--import',
      import.meta.resolve('tsx'),
      entry,
      ...prefix,
      mode,
      selected,
    ], {
      env: { DATABASE_URL: 'postgres://private:credential@nonlocal.example.test/qflow_dev' },
    });
    expect(result.success).toBe(false);
    const output = new TextDecoder().decode(result.stdout);
    expect(output).not.toContain('RUN  v');
    expect(output).not.toContain('DEV  v');
    expect(output).not.toContain('Guarded QA database identity verified');
    expect(new TextDecoder().decode(result.stderr)).not.toContain('credential');
  }
});
