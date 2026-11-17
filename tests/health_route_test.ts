import { expect, test as testCase } from 'vitest';

import { createHealthRoute as createHealthHandler } from '../lib/http/routes/public_pages/health.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

testCase('health route returns 200 when database probe passes', async () => {
  const handler = createHealthHandler({
    checkDatabase: () => Promise.resolve(),
    now: () => new Date('2026-02-16T10:15:00.000Z'),
  });

  const res = await invokeHttpRoute(
    handler,
    makeHttpRequest(
      new Request('https://example.test/health', { method: 'GET' }),
      { omitAuth: true },
    ),
  );

  expect(res.status).toStrictEqual(200);
  expect(res.headers.get('cache-control')).toStrictEqual('no-store, max-age=0');
  const body = await res.json();
  expect(body.status).toStrictEqual('ok');
  expect(body.timestamp).toStrictEqual('2026-02-16T10:15:00.000Z');
  expect(body.checks.database).toStrictEqual('ok');
});

testCase('health route returns 503 when database probe fails', async () => {
  const handler = createHealthHandler({
    checkDatabase: () => Promise.reject(new Error('db offline')),
    now: () => new Date('2026-02-16T10:16:00.000Z'),
  });

  const res = await invokeHttpRoute(
    handler,
    makeHttpRequest(
      new Request('https://example.test/health', { method: 'GET' }),
      { omitAuth: true },
    ),
  );

  expect(res.status).toStrictEqual(503);
  const body = await res.json();
  expect(body.status).toStrictEqual('degraded');
  expect(body.timestamp).toStrictEqual('2026-02-16T10:16:00.000Z');
  expect(body.checks.database).toStrictEqual('error');
});

testCase('health route rejects unsupported methods', async () => {
  const handler = createHealthHandler({
    checkDatabase: () => Promise.resolve(),
  });

  const res = await invokeHttpRoute(
    handler,
    makeHttpRequest(
      new Request('https://example.test/health', { method: 'POST' }),
      { omitAuth: true },
    ),
  );

  expect(res.status).toStrictEqual(405);
  expect(res.headers.get('allow')).toStrictEqual('GET, HEAD');
  expect(await res.text()).toStrictEqual('Method Not Allowed');
});
