import { expect, test as testCase } from 'vitest';

import { catalogForLocale, CATALOGS } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const LOCALES: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];

testCase('item-bank catalogs are complete peers and construct runtimes', () => {
  const source = CATALOGS['en-US'].items;
  for (const locale of LOCALES) {
    const catalog = catalogForLocale(locale);
    expect(Object.keys(catalog.items)).toStrictEqual(Object.keys(source));
    createI18n(locale, catalog);
  }
});

testCase('en-GB is English and Spanish item-bank copy is translated', () => {
  const source = CATALOGS['en-US'].items;
  const british = CATALOGS['en-GB'].items;
  expect(Object.keys(british)).toStrictEqual(Object.keys(source));
  const forbiddenSpanish = ['Banco de preguntas', 'Preguntas', 'Buscar', 'Borrar'];
  if (
    !(forbiddenSpanish.every((word) =>
      !Object.values(british).some((value) => value.includes(word))
    ))
  ) {
    expect.unreachable(
      'Expected forbiddenSpanish.every((word) => !Object.values(british).some((value) => value.includes(wo',
    );
  }

  const forbiddenEnglish = [
    'The item-bank',
    'Choose ',
    'Bulk action',
    'Apply filters',
    'Transfer ownership',
    'Title or question content',
    'All types',
    'Question type',
    'Search',
    'Tags',
    'Owner',
  ];
  for (const locale of ['es-ES', 'es-419'] as const) {
    const values = Object.values(CATALOGS[locale].items);
    if (!(forbiddenEnglish.every((phrase) => !values.some((value) => value.includes(phrase))))) {
      expect.unreachable(
        'Expected forbiddenEnglish.every((phrase) => !values.some((value) => value.includes(phrase)))',
      );
    }
  }
  expect(CATALOGS['es-ES'].items['items.bulk.addTags']).toStrictEqual('Añadir etiquetas');
  expect(CATALOGS['es-419'].items['items.bulk.addTags']).toStrictEqual('Agregar etiquetas');
  for (const locale of LOCALES) {
    const message = CATALOGS[locale].items['items.bulkForm.invalidFieldShape'];
    if (
      !(message.toLowerCase().includes('once') || message.toLowerCase().includes('una sola vez'))
    ) {
      expect.unreachable(
        "Expected message.toLowerCase().includes('once') || message.toLowerCase().includes('una sola vez')",
      );
    }
    if (!(message.toLowerCase().includes('text') || message.toLowerCase().includes('texto'))) {
      expect.unreachable(
        "Expected message.toLowerCase().includes('text') || message.toLowerCase().includes('texto')",
      );
    }
    if (
      !(message.toLowerCase().includes('file') ||
        message.toLowerCase().includes('archivo') ||
        message.toLowerCase().includes('carga'))
    ) {
      expect.unreachable(
        "Expected message.toLowerCase().includes('file') || message.toLowerCase().includes('archivo') || mes",
      );
    }
    if (
      !(message.toLowerCase().includes('not supported') ||
        message.toLowerCase().includes('no son compatibles'))
    ) {
      expect.unreachable(
        "Expected message.toLowerCase().includes('not supported') || message.toLowerCase().includes('no son ",
      );
    }
  }
  expect(CATALOGS['es-ES'].items['items.bulk.tagsHint']).toStrictEqual(
    'Solo para acciones de etiquetas',
  );
  expect(CATALOGS['es-419'].items['items.bulk.tagsHint']).toStrictEqual(
    'Solo para acciones de etiquetas',
  );
  if (!(CATALOGS['es-ES'].items['items.bulk.choose'].startsWith('Selecciona'))) {
    expect.unreachable(
      "Expected CATALOGS['es-ES'].items['items.bulk.choose'].startsWith('Selecciona')",
    );
  }
  if (!(CATALOGS['es-419'].items['items.bulk.choose'].startsWith('Elige'))) {
    expect.unreachable(
      "Expected CATALOGS['es-419'].items['items.bulk.choose'].startsWith('Elige')",
    );
  }
});

