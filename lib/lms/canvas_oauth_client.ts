import { redact, type Redacted, reveal } from '../redacted.ts';
import {
  type CanvasConnectionFailure,
  canvasFailure,
  type StoredCanvasConnection,
} from './canvas_connection_types.ts';

/** Successful Canvas authorization-code exchange. */
export type CanvasAuthorizationToken = {
  readonly accessToken: Redacted<string>;
  readonly refreshToken: Redacted<string>;
  readonly canvasUserId: string | null;
};

/** Successful Canvas refresh exchange. Canvas reuses the submitted refresh token. */
export type CanvasAccessToken = {
  readonly accessToken: Redacted<string>;
};

type CanvasOAuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false;
    readonly error: CanvasConnectionFailure<'CanvasOAuthRequestFailed'>;
  };

type CanvasTokenRequest =
  | {
    readonly grantType: 'authorization_code';
    readonly clientSecret: Redacted<string>;
    readonly code: string;
    readonly redirectUri: string;
  }
  | {
    readonly grantType: 'refresh_token';
    readonly clientSecret: Redacted<string>;
    readonly refreshToken: Redacted<string>;
  };

/** Exchange an authorization code; a refresh token is mandatory in this response. */
export async function requestCanvasAuthorizationToken(
  connection: StoredCanvasConnection,
  request: {
    readonly clientSecret: Redacted<string>;
    readonly code: string;
    readonly redirectUri: string;
  },
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<CanvasOAuthResult<CanvasAuthorizationToken>> {
  const result = await requestCanvasToken(connection, {
    grantType: 'authorization_code',
    ...request,
  }, options);
  if (!result.ok) return result;
  const refreshToken = textValue(result.value.refresh_token);
  if (!refreshToken) return canvasFailure('CanvasOAuthRequestFailed');
  return {
    ok: true,
    value: {
      accessToken: redact(result.value.accessToken),
      refreshToken: redact(refreshToken),
      canvasUserId: result.value.canvasUserId,
    },
  };
}

/** Refresh a short-lived Canvas access token while retaining the submitted refresh token. */
export async function requestCanvasAccessToken(
  connection: StoredCanvasConnection,
  request: {
    readonly clientSecret: Redacted<string>;
    readonly refreshToken: Redacted<string>;
  },
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<CanvasOAuthResult<CanvasAccessToken>> {
  const result = await requestCanvasToken(connection, {
    grantType: 'refresh_token',
    ...request,
  }, options);
  if (!result.ok) return result;
  return { ok: true, value: { accessToken: redact(result.value.accessToken) } };
}

async function requestCanvasToken(
  connection: StoredCanvasConnection,
  request: CanvasTokenRequest,
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal },
): Promise<
  CanvasOAuthResult<{
    readonly accessToken: string;
    readonly refresh_token?: unknown;
    readonly canvasUserId: string | null;
  }>
> {
  const body = new URLSearchParams();
  body.set('grant_type', request.grantType);
  body.set('client_id', connection.clientId);
  body.set('client_secret', reveal(request.clientSecret));
  if (request.grantType === 'authorization_code') {
    body.set('code', request.code);
    body.set('redirect_uri', request.redirectUri);
  } else {
    body.set('refresh_token', reveal(request.refreshToken));
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL('/login/oauth2/token', connection.baseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
        signal: options.signal,
      },
    );
  } catch (cause: unknown) {
    if (isAbortCause(cause)) throw cause;
    return canvasFailure('CanvasOAuthRequestFailed');
  }
  if (!response.ok) return canvasFailure('CanvasOAuthRequestFailed');

  let value: unknown;
  try {
    value = await response.json();
  } catch (_cause: unknown) {
    return canvasFailure('CanvasOAuthRequestFailed');
  }
  const record = asRecord(value);
  const accessToken = textValue(record?.access_token);
  if (!record || !accessToken) return canvasFailure('CanvasOAuthRequestFailed');
  return {
    ok: true,
    value: {
      accessToken,
      refresh_token: record.refresh_token,
      canvasUserId: stringOrNumber(asRecord(record.user)?.id),
    },
  };
}

function textValue(input: unknown): string | null {
  return typeof input === 'string' && input.trim() ? input.trim() : null;
}

function stringOrNumber(input: unknown): string | null {
  if (typeof input === 'string' && input.trim()) return input.trim();
  return typeof input === 'number' && Number.isSafeInteger(input) ? String(input) : null;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: The value is a non-null, non-array object whose properties remain unknown.
  return input as Record<string, unknown>;
}

function isAbortCause(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError' ||
    cause instanceof Error && cause.name === 'AbortError';
}
