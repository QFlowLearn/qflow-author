import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { DrawingContent } from '../islands/drivers/drawing.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);
const i18n = createI18n('en-US', payload.namespaces);

testCase('DrawingContent groups image accessibility fields beside the upload workflow', () => {
  const noop = () => {};
  const html = renderToString(
    <I18nProvider payload={payload}>
      <DrawingContent
        renderPromptField={() => <div />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
        responseIdentifier='RESPONSE'
        image={{ source: '', alt: '', longDescription: '', mimeType: '' }}
        setResponseIdentifier={noop}
        setImage={noop}
      />
    </I18nProvider>,
  );

  expect(html).toContain('lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]');
  expect(html).toContain(i18n.t('driver.drawingImageAlt'));
  expect(html).toContain(i18n.t('driver.drawingImageLongDescription'));
  expect(html).toContain('rows="4"');
});
