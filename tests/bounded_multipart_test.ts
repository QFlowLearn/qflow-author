import { expect, test as testCase } from 'vitest';

import {
  BoundedMultipartError,
  parseBoundedMultipartFormData,
} from '../lib/http/bounded_multipart.ts';

testCase('bounded multipart rejects a declared oversized body before reading it', async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('unread'));
      controller.close();
    },
  });
  const request = multipartRequest(body, {
    'content-length': '101',
  });

  const error = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      parseBoundedMultipartFormData(request, { maxBytes: 100 })
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof BoundedMultipartError)) {
      expect.unreachable('Expected BoundedMultipartError');
    }
    expect(caught.message).toContain('configured byte limit');
    return caught;
  })();
  expect(error.code).toStrictEqual('payload_too_large');
});

testCase('bounded multipart stops a chunked body at the streaming byte cap', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(60));
      controller.enqueue(new Uint8Array(60));
      controller.close();
    },
  });

  await expect(
    Promise.resolve().then(() =>
      parseBoundedMultipartFormData(multipartRequest(body), { maxBytes: 100 })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof BoundedMultipartError && caught.message.includes('configured byte limit')
  );
});

function multipartRequest(
  body: ReadableStream<Uint8Array>,
  extraHeaders: Readonly<Record<string, string>> = {},
): Request {
  return new Request('http://local/source-intake', {
    ...{ duplex: 'half' },
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=qflow-test',
      ...extraHeaders,
    },
    body,
  });
}
