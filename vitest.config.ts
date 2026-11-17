import { defineConfig } from 'vitest/config';
import { testFiles } from './tools/testing/files.ts';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    allowOnly: false,
    include: [...testFiles],
    fileParallelism: false,
    testTimeout: process.env.QFLOW_BROWSER_TESTS === '1' ? 300_000 : 120_000,
    hookTimeout: 120_000,
  },
});
