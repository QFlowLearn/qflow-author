import { expect, test as testCase } from 'vitest';

import { parseBankCollectionForm } from '../lib/services/bank_collection_forms.ts';
import {
  parseQuestionBankBulkForm,
  QuestionBankBulkFormError,
} from '../lib/services/question_bank_actions.ts';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const collectionId = '10000000-0000-4000-8000-000000000001';
const operationId = '10000000-0000-4000-8000-000000000002';

testCase(
  'collection forms parse one-based positions and reject malformed management requests',
  () => {
    const values = {
      collectionAction: 'Create',
      collectionId,
      operationId,
      name: ' Genetics ',
      description: '',
      position: '1',
    };
    expect(parseBankCollectionForm(form(values))).toStrictEqual({
      operationId,
      command: { _tag: 'Create', collectionId, name: 'Genetics', description: '', position: 0 },
    });
    for (const position of ['', '0', '-1', '1.5', '1e2', '2147483649']) {
      expect(parseBankCollectionForm(form({ ...values, position }))).toStrictEqual(null);
    }
    expect(parseBankCollectionForm(form({ ...values, tenantId: collectionId }))).toStrictEqual(
      null,
    );
    const repeated = form(values);
    repeated.append('operationId', operationId);
    expect(parseBankCollectionForm(repeated)).toStrictEqual(null);
    const file = form(values);
    file.set('name', new Blob(['name']));
    expect(parseBankCollectionForm(file)).toStrictEqual(null);
    expect(
      parseBankCollectionForm(form({ collectionAction: 'Archive', collectionId, operationId })),
    ).toStrictEqual({ operationId, command: { _tag: 'Archive', collectionId } });
  },
);

testCase(
  'bulk filing requires a collection and an operation ID and rejects unrelated fields',
  () => {
    const values = {
      bulkAction: 'add_to_collection',
      questionId: collectionId,
      collectionId,
      operationId,
    };
    const parsed = parseQuestionBankBulkForm(form(values));
    if (!(parsed._tag === 'AddToCollection')) {
      expect.unreachable("Expected parsed._tag === 'AddToCollection'");
    }
    expect(parsed.collectionId).toStrictEqual(collectionId);
    for (
      const invalid of [
        { ...values, collectionId: '' },
        { ...values, operationId: '' },
        { ...values, bulkTags: 'biology' },
        { ...values, ownerUserId: collectionId },
        { ...values, bulkAction: 'archive' },
      ]
    ) {
      expect(() => parseQuestionBankBulkForm(form(invalid))).toThrowError(
        QuestionBankBulkFormError,
      );
    }
  },
);

testCase('invalid collection POST redirects remain writable by security middleware', async () => {
  const { itemsRoute } = await import('../lib/http/routes/bank_pages/items.tsx');
  const handler = itemsRoute.handle;
  const { invokeHttpMethod, makeHttpRequest } = await import(
    './helpers/http_route.ts'
  );
  const { applySecurityHeaders } = await import('../lib/http/middleware/response_security.ts');
  const request = new Request(`http://localhost/items?collection=${collectionId}`, {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form({ collectionAction: 'Create', collectionId, operationId: 'invalid' }),
  });
  if (!(typeof handler === 'function')) {
    expect.unreachable("Expected typeof handler === 'function'");
  }
  const response = await invokeHttpMethod(handler, 'POST', makeHttpRequest(request));
  expect(response.status).toStrictEqual(303);
  expect(new URL(response.headers.get('location') ?? '').searchParams.get('collection'))
    .toStrictEqual(collectionId);
  expect(applySecurityHeaders(new URL(request.url), response).headers.get('x-content-type-options'))
    .toStrictEqual('nosniff');
});

testCase(
  'arrangement forms preserve order and reject repeated identity or duplicate questions',
  () => {
    const input = form({ collectionAction: 'ReorderItems', collectionId, operationId });
    input.append('questionId', operationId);
    input.append('questionId', collectionId);
    expect(parseBankCollectionForm(input)).toStrictEqual({
      operationId,
      command: { _tag: 'ReorderItems', collectionId, questionIds: [operationId, collectionId] },
    });
    input.append('questionId', collectionId);
    expect(parseBankCollectionForm(input)).toStrictEqual(null);
    input.delete('questionId');
    expect(parseBankCollectionForm(input)).toStrictEqual(null);
  },
);
