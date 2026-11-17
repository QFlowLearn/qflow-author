import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { MediaSection, SharedVocabularySection } from '../islands/drivers/right_rail/sections.tsx';
import type { RightRailControls } from '../islands/drivers/right_rail/types.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const text = (value: string) => ({ value, onChange: noop });
const toggle = (value: boolean) => ({ value, onChange: noop });
const number = (value: number) => ({ value, onChange: noop });
const select = (value: string) => ({
  value,
  options: [{ value, label: value }],
  onChange: noop,
});

function controls(): RightRailControls {
  return {
    sections: [],
    mediaInteractionLabel: text('AUTHORED-MEDIA-LABEL'),
    mediaAutostart: toggle(true),
    mediaLoop: toggle(false),
    mediaMinPlays: number(1),
    mediaMaxPlays: number(3),
    mediaCoords: text('x,y,width,height'),
    mediaWidth: number(640),
    mediaHeight: number(480),
    mediaPlayerControls: {
      value: ['play'],
      options: [{ value: 'play', label: 'Play' }],
      onChange: noop,
    },
    mediaPauseDelay: number(2),
    mediaPauseDuration: number(4),
    sharedLabelStyle: select('decimal'),
    sharedLabelSuffix: select('period'),
    sharedOrientation: select('horizontal'),
    sharedChoicesStacking: select('2'),
    sharedChoicesPosition: select('left'),
    sharedChoicesContainerWidth: number(320),
    sharedSelectionTone: select('light'),
    sharedInputControlHidden: toggle(true),
    sharedUnselectedHidden: toggle(false),
    sharedWritingOrientation: select('vertical-lr'),
    sharedMatchTabular: toggle(true),
    sharedMatchHeaderHidden: toggle(false),
    sharedMatchFirstColumnHeader: text('AUTHORED-COLUMN-HEADER'),
    sharedGapPlacement: toggle(true),
  };
}

function render(locale: InterfaceLocale, component: 'media' | 'shared', populated = true) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      {component === 'media'
        ? <MediaSection controls={populated ? controls() : { sections: [] }} />
        : <SharedVocabularySection controls={populated ? controls() : { sections: [] }} />}
    </I18nProvider>,
  );
}

for (const locale of locales) {
  testCase(`media right rail is localized (${locale})`, () => {
    const i18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    const html = render(locale, 'media');
    for (
      const key of [
        'mediaHelp',
        'mediaInteractionLabel',
        'mediaAutostart',
        'mediaLoop',
        'mediaMinPlays',
        'mediaMaxPlays',
        'mediaCoords',
        'mediaWidth',
        'mediaHeight',
        'mediaPlayerControls',
        'mediaPauseDelay',
        'mediaPauseDuration',
        'mediaSeconds',
      ] as const
    ) expect(html).toContain(i18n.t(`driver.rightRail.${key}`));
    for (const value of ['AUTHORED-MEDIA-LABEL', 'x,y,width,height', '640', '480', '2', '4']) {
      expect(html).toContain(value);
    }
    if (html.includes('driver.rightRail.')) {
      expect.unreachable("Expected !html.includes('driver.rightRail.')");
    }
    if (locale === 'es-ES' || locale === 'es-419') {
      for (const phrase of ['Interaction label', 'Autostart', 'Player controls', 'Pause delay']) {
        if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
      }
    }
  });

  testCase(`shared vocabulary right rail is localized (${locale})`, () => {
    const i18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    const html = render(locale, 'shared');
    for (
      const key of [
        'sharedVocabulary',
        'sharedLabels',
        'sharedLabelSuffix',
        'sharedOrientation',
        'sharedChoiceStacking',
        'sharedChoicesPlacement',
        'sharedChoicesContainerWidth',
        'sharedOptionalPx',
        'sharedSelectionTone',
        'sharedHideInputControl',
        'sharedHideUnselectedChoices',
        'sharedWritingOrientation',
        'sharedTabularMatch',
        'sharedHideMatchHeader',
        'sharedFirstColumnHeader',
        'sharedOptionalHeader',
        'sharedGapPlacement',
      ] as const
    ) expect(html).toContain(i18n.t(`driver.rightRail.${key}`));
    for (const value of ['AUTHORED-COLUMN-HEADER', 'decimal', 'period', 'horizontal', '2', '320']) {
      expect(html).toContain(value);
    }
    if (html.includes('driver.rightRail.')) {
      expect.unreachable("Expected !html.includes('driver.rightRail.')");
    }
    if (locale === 'es-ES' || locale === 'es-419') {
      for (
        const phrase of ['Shared Vocabulary', 'Labels', 'Choice stacking', 'Hide input control']
      ) {
        if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
      }
    }
  });

  testCase(`empty right rail branches render no unresolved copy (${locale})`, () => {
    if (!(render(locale, 'media', false) === '')) {
      expect.unreachable("Expected render(locale, 'media', false) === ''");
    }
    if (!(render(locale, 'shared', false) === '')) {
      expect.unreachable("Expected render(locale, 'shared', false) === ''");
    }
  });
}
