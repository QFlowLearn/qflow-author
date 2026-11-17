import { expect, test as testCase } from 'vitest';

import { privateResponse } from '../lib/http/private_response.ts';

testCase('privateResponse applies sensitive-page response headers', async () => {
  const response = await privateResponse(Promise.resolve(new Response('private')));

  expect(response.headers.get('cache-control')).toStrictEqual('no-store');
  expect(response.headers.get('referrer-policy')).toStrictEqual('strict-origin');
  expect(await response.text()).toStrictEqual('private');
});
