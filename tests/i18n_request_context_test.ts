import { expect, test as testCase } from 'vitest';

import { resolveInterfaceLocale } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';

testCase('request resolver isolates concurrent locale state and precedence', async () => {
  const cases = [
    [null, 'qflow-locale=es-ES', 'en-GB', 'es-ES'],
    [null, null, 'en-GB', 'en-GB'],
    ['es-419', 'qflow-locale=en-US', 'en-GB', 'es-419'],
  ] as const;
  for (const [persisted, cookie, header, expected] of cases) {
    expect(resolveInterfaceLocale(persisted, cookie, header)).toStrictEqual(expected);
  }
  const us = createI18n('en-US', { core: { greeting: 'Hello' } });
  const es = createI18n('es-ES', { core: { greeting: 'Hola' } });
  const renderSequence = async (runtime: typeof us, delay: number): Promise<[string, string]> => {
    const before = runtime.t('greeting');
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    const after = runtime.t('greeting');
    return [before, after];
  };
  const rendered = await Promise.all([
    renderSequence(us, 15),
    renderSequence(es, 1),
  ]);
  expect(rendered).toStrictEqual([['Hello', 'Hello'], ['Hola', 'Hola']]);
  expect(us.t('greeting')).toStrictEqual('Hello');
  expect(es.t('greeting')).toStrictEqual('Hola');
  expect(resolveInterfaceLocale('en-US', 'qflow-locale=es-ES', 'es-ES')).toStrictEqual('en-US');
});

testCase('Swedish account and cookie preferences take precedence over browser language', () => {
  expect(resolveInterfaceLocale('sv-SE', 'qflow-locale=en-US', 'en-GB')).toStrictEqual('sv-SE');
  expect(resolveInterfaceLocale(null, 'qflow-locale=sv-SE', 'en-US')).toStrictEqual('sv-SE');
  expect(resolveInterfaceLocale('en-US', 'qflow-locale=sv-SE', 'sv-SE')).toStrictEqual('en-US');
});
