import { expect, test as testCase } from 'vitest';

import { requiresContentWriteRole } from '../lib/http/middleware/route_policy.ts';
import { requireContentWrite } from '../lib/services/roles.ts';
import { importReportRoute as migrationReportHandlerEndpoint } from '../lib/http/routes/import_pages/import_report.tsx';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';

const migrationReportHandler = migrationReportHandlerEndpoint.handle;

testCase('content-write policy covers API and authoring page mutations', () => {
  const guardedPaths = [
    '/api/assessments/example/questions',
    '/assessments/new',
    '/imports',
    '/imports/',
    '/imports/batches/example',
    '/items',
    '/items/',
    '/onboarding',
    '/onboarding/',
  ];
  for (const path of guardedPaths) expect(requiresContentWriteRole(path), path).toStrictEqual(true);

  const unguardedPaths = [
    '/api/auth/login',
    '/api/me',
    '/api/settings',
    '/imports/example',
    '/items/example',
    '/settings/editor',
    '/settings/password',
  ];
  for (const path of unguardedPaths) {
    expect(requiresContentWriteRole(path), path).toStrictEqual(false);
  }
});

testCase('content-write route guards are method-aware', () => {
  const url = 'https://example.test/assessments/new';
  expect(requireContentWrite('teaching_assistant', new Request(url, { method: 'GET' })))
    .toStrictEqual(null);
  expect(requireContentWrite('instructor', new Request(url, { method: 'POST' }))).toStrictEqual(
    null,
  );
  expect(requireContentWrite('teaching_assistant', new Request(url, { method: 'POST' }))?.status)
    .toStrictEqual(403);
});

testCase('mixed migration report route blocks content commands for read-only roles', async () => {
  const request = new Request('https://example.test/imports/example', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: new URLSearchParams({ action: 'retry' }),
  });
  const response = await invokeHttpMethod(
    migrationReportHandler,
    'POST',
    makeHttpRequest(request, {
      params: { id: 'example' },
      auth: {
        tenantId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        role: 'teaching_assistant',
      },
    }),
  );

  expect(response.status).toStrictEqual(403);
  expect(await response.text()).toStrictEqual('Forbidden');
});
