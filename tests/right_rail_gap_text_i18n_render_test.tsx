import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import {
  GapMatchSection,
  GraphicGapMatchSection,
  TextEntrySection,
} from '../islands/drivers/right_rail/sections.tsx';
import type { RightRailControls } from '../islands/drivers/right_rail/types.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;

function controls(): RightRailControls {
  return {
    sections: [],
    gapMinAssociations: { value: 2, onChange: () => {} },
    gapMaxAssociations: { value: 4, onChange: () => {} },
    gapMinMessage: { value: 'AUTHORED TOO FEW', onChange: () => {} },
    gapMaxMessage: { value: 'AUTHORED TOO MANY', onChange: () => {} },
    textEntryShowIdentifiers: { value: true, onChange: () => {} },
    textEntryRequirePattern: { value: true, onChange: () => {} },
  };
}

for (const locale of locales) {
  testCase('gap-match and text-entry right rails render localized UI in ' + locale, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = render(
      <I18nProvider payload={payload}>
        <GapMatchSection controls={controls()} />
        <GraphicGapMatchSection controls={controls()} />
        <TextEntrySection controls={controls()} />
      </I18nProvider>,
    );

    for (
      const id of [
        'driver.rightRail.gapMatchHelp',
        'driver.rightRail.gapMinimumAssociations',
        'driver.rightRail.gapMaximumAssociations',
        'driver.rightRail.gapMinimumSelectionsError',
        'driver.rightRail.gapMinimumSelectionsShown',
        'driver.rightRail.gapMaximumSelectionsError',
        'driver.rightRail.gapMaximumSelectionsShown',
        'driver.rightRail.textEntryShowIdentifiers',
        'driver.rightRail.textEntryRequirePattern',
        'driver.rightRail.textEntryRequirePatternHelp',
      ]
    ) {
      expect(html).toContain(i18n.t(id));
    }
    expect(html).toContain('AUTHORED TOO FEW');
    expect(html).toContain('AUTHORED TOO MANY');
    expect(html).not.toMatch(/driver\.rightRail\./);

    if (locale.startsWith('es')) {
      for (
        const english of [
          'Maps to min-associations/max-associations and data-min/max-selections-message.',
          'Min associations (0 = none)',
          'Max associations (0 = unlimited)',
          'Min selections error message',
          'Shown when too few pairs are made',
          'Max selections error message',
          'Shown when too many pairs are made',
          'Show identifiers',
          'Require pattern masks',
          'Learners must match the regex mask on each blank.',
        ]
      ) {
        if (html.includes(english)) {
          expect.unreachable(`${locale} leaked English phrase: ${english}`);
        }
      }
    }
  });

  testCase('gap-match and text-entry null branches render safely in ' + locale, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const html = render(
      <I18nProvider payload={payload}>
        <GapMatchSection controls={{ sections: [] }} />
        <GraphicGapMatchSection controls={{ sections: [] }} />
        <TextEntrySection controls={{ sections: [] }} />
      </I18nProvider>,
    );
    expect(html).toStrictEqual('');
  });
}
