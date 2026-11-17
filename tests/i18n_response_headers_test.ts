import { expect, test as testCase } from 'vitest';

import { applyLocalizedResponseHeaders } from '../lib/http/request_policy.ts';

testCase('localized response headers seed, refresh, or omit locale cookie correctly', () => {
  const url = new URL('https://qflow.example/login');
  const seeded = applyLocalizedResponseHeaders(
    url,
    new Response('', { headers: { 'content-type': 'text/html' } }),
    null,
    'es-ES',
  );
  expect(seeded.headers.get('content-language')).toStrictEqual('es-ES');
  expect(seeded.headers.get('set-cookie')?.includes('qflow-locale=es-ES')).toStrictEqual(true);
  const stale = applyLocalizedResponseHeaders(
    url,
    new Response('', { headers: { 'content-type': 'text/html' } }),
    'es-ES',
    'en-US',
  );
  expect(stale.headers.get('set-cookie')?.includes('qflow-locale=en-US')).toStrictEqual(true);
  const matching = applyLocalizedResponseHeaders(
    url,
    new Response('', { headers: { 'content-type': 'text/html' } }),
    'en-US',
    'en-US',
  );
  expect(matching.headers.get('set-cookie')).toStrictEqual(null);
  const binary = applyLocalizedResponseHeaders(
    url,
    new Response('', { headers: { 'content-type': 'application/json' } }),
    null,
    'es-ES',
  );
  expect(binary.headers.get('content-language')).toStrictEqual(null);
  expect(binary.headers.get('set-cookie')).toStrictEqual(null);
});
