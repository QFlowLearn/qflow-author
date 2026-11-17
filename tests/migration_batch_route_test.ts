import { expect, test as testCase } from 'vitest';

import { importBatchPageRoute as handlerEndpoint } from '../lib/http/routes/import_pages/batch.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';

const handler = handlerEndpoint.handle;

testCase('migration batch route rejects reviewer assignment by a teaching assistant', async () => {
  const request = new Request('http://local/imports/batches/batch-id', {
    method: 'POST',
  });
  const response = await invokeHttpMethod(
    handler,
    'POST',
    makeHttpRequest(request, {
      auth: {
        tenantId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        role: 'teaching_assistant',
      },
      params: { id: 'batch-id' },
    }),
  );

  expect(response.status).toStrictEqual(403);
});

testCase('migration batch owner POST validation is localized and closed', async () => {
  const cases = [
    {
      action: '<script>hostile-action</script>',
      reviewerId: null,
      expectedId: 'imports.batch.invalidAction',
    },
    { action: 'assign-reviewer', reviewerId: '', expectedId: 'imports.batch.reviewerRequired' },
    { action: 'assign-reviewer', reviewerId: '   ', expectedId: 'imports.batch.reviewerRequired' },
  ] as const;
  const locales: readonly InterfaceLocale[] = ['en-US', 'es-ES'];
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const testCase of cases) {
      const body = new URLSearchParams({ action: testCase.action });
      if (testCase.reviewerId !== null) body.set('reviewerId', testCase.reviewerId);
      const request = new Request('http://local/imports/batches/batch-id', {
        ...{ duplex: 'half' },
        method: 'POST',
        body,
      });
      const response = await invokeHttpMethod(
        handler,
        'POST',
        makeHttpRequest(request, {
          auth: {
            tenantId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
            role: 'owner',
          },
          params: { id: 'batch-id' },
          state: { i18n },
        }),
      );
      const text = await response.text();
      expect(response.status).toStrictEqual(400);
      expect(text).toStrictEqual(i18n.t(testCase.expectedId));
      if (text.includes('hostile-action')) {
        expect.unreachable("Expected !text.includes('hostile-action')");
      }
      if (text.includes('reviewer_assignment_failed')) {
        expect.unreachable("Expected !text.includes('reviewer_assignment_failed')");
      }
      if (locale === 'es-ES') {
        if (text.includes('Choose a reviewer')) {
          expect.unreachable("Expected !text.includes('Choose a reviewer')");
        }
      }
      if (locale === 'en-US') {
        if (text.includes('Selecciona un revisor')) {
          expect.unreachable("Expected !text.includes('Selecciona un revisor')");
        }
      }
    }
  }
});
