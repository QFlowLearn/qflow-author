import { decodeBase64Url, encodeBase64Url } from './base64.ts';
import { getEnv } from './config.ts';
import { redact, type Redacted, reveal } from './redacted.ts';
import type { RuntimeSource } from './runtime.ts';

const CIPHER_VERSION = 'v1';
const CIPHER_KEY_ENV = 'QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1';
const AES_GCM_NONCE_BYTES = 12;

/** Classified credential-cipher failure safe to inspect without exposing secret material. */
export class CredentialCipherError extends Error {
  constructor(
    readonly _tag:
      | 'CredentialCipherConfigurationInvalid'
      | 'CredentialCipherEnvelopeInvalid'
      | 'CredentialCipherOperationFailed',
    message: string,
  ) {
    super(message);
    this.name = 'CredentialCipherError';
  }
}

/** Authenticated context that prevents one encrypted credential from being moved to another owner. */
export type CredentialContext =
  | {
    readonly purpose: 'canvas-client-secret' | 'canvas-refresh-token';
    readonly tenantId: string;
    readonly connectionId: string;
    readonly userId?: string;
  }
  | {
    readonly purpose: 'oidc-client-secret';
    readonly tenantId: string;
    readonly provider: 'google' | 'microsoft';
  }
  | {
    readonly purpose: 'password-reset-token';
    readonly resetTokenId: string;
    readonly userId: string;
  };

/** Encrypt one redacted credential into the versioned persistence representation. */
export async function encryptCredential(
  runtime: RuntimeSource,
  value: Redacted<string>,
  context: CredentialContext,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(encodeContext(context)),
      },
      await importCipherKey(runtime),
      toArrayBuffer(new TextEncoder().encode(reveal(value))),
    );
  } catch (cause: unknown) {
    if (cause instanceof CredentialCipherError) throw cause;
    throw new CredentialCipherError(
      'CredentialCipherOperationFailed',
      'Credential encryption failed.',
    );
  }
  return `${CIPHER_VERSION}.${encodeBase64Url(nonce)}.${
    encodeBase64Url(new Uint8Array(ciphertext))
  }`;
}

/** Decrypt one persisted credential and keep its plaintext behind the redacted wrapper. */
export async function decryptCredential(
  runtime: RuntimeSource,
  envelope: string,
  context: CredentialContext,
): Promise<Redacted<string>> {
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== CIPHER_VERSION) {
    throw new CredentialCipherError(
      'CredentialCipherEnvelopeInvalid',
      'Encrypted credential has an unsupported version.',
    );
  }
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    nonce = decodeBase64Url(parts[1] ?? '');
    ciphertext = decodeBase64Url(parts[2] ?? '');
  } catch (_cause: unknown) {
    throw new CredentialCipherError(
      'CredentialCipherEnvelopeInvalid',
      'Encrypted credential is invalid.',
    );
  }
  if (nonce.byteLength !== AES_GCM_NONCE_BYTES || ciphertext.byteLength === 0) {
    throw new CredentialCipherError(
      'CredentialCipherEnvelopeInvalid',
      'Encrypted credential is invalid.',
    );
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(encodeContext(context)),
      },
      await importCipherKey(runtime),
      toArrayBuffer(ciphertext),
    );
    const value = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    if (!value) {
      throw new CredentialCipherError(
        'CredentialCipherEnvelopeInvalid',
        'Encrypted credential contains an empty value.',
      );
    }
    return redact(value);
  } catch (cause: unknown) {
    if (
      cause instanceof CredentialCipherError &&
      cause._tag === 'CredentialCipherConfigurationInvalid'
    ) throw cause;
    throw new CredentialCipherError(
      'CredentialCipherEnvelopeInvalid',
      'Encrypted credential could not be authenticated.',
    );
  }
}

function encodeContext(context: CredentialContext): Uint8Array {
  if (context.purpose === 'password-reset-token') {
    return new TextEncoder().encode([
      CIPHER_VERSION,
      context.purpose,
      context.resetTokenId,
      context.userId,
    ].join('\n'));
  }
  if (context.purpose === 'oidc-client-secret') {
    return new TextEncoder().encode([
      CIPHER_VERSION,
      context.purpose,
      context.tenantId,
      context.provider,
    ].join('\n'));
  }
  return new TextEncoder().encode([
    CIPHER_VERSION,
    context.purpose,
    context.tenantId,
    context.connectionId,
    context.userId ?? '',
  ].join('\n'));
}

async function importCipherKey(runtime: RuntimeSource): Promise<CryptoKey> {
  const keyBytes = readCipherKeyBytes(runtime);
  try {
    return await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  } catch (_cause: unknown) {
    throw new CredentialCipherError(
      'CredentialCipherConfigurationInvalid',
      `${CIPHER_KEY_ENV} could not be imported as an AES-GCM key.`,
    );
  }
}

/** Fail fast when the runtime cannot supply the configured credential-encryption key. */
export function validateCredentialCipherRuntime(runtime: RuntimeSource): void {
  readCipherKeyBytes(runtime);
}

function readCipherKeyBytes(runtime: RuntimeSource): Uint8Array {
  const encoded = getEnv(CIPHER_KEY_ENV, runtime);
  if (!encoded) {
    throw new CredentialCipherError(
      'CredentialCipherConfigurationInvalid',
      `Missing required env var ${CIPHER_KEY_ENV}`,
    );
  }
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64Url(encoded);
  } catch (_cause: unknown) {
    throw new CredentialCipherError(
      'CredentialCipherConfigurationInvalid',
      `${CIPHER_KEY_ENV} must contain one base64url-encoded 256-bit key.`,
    );
  }
  if (keyBytes.byteLength !== 32) {
    throw new CredentialCipherError(
      'CredentialCipherConfigurationInvalid',
      `${CIPHER_KEY_ENV} must contain one base64url-encoded 256-bit key.`,
    );
  }
  return keyBytes;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
