import { expect, test as testCase } from 'vitest';

import { validatePlayerMessageCatalog } from '@longsightgroup/qti3-player';
import {
  PLAYER_MESSAGE_CATALOGS,
  playerMessageCatalogForLocale,
} from '../lib/i18n/player_messages/catalogs.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const LOCALES = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const satisfies ReadonlyArray<
  InterfaceLocale
>;
const SECTIONS = ['strings', 'directions', 'interactionTypes'] as const;

function keys(value: object): string[] {
  return Object.keys(value).sort();
}

function placeholderSignature(value: string): string[] {
  return [...value.matchAll(/\{[^}]+\}/g)].map((match) => match[0]).sort();
}

function sectionEntries(
  catalog: (typeof PLAYER_MESSAGE_CATALOGS)[InterfaceLocale],
  section: (typeof SECTIONS)[number],
): Readonly<Record<string, string>> {
  const value = catalog[section];
  return value ? Object.fromEntries(Object.entries(value)) : {};
}

testCase('all host-owned player catalogs satisfy the public complete-catalog contract', () => {
  for (const locale of LOCALES) {
    const catalog = playerMessageCatalogForLocale(locale);
    if (!(validatePlayerMessageCatalog(catalog, { requireAllKeys: true }).valid)) {
      expect.unreachable(
        'Expected validatePlayerMessageCatalog(catalog, { requireAllKeys: true }).valid',
      );
    }
    expect(catalog.locale).toStrictEqual(locale);
  }
});

testCase('all locales have exact player section keys and placeholder signatures', () => {
  const english = PLAYER_MESSAGE_CATALOGS['en-US'];
  for (const locale of LOCALES) {
    const catalog = PLAYER_MESSAGE_CATALOGS[locale];
    for (const section of SECTIONS) {
      expect(keys(sectionEntries(catalog, section)), `${locale}.${section}`).toStrictEqual(
        keys(sectionEntries(english, section)),
      );
    }
    for (const key of keys(english.strings)) {
      expect(placeholderSignature(catalog.strings[key]), `${locale}.strings.${key}`).toStrictEqual(
        placeholderSignature(english.strings[key]),
      );
    }
  }
});

testCase('each locale owns independent catalog and section objects', () => {
  for (let first = 0; first < LOCALES.length; first += 1) {
    for (let second = first + 1; second < LOCALES.length; second += 1) {
      const left = PLAYER_MESSAGE_CATALOGS[LOCALES[first]];
      const right = PLAYER_MESSAGE_CATALOGS[LOCALES[second]];
      expect(left).not.toStrictEqual(right);
      if (!(left.strings !== right.strings)) {
        expect.unreachable('Expected left.strings !== right.strings');
      }
      if (!(left.directions !== right.directions)) {
        expect.unreachable('Expected left.directions !== right.directions');
      }
      if (!(left.interactionTypes !== right.interactionTypes)) {
        expect.unreachable('Expected left.interactionTypes !== right.interactionTypes');
      }
    }
  }
});

testCase('English and Spanish catalogs are translated peers, not English clones', () => {
  const english = PLAYER_MESSAGE_CATALOGS['en-US'];
  for (const locale of ['es-ES', 'es-419'] as const) {
    const spanish = PLAYER_MESSAGE_CATALOGS[locale];
    for (const section of SECTIONS) {
      const englishSection = sectionEntries(english, section);
      const spanishSection = sectionEntries(spanish, section);
      for (const key of keys(englishSection)) {
        expect(spanishSection[key], `${locale}.${section}.${key}`).not.toStrictEqual(
          englishSection[key],
        );
      }
    }
  }
});

testCase('locale-specific player wording is explicit', () => {
  const enGB = PLAYER_MESSAGE_CATALOGS['en-GB'];
  expect(enGB.strings.drawingPenColor).toStrictEqual('Pen colour');
  expect(enGB.strings.drawingPenColorSelected).toStrictEqual('Pen colour {color}');

  const esES = PLAYER_MESSAGE_CATALOGS['es-ES'];
  const es419 = PLAYER_MESSAGE_CATALOGS['es-419'];
  if (!(esES.strings.inlineChoicePrompt.includes('Elige'))) {
    expect.unreachable("Expected esES.strings.inlineChoicePrompt.includes('Elige')");
  }
  if (!(es419.strings.inlineChoicePrompt.includes('Seleccionar'))) {
    expect.unreachable("Expected es419.strings.inlineChoicePrompt.includes('Seleccionar')");
  }
  if (!(esES.strings.hotspotSelectedChooseAnother.includes('Se ha seleccionado'))) {
    expect.unreachable(
      "Expected esES.strings.hotspotSelectedChooseAnother.includes('Se ha seleccionado')",
    );
  }
  if (!(es419.strings.hotspotSelectedChooseAnother.includes('Se seleccionó'))) {
    expect.unreachable(
      "Expected es419.strings.hotspotSelectedChooseAnother.includes('Se seleccionó')",
    );
  }
  if (!(esES.strings.orderedItemAddedToPosition.includes('añadido'))) {
    expect.unreachable("Expected esES.strings.orderedItemAddedToPosition.includes('añadido')");
  }
  if (!(es419.strings.orderedItemAddedToPosition.includes('agregado'))) {
    expect.unreachable("Expected es419.strings.orderedItemAddedToPosition.includes('agregado')");
  }
});
