import { expect, test as testCase } from 'vitest';

import { buildLocaleCookie, matchAcceptLanguage, parseLocaleCookie } from '../lib/i18n/locale.ts';

testCase('interface locale matching uses exact supported region policy', () => {
  expect(matchAcceptLanguage('en-US')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('EN-gB')).toStrictEqual('en-GB');
  expect(matchAcceptLanguage('en')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('en-Latn-GB')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('en-GB-x-private')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('en-gb-x-private')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('en-AU')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('es')).toStrictEqual('es-ES');
  expect(matchAcceptLanguage('es-ES')).toStrictEqual('es-ES');
  expect(matchAcceptLanguage('es-Latn-ES')).toStrictEqual('es-ES');
  expect(matchAcceptLanguage('es-Latn')).toStrictEqual('es-ES');
  expect(matchAcceptLanguage('es-419')).toStrictEqual('es-419');
  expect(matchAcceptLanguage('es-MX')).toStrictEqual('es-419');
  expect(matchAcceptLanguage('es-Latn-AR')).toStrictEqual('es-419');
  expect(matchAcceptLanguage('es-x-private')).toStrictEqual('es-ES');
  expect(matchAcceptLanguage('es-ES-x-private')).toStrictEqual('es-ES');
  expect(matchAcceptLanguage('es-419-x-private')).toStrictEqual('es-419');
  expect(matchAcceptLanguage('es-MX-x-private')).toStrictEqual('es-419');
  expect(matchAcceptLanguage('ES-419')).toStrictEqual('es-419');
});

testCase('interface locale matching preserves quality and header order', () => {
  expect(matchAcceptLanguage('fr;q=1, en-GB;q=0.5')).toStrictEqual('en-GB');
  expect(matchAcceptLanguage('en-GB;q=0, es-419')).toStrictEqual('es-419');
  expect(matchAcceptLanguage('es-419;q=0.8, en-GB;q=0.8')).toStrictEqual('es-419');
  expect(matchAcceptLanguage('en;q=bogus, *;q=0.5')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('xx;q=0, *;q=1')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('not a language')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('*')).toStrictEqual('en-US');
  expect(matchAcceptLanguage('es-ES;q=0.000')).toStrictEqual('en-US');
});

testCase('locale cookie parses and is hardened', () => {
  expect(parseLocaleCookie('qflow-locale=es-ES')).toStrictEqual('es-ES');
  expect(buildLocaleCookie(new URL('https://qflow.example'), 'en-GB')).toStrictEqual(
    'qflow-locale=en-GB; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure',
  );
});

testCase('Swedish browser tags resolve to the Swedish catalog with header priorities', () => {
  for (const tag of ['sv', 'sv-SE', 'SV-se', 'sv-FI', 'sv-Latn-SE']) {
    expect(matchAcceptLanguage(tag)).toStrictEqual('sv-SE');
  }
  expect(matchAcceptLanguage('sv-SE;q=0, en-GB;q=0.5')).toStrictEqual('en-GB');
  expect(matchAcceptLanguage('sv;q=0.9, en-US;q=0.8')).toStrictEqual('sv-SE');
  expect(parseLocaleCookie('qflow-locale=sv-SE')).toStrictEqual('sv-SE');
  expect(buildLocaleCookie(new URL('https://qflow.example'), 'sv-SE')).toStrictEqual(
    'qflow-locale=sv-SE; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure',
  );
});
