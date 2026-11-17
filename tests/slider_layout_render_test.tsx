import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { SliderContent } from '../islands/drivers/slider.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const noop = () => {};
const noIssue = () => false;
const noIssueText = () => undefined;
const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);
const i18n = createI18n('en-US', payload.namespaces);

testCase('slider content keeps core numeric fields inline and omits rail-only toggles', () => {
  const html = renderToString(
    <I18nProvider payload={payload}>
      <SliderContent
        responseIdentifier='RESPONSE'
        lowerBound={0}
        upperBound={100}
        step={10}
        orientation='horizontal'
        correctValue={50}
        mappings={[]}
        renderPromptField={() => <div />}
        fieldHasIssue={noIssue}
        fieldIssueText={noIssueText}
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

  expect(html.includes(i18n.t('driver.sliderLowerBound'))).toStrictEqual(true);
  expect(html.includes(i18n.t('driver.sliderUpperBound'))).toStrictEqual(true);
  expect(html.includes(i18n.t('driver.sliderStep'))).toStrictEqual(true);
  expect(html.includes(i18n.t('driver.sliderCorrectValue'))).toStrictEqual(true);
  expect(html.includes('Step labels')).toStrictEqual(false);
  expect(html.includes('Reverse direction')).toStrictEqual(false);
});
