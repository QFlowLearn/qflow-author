import { expect, test as testCase } from 'vitest';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('migration batch assessment ratios use locale number formatting', () => {
  const expected: Readonly<Record<'en-US' | 'es-ES', string>> = {
    'en-US': '12,345 of 67,890 assessments',
    'es-ES': '12.345 de 67.890 evaluaciones',
  };
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const actual = i18n.t('imports.batch.assessmentRatio', { assigned: 12345, total: 67890 });
    if (locale === 'en-US' || locale === 'es-ES') expect(actual).toStrictEqual(expected[locale]);
  }
});
