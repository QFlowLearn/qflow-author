import { expect, test as testCase } from 'vitest';

import {
  importListPageRoute as handlerEndpoint,
  parseImportFeedback,
} from '../lib/http/routes/import_pages/list.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';

const handler = handlerEndpoint.handle;

testCase('imports index rejects unsupported and incomplete retry forms safely', async () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (
      const body of [
        new URLSearchParams({ action: '<hostile>' }),
        new URLSearchParams({ action: 'retry' }),
      ]
    ) {
      const response = await invokeHttpMethod(
        handler,
        'POST',
        makeHttpRequest(
          new Request('http://local/imports', { ...{ duplex: 'half' }, method: 'POST', body }),
          {
            state: { interfaceLocale: locale, catalog: catalogForLocale(locale), i18n },
          },
        ),
      );
      expect(response.status).toStrictEqual(400);
      const text = await response.text();
      expect(text).toContain(i18n.t('imports.retryFailed'));
      expect(text.includes('<hostile>')).toStrictEqual(false);
    }
  }
  expect(parseImportFeedback('retry_failed')).toStrictEqual('retry_failed');
  expect(parseImportFeedback('retry_failed:bad')).toStrictEqual(null);
});
