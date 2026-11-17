import { expect, test as testCase } from 'vitest';

import { findDuplicateJsonKeys, validateCatalogData } from '../tools/check_i18n_validator.ts';
import { CATALOGS } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';

testCase('checker rejects duplicate semantic IDs across namespaces', () => {
  const diagnostics = validateCatalogData(
    { 'shared.id': { screen: 'x', meaning: 'x', interpolation: 'none' } },
    { 'en-US': { a: { 'shared.id': 'One' }, b: { 'shared.id': 'Two' } } },
  );
  expect(diagnostics.some((item) => item.includes('duplicate message ID shared.id'))).toStrictEqual(
    true,
  );
});

testCase('all registered locales construct complete i18n runtimes', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
    createI18n(locale, CATALOGS[locale]);
  }
});

testCase('checker validator reports malformed catalog contracts', () => {
  const diagnostics = validateCatalogData({ known: {}, orphan: {} }, {
    'en-US': { core: { known: '{count, plural, one {one}' } },
    'es-ES': { other: { extra: '' } },
  });
  expect(diagnostics.some((item) => item.includes('invalid ICU'))).toStrictEqual(true);
  expect(diagnostics.some((item) => item.includes('namespace mismatch'))).toStrictEqual(true);
  expect(diagnostics.some((item) => item.includes('orphan context'))).toStrictEqual(true);
  expect(validateCatalogData([], {}).length > 0).toStrictEqual(true);
  expect(
    validateCatalogData({}, { 'en-US': { core: { x: 'x' } } }).some((item) =>
      item.includes('missing context')
    ),
  ).toStrictEqual(true);
  expect(
    validateCatalogData({ x: {} }, { 'en-US': { core: { y: 'y' } } }).some((item) =>
      item.includes('orphan context')
    ),
  ).toStrictEqual(true);
  expect(
    validateCatalogData({}, { 'fr-FR': {} }).some((item) => item.includes('unsupported locale')),
  ).toStrictEqual(true);
});

testCase('checker reports semantic ICU and context contract mismatches', () => {
  const base = {
    'en-US': {
      core: {
        a: '{count}',
        b: '{value, number}',
        c: '{n, plural, offset:1 one {x} other {{n, select, male {m} other {o}}}}',
      },
    },
  };
  const context = {
    a: {},
    b: {},
    c: {},
    orphan: { screen: 'x', meaning: 'x', interpolation: 'none' },
  };
  const target = {
    'en-US': base['en-US'],
    'en-GB': {
      core: {
        a: '{total}',
        b: '{value, date}',
        c: '{n, plural one {x} few {y}}',
      },
    },
  };
  const diagnostics = validateCatalogData(context, target);
  expect(diagnostics.some((item) => item.includes('invalid context shape'))).toStrictEqual(true);
  expect(diagnostics.some((item) => item.includes('ICU contract mismatch'))).toStrictEqual(true);
  expect(diagnostics.some((item) => item.includes('orphan context'))).toStrictEqual(true);
});

testCase('checker permits translated literal and placeholder order', () => {
  const context = { x: { screen: 'x', meaning: 'x', interpolation: 'count number' } };
  const diagnostics = validateCatalogData(context, {
    'en-US': { core: { x: 'Part {part, number} settings' } },
    'en-GB': { core: { x: 'Settings for part {part, number}' } },
    'es-ES': { core: { x: 'Configuración de la parte {part, number}' } },
    'es-419': { core: { x: 'Configuración de la parte {part, number}' } },
  });
  expect(diagnostics.some((item) => item.includes('ICU contract mismatch'))).toStrictEqual(false);
});

const testCatalogs = (source: string, translation: string) => ({
  'en-US': { core: { x: source } },
  'en-GB': { core: { x: translation } },
  'es-ES': { core: { x: translation } },
  'es-419': { core: { x: translation } },
});
const testContext = { x: { screen: 'test', meaning: 'test', interpolation: 'none' } };
const hasIcuMismatch = (catalogs: unknown): boolean =>
  validateCatalogData(testContext, catalogs).some((item) => item.includes('ICU contract mismatch'));

testCase('checker permits reordered differently typed placeholders', () => {
  expect(hasIcuMismatch(testCatalogs('{first} {second, number}', '{second, number} — {first}')))
    .toStrictEqual(false);
});

