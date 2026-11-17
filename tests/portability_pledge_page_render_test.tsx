import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import ConversionGeneration from '../islands/ConversionGeneration.tsx';
import PortabilityPledge from '../lib/http/routes/public_pages/portability.tsx';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

const catalog = catalogForLocale('en-US');
const i18n = createI18n('en-US', catalog);
const payload = createI18nPayload('en-US', catalog, ['imports']);

testCase(
  'public portability pledge states every customer commitment and commercial boundary',
  () => {
    const html = renderToString(<PortabilityPledge i18n={i18n} />);

    expect(html).toContain('Your content remains yours');
    expect(html).toContain('Basic portability has no export fee');
    expect(html).toContain('AI processes content only when you request it');
    expect(html).toContain('Conversion loss stays visible');
    expect(html).toContain('QTI 3 remains available when hosted access ends');
    expect(html).toContain('does not include a free institutional production tier');
    expect(html).toContain('https://www.qflowlearn.com/terms/portability');
  },
);

testCase('AI generation discloses provider processing before the user starts generation', () => {
  const html = renderToString(
    <ConversionGeneration
      runId='run-1'
      initialBlueprint={UNSPECIFIED_ASSESSMENT_BLUEPRINT}
      payload={payload}
    />,
  );

  expect(html).toContain(
    "Generation sends this source and your settings to the workspace's configured AI provider.",
  );
  expect(html).toContain('Recovery and export do not send source content to an AI model.');
  expect(html).toContain('href="/help/portability"');
});
