import { expect, test as testCase } from 'vitest';

import { parseSourceIntakeRequest, SourceIntakeRequestError } from '../lib/source_intake/http.ts';

function request(
  destination: string | null,
  collectionIds: string[] = [],
  repeated = false,
): Request {
  const form = new FormData();
  form.set('purpose', 'recover_existing');
  form.set(
    'files',
    new File(['1. Which letter?\na. A\n*b. B'], 'owned.txt', { type: 'text/plain' }),
  );
  if (destination !== null) form.set('destination', destination);
  for (const id of collectionIds) form.append('collectionId', id);
  if (repeated) form.append('destination', 'Assessment');
  return new Request('http://local/api/source-intake/execute', {
    ...{ duplex: 'half' },
    method: 'POST',
    body: form,
  });
}

testCase('source intake transports one explicit bank or assessment destination', async () => {
  const collectionId = crypto.randomUUID();
  expect((await parseSourceIntakeRequest(request('WorkspaceBank', [collectionId]))).destination)
    .toStrictEqual({ _tag: 'WorkspaceBank', collectionId });
  expect((await parseSourceIntakeRequest(request('WorkspaceBank'))).destination).toStrictEqual({
    _tag: 'WorkspaceBank',
    collectionId: null,
  });
  expect((await parseSourceIntakeRequest(request('Assessment'))).destination).toStrictEqual({
    _tag: 'Assessment',
  });
  for (
    const input of [
      request(null),
      request('other'),
      request('WorkspaceBank', ['forged']),
      request('Assessment', [collectionId]),
      request('WorkspaceBank', [collectionId, collectionId]),
      request('WorkspaceBank', [], true),
    ]
  ) {
    await expect(Promise.resolve().then(() => parseSourceIntakeRequest(input))).rejects
      .toBeInstanceOf(SourceIntakeRequestError);
  }
});
