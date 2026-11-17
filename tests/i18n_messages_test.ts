import { expect, test as testCase } from 'vitest';

import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

testCase('catalog IDs are semantic and payload is serializable', () => {
  const catalog = catalogForLocale('en-US');
  const i18n = createI18n('en-US', catalog);
  expect(i18n.t('nav.dashboard')).toStrictEqual('Dashboard');
  expect(() => i18n.t('core.nav.dashboard')).toThrowError(Error);
  const payload = createI18nPayload('en-US', catalog, ['core']);
  expect(Object.keys(payload.namespaces)).toStrictEqual(['core']);
  JSON.stringify(payload);
});

testCase('ICU plural and missing messages fail fast', () => {
  const i18n = createI18n('en-US', {
    core: { 'core.count': '{n, plural, one {# item} other {# items}}' },
  });
  expect(i18n.t('core.count', { n: 2 })).toStrictEqual('2 items');
  expect(() => i18n.t('missing')).toThrowError(Error);
});

testCase('all supported locales provide distinct named formatting APIs', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, {
      core: {
        count: locale.startsWith('es')
          ? '{n, plural, one {# elemento} other {# elementos}}'
          : '{n, plural, one {# item} other {# items}}',
      },
    });
    const expected = {
      'en-US': ['Jan 2, 2026', '3:04 AM', '1,235'],
      'en-GB': ['2 Jan 2026', '3:04', '1,235'],
      'es-ES': ['2 ene 2026', '3:04', '1235'],
      'es-419': ['2 ene 2026', '3:04 a.m.', '1,235'],
    }[locale];
    expect([
      i18n.formatDateNamed(new Date('2026-01-02T03:04:00Z')),
      i18n.formatTimeNamed(new Date('2026-01-02T03:04:00Z')),
      i18n.formatNumberNamed(1234.5),
    ]).toStrictEqual(expected);
    expect(i18n.formatPercent(0.5)).toStrictEqual(locale === 'es-ES' ? '50 %' : '50%');
    expect(i18n.formatList(['A', 'B'])).toStrictEqual(
      locale.startsWith('es') ? 'A y B' : 'A and B',
    );
    expect(i18n.formatRelativeTime(-1, 'day')).toStrictEqual(
      locale.startsWith('es') ? 'ayer' : 'yesterday',
    );
    expect(i18n.t('count', { n: 1 })).toStrictEqual(
      locale.startsWith('es') ? '1 elemento' : '1 item',
    );
    expect(i18n.t('count', { n: 2 })).toStrictEqual(
      locale.startsWith('es') ? '2 elementos' : '2 items',
    );
    const collatorLocale =
      { 'en-US': 'en-US', 'en-GB': 'en', 'es-ES': 'es', 'es-419': 'es' }[locale];
    expect(i18n.collator.resolvedOptions().locale).toStrictEqual(collatorLocale);
    expect(i18n.collator.compare('a', 'b') < 0).toStrictEqual(true);
  }
});

testCase('Swedish runtime renders translated plurals and Swedish formatting', () => {
  const i18n = createI18n('sv-SE', catalogForLocale('sv-SE'));
  expect(i18n.t('login.title')).toStrictEqual('Logga in');
  expect(i18n.t('list.count', { count: 1 })).toStrictEqual('1 prov');
  expect(i18n.t('assessments.builder.questionCount', { count: 2 })).toStrictEqual(
    '2 frågor i läsordning.',
  );
  expect(i18n.formatNumberNamed(1234.5)).toStrictEqual('1 235');
  expect(i18n.formatPercent(0.5)).toStrictEqual('50 %');
  expect(i18n.formatList(['A', 'B'])).toStrictEqual('A och B');
  expect(i18n.formatRelativeTime(-1, 'day')).toStrictEqual('i går');
  expect(i18n.formatDateNamed(new Date('2026-01-02T03:04:00Z'))).toStrictEqual('2 jan. 2026');
  expect(i18n.formatTimeNamed(new Date('2026-01-02T03:04:00Z'))).toStrictEqual('3:04');
});
