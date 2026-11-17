import { expect, test as testCase } from 'vitest';

import { parseSsoDomain, ssoDomainFromEmail } from '../lib/sso_domain.ts';

testCase('SSO domains are normalized at the boundary', () => {
  expect(parseSsoDomain(' Example.EDU. ')).toStrictEqual('example.edu');
  expect(ssoDomainFromEmail(' Admin@Example.EDU ')).toStrictEqual('example.edu');
});

testCase('SSO domain parser rejects malformed domains', () => {
  for (
    const value of [
      '',
      'localhost',
      '.example.edu',
      'example..edu',
      'example edu',
      42,
      null,
    ]
  ) {
    expect(parseSsoDomain(value)).toStrictEqual(null);
  }
  expect(ssoDomainFromEmail('not-an-email')).toStrictEqual(null);
});
