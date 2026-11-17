/** Encode arbitrary bytes as canonical base64 without exceeding argument limits. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/** Decode canonical base64 into its byte representation. */
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Encode arbitrary bytes using canonical unpadded Base64URL. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/** Decode canonical unpadded Base64URL, rejecting malformed or non-canonical input. */
export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new Error('Base64URL value is invalid.');
  }
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') +
    '='.repeat((4 - value.length % 4) % 4);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(padded);
  } catch (_cause: unknown) {
    throw new Error('Base64URL value is invalid.');
  }
  if (encodeBase64Url(bytes) !== value) throw new Error('Base64URL value is not canonical.');
  return bytes;
}
