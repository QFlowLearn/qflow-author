import { expect, test as testCase } from 'vitest';

import {
  assertSharedBrowserEnvironment,
  parseSharedBrowserAppConfig,
} from '../tools/browser_app_config.ts';

const config = {
  QFLOW_BROWSER_APP_MODE: 'shared-built',
  QFLOW_BROWSER_APP_URL: 'http://127.0.0.1:55880',
  QFLOW_BROWSER_APP_ENV: JSON.stringify({ DATABASE_URL: 'fixture-db', FEATURE: '' }),
};

testCase(
  'shared built mode preserves explicit configuration and rejects fixture conflicts safely',
  () => {
    expect(parseSharedBrowserAppConfig({})).toStrictEqual(undefined);
    const shared = parseSharedBrowserAppConfig(config);
    if (!shared) throw new Error('Expected configured endpoint.');
    expect(shared.baseUrl).toStrictEqual(config.QFLOW_BROWSER_APP_URL);
    assertSharedBrowserEnvironment(shared, { DATABASE_URL: 'fixture-db', FEATURE: '' });
    const error = (() => {
      try {
        (() => assertSharedBrowserEnvironment(shared, { SECRET: 'never-log-me' }))();
      } catch (caught: unknown) {
        if (!(caught instanceof Error)) expect.unreachable('Expected Error');
        return caught;
      }
      return expect.unreachable('Expected an exception.');
    })();
    if (!(error instanceof Error)) throw new Error('Expected fixture conflict diagnostic.');
    expect(error.message.includes('SECRET')).toStrictEqual(true);
    expect(error.message.includes('never-log-me')).toStrictEqual(false);
  },
);

testCase('shared built mode fails on missing/invalid config and refuses to rewrite URLs', () => {
  for (
    const env of [
      { ...config, QFLOW_BROWSER_APP_MODE: '' },
      { ...config, QFLOW_BROWSER_APP_URL: '' },
      { ...config, QFLOW_BROWSER_APP_ENV: '' },
      { ...config, QFLOW_BROWSER_APP_ENV: '[]' },
      { ...config, QFLOW_BROWSER_APP_ENV: '{"SECRET":1}' },
    ]
  ) expect(() => parseSharedBrowserAppConfig(env)).toThrowError(Error);
  for (
    const url of [
      'https://127.0.0.1:55880',
      'http://example.com',
      'http://user:secret@127.0.0.1',
      'http://127.0.0.1/path',
      'http://127.0.0.1?secret=value',
      'http://127.0.0.1/#fragment',
      'http://127.0.0.1/path/..',
      'http://127.0.0.1/?',
    ]
  ) {
    expect(() => parseSharedBrowserAppConfig({ ...config, QFLOW_BROWSER_APP_URL: url }))
      .toThrowError(Error);
  }
});
