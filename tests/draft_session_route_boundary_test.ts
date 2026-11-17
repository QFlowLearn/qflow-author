import { expect, test as testCase } from 'vitest';

import { draftBankRoute as draftByIdEndpoint } from '../lib/http/routes/bank_api/draft.ts';
import { publishRevisionBankRoute as publishDraftEndpoint } from '../lib/http/routes/bank_api/publish_revision.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const draftById = draftByIdEndpoint.handle;
const publishDraft = publishDraftEndpoint.handle;

testCase('working-draft routes reject malformed identifiers before persistence', async () => {
  const read = await invokeHttpRoute(
    draftById,
    makeHttpRequest(
      new Request('http://local/api/drafts/not-a-uuid'),
      { params: { id: 'not-a-uuid' } },
    ),
  );
  expect(read.status).toStrictEqual(404);

  const publish = await invokeHttpRoute(
    publishDraft,
    makeHttpRequest(
      new Request('http://local/api/drafts/not-a-uuid/publish', { method: 'POST' }),
      { params: { id: 'not-a-uuid' } },
    ),
  );
  expect(publish.status).toStrictEqual(400);
  expect((await publish.json()).error).toStrictEqual('invalid_session');
});

testCase('working-draft mutation routes reject read-only actors before persistence', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const auth = {
    tenantId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    role: 'teaching_assistant' as const,
  };
  for (const method of ['PUT', 'DELETE'] as const) {
    const request = new Request(`http://local/api/drafts/${id}`, {
      ...{ duplex: 'half' },
      method,
      body: method === 'PUT' ? '{}' : undefined,
      headers: method === 'PUT' ? { 'content-type': 'application/json' } : undefined,
    });
    const response = await invokeHttpRoute(
      draftById,
      makeHttpRequest(request, { params: { id }, auth }),
    );
    expect(response.status).toStrictEqual(403);
    expect(await response.text()).toStrictEqual('Forbidden');
  }
});
