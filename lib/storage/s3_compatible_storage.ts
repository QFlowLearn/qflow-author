import { assertObjectByteRange, readExactObjectRange } from './object_range.ts';
import { sha256Hex } from '../sha256.ts';
import {
  immutableContentSha256,
  type ObjectStorage,
  parseStorageObjectStream,
  type PutStorageObjectInput,
  StorageObjectIdentityConflictError,
  storageObjectMetadataMatches,
  StorageObjectNotFoundError,
} from '../storage_contract.ts';

type UrlStyle = 'path' | 'vhost';

/** Configuration for an AWS SigV4-compatible object-storage endpoint. */
export type S3CompatibleStorageConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
};

type S3State = {
  bucket: string;
  endpoint: string;
  urlStyle: UrlStyle;
  accessKeyId: string;
  secretAccessKey: string;
};

const AWS_ALGORITHM = 'AWS4-HMAC-SHA256';
const AWS_REGION = 'auto';
const AWS_SERVICE = 's3';
const EMPTY_SHA256_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const CONTENT_SHA256_HEADER = 'x-amz-meta-qflow-sha256';
const encoder = new TextEncoder();

/** Creates object storage backed by an AWS SigV4-compatible HTTP endpoint. */
export function createS3CompatibleStorage(config: S3CompatibleStorageConfig): ObjectStorage {
  const state: S3State = {
    bucket: config.bucket,
    endpoint: config.endpoint,
    urlStyle: (config.forcePathStyle ?? true) ? 'path' : 'vhost',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  return {
    async putObject(input) {
      const url = buildObjectUrl(state, input.key);
      const headers = new Headers();
      if (input.contentType) headers.set('content-type', input.contentType);
      const sha256 = immutableContentSha256(input);
      if (sha256) {
        headers.set('if-none-match', '*');
        headers.set(CONTENT_SHA256_HEADER, sha256);
      }
      const response = await signedFetch({
        state,
        method: 'PUT',
        url,
        body: input.data,
        headers,
        expectedPayloadSha256: sha256,
      });
      if (response.status === 412 && sha256) {
        if (await existingS3ObjectMatches(state, input)) return;
        throw new StorageObjectIdentityConflictError(input.key);
      }
      if (!response.ok) {
        throw await buildStorageError(response, `write ${input.key}`);
      }
    },
    async readObject(key) {
      const response = await signedFetch({
        state,
        method: 'GET',
        url: buildObjectUrl(state, key),
      });
      if (response.status === 404) {
        throw new StorageObjectNotFoundError(key);
      }
      if (!response.ok) {
        throw await buildStorageError(response, `read ${key}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async readObjectRange(key, offset, length) {
      assertObjectByteRange({ offset, length });
      const response = await signedFetch({
        state,
        method: 'GET',
        url: buildObjectUrl(state, key),
        headers: new Headers({ Range: `bytes=${offset}-${offset + length - 1}` }),
      });
      if (response.status === 404) {
        await response.body?.cancel().catch(() => {});
        throw new StorageObjectNotFoundError(key);
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      if (
        response.status !== 206 || !response.body || !range ||
        Number(range[1]) !== offset || Number(range[2]) !== offset + length - 1 ||
        !Number.isSafeInteger(Number(range[3])) || Number(range[3]) < offset + length
      ) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Object storage returned an incorrect byte range.');
      }
      return await readExactObjectRange(response.body, length);
    },
    async readObjectStream(key) {
      const response = await signedFetch({
        state,
        method: 'GET',
        url: buildObjectUrl(state, key),
      });
      if (response.status === 404) throw new StorageObjectNotFoundError(key);
      if (!response.ok) throw await buildStorageError(response, `stream ${key}`);
      return await parseStorageObjectStream({
        body: response.body,
        contentLength: response.headers.get('content-length'),
        contentType: response.headers.get('content-type'),
        contentSha256: response.headers.get(CONTENT_SHA256_HEADER),
      });
    },
    async deleteObject(key) {
      const response = await signedFetch({
        state,
        method: 'DELETE',
        url: buildObjectUrl(state, key),
      });
      if (!response.ok && response.status !== 404) {
        throw await buildStorageError(response, `delete ${key}`);
      }
    },
  };
}

async function existingS3ObjectMatches(
  state: S3State,
  input: PutStorageObjectInput,
): Promise<boolean> {
  const response = await signedFetch({
    state,
    method: 'HEAD',
    url: buildObjectUrl(state, input.key),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw await buildStorageError(response, `inspect ${input.key}`);
  return storageObjectMetadataMatches(
    {
      contentLength: response.headers.get('content-length'),
      contentType: response.headers.get('content-type'),
      contentSha256: response.headers.get(CONTENT_SHA256_HEADER),
    },
    input,
  );
}

async function signedFetch(input: {
  state: S3State;
  method: 'DELETE' | 'GET' | 'HEAD' | 'PUT';
  url: URL;
  headers?: Headers;
  body?: Uint8Array;
  expectedPayloadSha256?: string;
}): Promise<Response> {
  const { state, method, url, body } = input;
  const headers = new Headers(input.headers);
  const payloadHash = body ? await sha256Hex(body) : EMPTY_SHA256_HEX;
  if (input.expectedPayloadSha256 && payloadHash !== input.expectedPayloadSha256) {
    throw new Error('Immutable storage object bytes do not match their SHA-256 identity.');
  }
  const amzDate = toAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = canonicalizeHeaders(headers, url.host, amzDate, payloadHash);
  const scope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`;
  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQuery(url),
    canonicalHeadersText(signedHeaders),
    signedHeaders.map(([name]) => name).join(';'),
    payloadHash,
  ].join('\n');
  const stringToSign = [
    AWS_ALGORITHM,
    amzDate,
    scope,
    await sha256Hex(encoder.encode(canonicalRequest)),
  ].join('\n');
  const signingKey = await deriveSigningKey(state.secretAccessKey, dateStamp);
  const signature = await hmacHex(signingKey, stringToSign);

  headers.set('x-amz-content-sha256', payloadHash);
  headers.set('x-amz-date', amzDate);
  headers.set(
    'authorization',
    `${AWS_ALGORITHM} Credential=${state.accessKeyId}/${scope}, SignedHeaders=${
      signedHeaders.map(([name]) => name).join(';')
    }, Signature=${signature}`,
  );

  return await fetch(url, {
    method,
    headers,
    body: body ? bufferFromBytes(body) : undefined,
  });
}

function canonicalizeHeaders(
  headers: Headers,
  host: string,
  amzDate: string,
  payloadHash: string,
): Array<[string, string]> {
  const entries = new Map<string, string>();
  entries.set('host', normalizeHeaderValue(host));
  entries.set('x-amz-content-sha256', payloadHash);
  entries.set('x-amz-date', amzDate);
  for (const [name, value] of headers) {
    if (name.toLowerCase() === 'authorization') continue;
    entries.set(name.toLowerCase(), normalizeHeaderValue(value));
  }
  return [...entries.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function canonicalHeadersText(headers: Array<[string, string]>): string {
  return headers.map(([name, value]) => `${name}:${value}\n`).join('');
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function buildObjectUrl(state: S3State, key: string): URL {
  const url = new URL(state.endpoint);
  const encodedKey = encodeKeyPath(key);
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  if (state.urlStyle === 'path') {
    url.pathname = `${basePath}/${encodeRfc3986(state.bucket)}/${encodedKey}`;
  } else {
    url.hostname = `${state.bucket}.${url.hostname}`;
    url.pathname = `${basePath}/${encodedKey}`;
  }
  return url;
}

function canonicalUri(pathname: string): string {
  return pathname || '/';
}

function canonicalQuery(url: URL): string {
  const params = [...url.searchParams.entries()].map(([name, value]) =>
    [
      encodeRfc3986(name),
      encodeRfc3986(value),
    ] as const
  );
  params.sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName === rightName ? leftValue.localeCompare(rightValue) : leftName.localeCompare(rightName)
  );
  return params.map(([name, value]) => `${name}=${value}`).join('&');
}

function encodeKeyPath(key: string): string {
  return key.split('/').map((part) => encodeRfc3986(part)).join('/');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toAmzDate(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${
    iso.slice(14, 16)
  }${iso.slice(17, 19)}Z`;
}

async function deriveSigningKey(secretAccessKey: string, dateStamp: string): Promise<Uint8Array> {
  const dateKey = await hmacRaw(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const regionKey = await hmacRaw(dateKey, AWS_REGION);
  const serviceKey = await hmacRaw(regionKey, AWS_SERVICE);
  return await hmacRaw(serviceKey, 'aws4_request');
}

async function hmacHex(key: Uint8Array, data: string): Promise<string> {
  return toHex(await hmacRaw(key, data));
}

async function hmacRaw(key: Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bufferFromBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, bufferFromBytes(payload)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function buildStorageError(response: Response, action: string): Promise<Error> {
  const detail = await readErrorDetail(response);
  return new Error(
    `S3-compatible storage ${action} failed with ${response.status}${detail ? `: ${detail}` : ''}`,
  );
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, 300);
  } catch {
    return '';
  }
}