testCase(
  'item-bank result, review, compatibility, and picker messages cover their contracts',
  () => {
    for (const locale of LOCALES) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      if (!(i18n.t('items.results.total', { count: 0 }).length > 0)) {
        expect.unreachable("Expected i18n.t('items.results.total', { count: 0 }).length > 0");
      }
      if (!(i18n.t('items.results.total', { count: 1 }).includes('1'))) {
        expect.unreachable("Expected i18n.t('items.results.total', { count: 1 }).includes('1')");
      }
      if (!(i18n.t('items.results.total', { count: 4 }).includes('4'))) {
        expect.unreachable("Expected i18n.t('items.results.total', { count: 4 }).includes('4')");
      }
      if (!(i18n.t('items.results.page', { page: 2, pages: 7 }).includes('2'))) {
        expect.unreachable(
          "Expected i18n.t('items.results.page', { page: 2, pages: 7 }).includes('2')",
        );
      }
      if (!(i18n.t('items.results.select', { title: 'Authored item' }).includes('Authored item'))) {
        expect.unreachable(
          "Expected i18n.t('items.results.select', { title: 'Authored item' }).includes('Authored item')",
        );
      }
      if (!(i18n.t('items.results.owner', { name: 'Ada Example' }).includes('Ada Example'))) {
        expect.unreachable(
          "Expected i18n.t('items.results.owner', { name: 'Ada Example' }).includes('Ada Example')",
        );
      }
      if (!(i18n.t('items.results.exactCopy', { count: 1 }).includes('1'))) {
        expect.unreachable(
          "Expected i18n.t('items.results.exactCopy', { count: 1 }).includes('1')",
        );
      }
      if (!(i18n.t('items.results.exactCopy', { count: 3 }).includes('3'))) {
        expect.unreachable(
          "Expected i18n.t('items.results.exactCopy', { count: 3 }).includes('3')",
        );
      }
      if (!(i18n.t('items.memberPicker.resultCount', { count: 1 }).includes('1'))) {
        expect.unreachable(
          "Expected i18n.t('items.memberPicker.resultCount', { count: 1 }).includes('1')",
        );
      }
      if (!(i18n.t('items.memberPicker.resultCount', { count: 3 }).includes('3'))) {
        expect.unreachable(
          "Expected i18n.t('items.memberPicker.resultCount', { count: 3 }).includes('3')",
        );
      }
      if (
        !(i18n.t('items.memberPicker.selected', { label: 'Grace Hopper' }).includes('Grace Hopper'))
      ) {
        expect.unreachable(
          "Expected i18n.t('items.memberPicker.selected', { label: 'Grace Hopper' }).includes('Grace Hopper')",
        );
      }
      for (const outcome of ['exact', 'normalized', 'lossy', 'blocked'] as const) {
        const rendered = i18n.t('items.compatibility.selected', { outcome });
        if (!(rendered.length > outcome.length)) {
          expect.unreachable('Expected rendered.length > outcome.length');
        }
        if (rendered.includes(outcome)) {
          expect.unreachable('Expected !rendered.includes(outcome)');
        }
      }
      for (
        const counts of [
          { exactCount: 0, normalizedCount: 0, attentionCount: 0 },
          { exactCount: 1, normalizedCount: 2, attentionCount: 1 },
          { exactCount: 3, normalizedCount: 1, attentionCount: 4 },
        ]
      ) {
        const summary = i18n.t('items.compatibility.summary', counts);
        if (!(summary.includes(String(counts.exactCount)) || counts.exactCount === 0)) {
          expect.unreachable(
            'Expected summary.includes(String(counts.exactCount)) || counts.exactCount === 0',
          );
        }
        if (!(summary.includes(String(counts.normalizedCount)) || counts.normalizedCount === 0)) {
          expect.unreachable(
            'Expected summary.includes(String(counts.normalizedCount)) || counts.normalizedCount === 0',
          );
        }
        if (!(summary.includes(String(counts.attentionCount)) || counts.attentionCount === 0)) {
          expect.unreachable(
            'Expected summary.includes(String(counts.attentionCount)) || counts.attentionCount === 0',
          );
        }
      }
    }
    expect(createI18n('en-US', catalogForLocale('en-US')).t('items.results.total', { count: 2 }))
      .not.toStrictEqual(
        createI18n('es-ES', catalogForLocale('es-ES')).t('items.results.total', { count: 2 }),
      );
  },
);
