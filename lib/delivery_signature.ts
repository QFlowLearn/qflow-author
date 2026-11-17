export { decodeBase64Url, encodeBase64Url } from './base64.ts';

export async function signDeliveryValue(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((entry) => entry.toString(16).padStart(2, '0'))
    .join('');
}
