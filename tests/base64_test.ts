import { expect, test as testCase } from 'vitest';

import { decodeBase64Url, encodeBase64Url } from '../lib/base64.ts';

testCase('Base64URL encoding is canonical and round trips arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 251, 255]);
  const encoded = encodeBase64Url(bytes);

  expect(encoded).toStrictEqual('AAEC-_8');
  expect(decodeBase64Url(encoded)).toStrictEqual(bytes);
});

testCase('Base64URL decoding rejects padded, malformed, and non-canonical values', () => {
  expect(() => decodeBase64Url('AA==')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('invalid')
    ),
  );
  expect(() => decodeBase64Url('A')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('invalid')
    ),
  );
  expect(() => decodeBase64Url('AB')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('not canonical')
    ),
  );
});
