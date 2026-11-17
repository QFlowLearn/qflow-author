import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { SliderContent } from '../islands/drivers/slider.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
function renderSlider(
  locale: InterfaceLocale,
  mappings: { mapKey: number; mappedValue: number }[],
) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <SliderContent
        responseIdentifier='RESPONSE_Ω'
        lowerBound={0}
        upperBound={100}
        step={1}
        orientation='horizontal'
        correctValue={50}
        mappings={mappings}
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
        setResponseIdentifier={noop}
        setLowerBound={noop}
        setUpperBound={noop}
        setStep={noop}
        setOrientation={noop}
        setCorrectValue={noop}
        addMapping={noop}
        removeMapping={noop}
        updateMappingKey={noop}
        updateMappingValue={noop}
      />
    </I18nProvider>,
  );
}
for (const locale of locales) {
  testCase(`slider populated surface is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderSlider(locale, [
      { mapKey: 10, mappedValue: -2 },
      { mapKey: 20, mappedValue: 0 },
    ]);
    for (
      const key of [
        'sliderPrompt',
        'sliderLowerBound',
        'sliderUpperBound',
        'sliderStep',
        'sliderOrientation',
        'sliderHorizontal',
        'sliderVertical',
        'sliderCorrectValue',
        'sliderMappings',
        'sliderAddMapping',
        'sliderMapKey',
        'sliderMappedValue',
      ] as const
    ) {
      expect(html).toContain(i18n.t(`driver.${key}`, { number: 1 }));
    }
    expect(html).toContain(i18n.t('driver.remove'));
    expect(html).toContain(i18n.t('driver.sliderRemoveMapping', { number: 1 }));
    expect(html).toContain(i18n.t('driver.sliderRemoveMapping', { number: 2 }));
    expect(html).toContain(`placeholder="${i18n.t('driver.sliderMapKeyPlaceholder')}"`);
    expect(html).toContain(`placeholder="${i18n.t('driver.sliderMappedValuePlaceholder')}"`);
    for (
      const [value, label] of [
        ['horizontal', i18n.t('driver.sliderHorizontal')],
        ['vertical', i18n.t('driver.sliderVertical')],
      ]
    ) expect(html).toContain(`value="${value}">${label}</option>`);
    for (const value of ['0', '100', '1', '50', '10', '-2', '20']) {
      expect(html).toContain(`value="${value}"`);
    }
    for (const value of ['0', '100', '1', '50']) {
      expect(html).toContain(`placeholder="${value}"`);
    }
    if (!(!html.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(html))) {
      expect.unreachable(
        "Expected !html.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(html)",
      );
    }
    if (locale === 'es-ES' || locale === 'es-419') {
      for (
        const phrase of [
          'Lower bound',
          'Upper bound',
          'Correct value',
          'Drag the slider',
          'Step',
          'Orientation',
          'Mapping entries',
          'Add mapping',
          'Add map entries',
          'Map key',
          'Value',
          'Mapped value',
          'Score',
          'Remove mapping',
          '>Remove<',
        ]
      ) if (html.includes(phrase)) expect.unreachable(`${locale} leaked ${phrase}`);
    }
  });
  testCase(`slider empty mappings are localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderSlider(locale, []);
    expect(html).toContain(i18n.t('driver.sliderEmptyMappings'));
    if (!(!html.includes('driver.') && !html.includes('sliderRemoveMapping'))) {
      expect.unreachable(
        "Expected !html.includes('driver.') && !html.includes('sliderRemoveMapping')",
      );
    }
  });
}
