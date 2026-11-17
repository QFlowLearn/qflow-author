import { expect, test as testCase } from 'vitest';
import { makeHttpRequest } from './helpers/http_route.ts';

import { homePageRoute as rootHandlerEndpoint } from '../lib/http/routes/public_pages/home.tsx';

const rootHandler = rootHandlerEndpoint.handle;

const rootGet = rootHandler;

testCase('root route redirects to login', async () => {
  if (!rootGet) throw new Error('Root GET handler is not defined.');

  const req = new Request('https://app.example.test/', { method: 'GET' });
  const res = await rootGet(makeHttpRequest(req, { omitAuth: true }));

  expect(res.status).toStrictEqual(302);
  expect(res.headers.get('location')).toStrictEqual('/login');
});