testCase('checker permits reordered placeholders inside plural and select options', () => {
  const source = '{count, plural, one {{first} {second, number}} other {{first} {second, number}}}';
  const reordered =
    '{count, plural, one {{second, number} {first}} other {{second, number} {first}}}';
  expect(hasIcuMismatch(testCatalogs(source, reordered))).toStrictEqual(false);

  const selectSource =
    '{gender, select, male {{first} {second, number}} other {{first} {second, number}}}';
  const selectReordered =
    '{gender, select, male {{second, number} {first}} other {{second, number} {first}}}';
  expect(hasIcuMismatch(testCatalogs(selectSource, selectReordered))).toStrictEqual(false);
});

testCase('checker rejects renamed or missing nested variables', () => {
  const source = '{count, plural, one {{first} {second, number}} other {{first} {second, number}}}';
  const renamed =
    '{count, plural, one {{renamed} {second, number}} other {{renamed} {second, number}}}';
  const missing = '{count, plural, one {{first}} other {{first}}}';
  expect(hasIcuMismatch(testCatalogs(source, renamed))).toStrictEqual(true);
  expect(hasIcuMismatch(testCatalogs(source, missing))).toStrictEqual(true);
});

testCase('checker rejects changed number and date formats', () => {
  expect(hasIcuMismatch(testCatalogs('{value, number}', '{value, date}'))).toStrictEqual(true);
});

testCase('checker rejects changed plural kind, offset, or option keys', () => {
  const source = '{count, plural, offset:1 one {{first}} other {{second}}}';
  expect(hasIcuMismatch(testCatalogs(source, '{count, select, one {{first}} other {{second}}}')))
    .toStrictEqual(true);
  expect(hasIcuMismatch(
    testCatalogs(source, '{count, plural, offset:2 one {{first}} other {{second}}}'),
  )).toStrictEqual(true);
  expect(hasIcuMismatch(
    testCatalogs(source, '{count, plural, one {{first}} few {{second}} other {{second}}}'),
  )).toStrictEqual(true);
});

testCase('checker rejects a message value equal to its ID', () => {
  const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'];
  const catalogs = Object.fromEntries(
    locales.map((
      locale,
    ) => [locale, { auth: { 'auth.bad': locale === 'es-ES' ? 'auth.bad' : 'Translated' } }]),
  );
  const diagnostics = validateCatalogData(
    { 'auth.bad': { screen: 'test', meaning: 'test', interpolation: 'none' } },
    catalogs,
  );
  expect(diagnostics.some((item) => item.includes('message equals its ID'))).toStrictEqual(true);
});

testCase('JSON duplicate-key scanner handles nested, escaped, and array objects', () => {
  expect(findDuplicateJsonKeys('{"x":1,"x":2}')).toStrictEqual(['x']);
  expect(findDuplicateJsonKeys('{"outer":{"key":1,"key":2}}')).toStrictEqual(['outer.key']);
  expect(findDuplicateJsonKeys('{"a\\u0062":1,"ab":2}')).toStrictEqual(['ab']);
  expect(findDuplicateJsonKeys('{"a":{"key":1},"b":{"key":2}}')).toStrictEqual([]);
  expect(findDuplicateJsonKeys('[{"key":1,"key":2},{"key":3}]')).toStrictEqual(['[0].key']);
});

testCase('JSON duplicate-key scanner rejects malformed JSON', () => {
  let malformed = false;
  try {
    findDuplicateJsonKeys('{"unterminated":');
  } catch (error) {
    malformed = error instanceof SyntaxError;
  }
  expect(malformed).toStrictEqual(true);
});

testCase('JSON duplicate-key scanner catches duplicate locale message IDs', () => {
  const localeNamespace =
    '{"settings.sso.saving":"Saving…","settings.sso.saving":"Saving SSO policy…"}';
  expect(findDuplicateJsonKeys(localeNamespace)).toStrictEqual(['settings.sso.saving']);
});

testCase('JSON duplicate-key scanner catches duplicate message-context IDs', () => {
  const messageContext =
    '{"settings.sso.saving":{"screen":"form","meaning":"status","interpolation":"none"},' +
    '"settings.sso.saving":{"screen":"card","meaning":"policy status","interpolation":"none"}}';
  expect(findDuplicateJsonKeys(messageContext)).toStrictEqual(['settings.sso.saving']);
});
