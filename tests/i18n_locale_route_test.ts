import { expect, test as testCase } from 'vitest';

import { localeMutationResponse } from '../lib/http/routes/public_pages/locale.ts';
import { localeRoute as localeHandlerEndpoint } from '../lib/http/routes/public_pages/locale.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const localeHandler = localeHandlerEndpoint.handle;

testCase('locale route source implements explicit form redirect', () => {
  const form = new FormData();
  form.set('locale', 'es-419');
  form.set('next', '/assessments?x=1');
  const response = localeMutationResponse(new URL('https://qflow.example/signup'), form);
  expect(response.status).toStrictEqual(303);
  expect(response.headers.get('location')).toStrictEqual('/assessments?x=1');
  expect(response.headers.get('set-cookie')?.includes('qflow-locale=es-419')).toStrictEqual(true);
});

testCase('locale route rejects malformed forms and unsafe redirects', () => {
  for (const value of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE']) {
    const form = new FormData();
    form.set('locale', value);
    expect(localeMutationResponse(new URL('https://qflow.example/login'), form).status)
      .toStrictEqual(303);
  }
  for (const value of ['', 'fr-FR', 'en-US\nfoo']) {
    const form = new FormData();
    form.set('locale', value);
    expect(localeMutationResponse(new URL('https://qflow.example/login'), form).status)
      .toStrictEqual(400);
  }
  const unsafe = new FormData();
  unsafe.set('locale', 'en-US');
  unsafe.set('next', 'https://evil.example');
  expect(
    localeMutationResponse(new URL('https://qflow.example/login'), unsafe).headers.get('location'),
  ).toStrictEqual('/login');
  const duplicate = new FormData();
  duplicate.append('locale', 'en-US');
  duplicate.append('locale', 'es-ES');
  expect(localeMutationResponse(new URL('https://qflow.example/login'), duplicate).status)
    .toStrictEqual(400);
});

testCase('locale route returns a local machine-code method error', async () => {
  const response = await invokeHttpRoute(
    localeHandler,
    makeHttpRequest(new Request('https://qflow.example/api/locale', { method: 'GET' })),
  );
  expect(response.status).toStrictEqual(405);
  expect(await response.json()).toStrictEqual({ code: 'method_not_allowed' });
});
