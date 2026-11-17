import {
  CredentialCipherError,
  decryptCredential,
  encryptCredential,
} from '../credential_cipher.ts';
import { encodeBase64Url } from '../base64.ts';
import { getDb, type QflowDatabase } from '../db.ts';
import { parseHttpsOrigin } from '../http_url.ts';
import { type Redacted, reveal } from '../redacted.ts';
import { roleAtLeast } from '../roles.ts';
import { sha256Hex } from '../sha256.ts';
import type { RequestContext } from '../tenants.ts';
import {
  type AuthorizedCanvasConnection,
  type CanvasAuthorizationState,
  type CanvasConnection,
  type CanvasConnectionId,
  type CanvasConnectionResult,
  type CanvasConnectionSettings,
  canvasConnectionSettings,
  canvasFailure,
  type CanvasOperationResult,
  parseCanvasConnectionId,
  publicCanvasConnection,
  type StoredCanvasConnection,
} from './canvas_connection_types.ts';
import {
  type CanvasAuthorizationTarget,
  createCanvasAuthorizationState,
  deleteStoredCanvasGrant,
  insertCanvasConnection,
  listAuthorizedCanvasConnections,
  listCanvasConnectionSettingRows,
  loadStoredCanvasConnection,
  loadStoredCanvasConnectionAuthorization,
  rotateStoredCanvasDeveloperKey,
  type StoredCanvasGrant,
  takeCanvasAuthorizationState,
  updateCanvasConnectionLifecycle,
  upsertStoredCanvasGrant,
} from './canvas_connection_store.ts';
import type { RuntimeSource } from '../runtime.ts';
import {
  requestCanvasAccessToken,
  requestCanvasAuthorizationToken,
} from './canvas_oauth_client.ts';

export type {
  AuthorizedCanvasConnection,
  CanvasAuthorizationState,
  CanvasConnection,
  CanvasConnectionFailure,
  CanvasConnectionFailureTag,
  CanvasConnectionId,
  CanvasConnectionResult,
  CanvasConnectionSettings,
  CanvasOperationResult,
  CanvasPublishTargetId,
} from './canvas_connection_types.ts';
export { parseCanvasConnectionId } from './canvas_connection_types.ts';

type PersistenceFailure = 'CanvasPersistenceUnavailable';
type CipherFailure = 'CanvasCredentialInvalid' | 'CanvasConfigurationInvalid';
type AdministrationFailure = 'CanvasAdministrationDenied';
type CanvasAdministrator = Omit<RequestContext, 'role'> & {
  readonly role: 'owner' | 'admin';
};
type ConnectionLookupFailure =
  | 'CanvasConnectionNotFound'
  | 'CanvasAuthorizationRequired'
  | PersistenceFailure;
type AuthorizationFailure =
  | ConnectionLookupFailure
  | CipherFailure
  | 'CanvasOAuthRequestFailed';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const CANVAS_DIRECT_PUBLISH_SCOPES = [
  'url:POST|/api/v1/courses/:course_id/content_migrations',
  'url:PUT|/api/v1/courses/:course_id/content_migrations/:id',
  'url:GET|/api/v1/courses/:course_id/content_migrations/:id',
  'url:GET|/api/v1/progress/:id',
] as const;

/** List active tenant connections already authorized by the current author. */
export async function listCanvasConnections(
  auth: RequestContext,
  runtime?: RuntimeSource,
): Promise<CanvasOperationResult<readonly CanvasConnection[], PersistenceFailure>> {
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  try {
    const connections = await listAuthorizedCanvasConnections(database.value, auth);
    return { ok: true, value: connections.map(publicCanvasConnection) };
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

/** List tenant Canvas installations and the current user's authorization state. */
export async function listCanvasConnectionSettings(
  auth: RequestContext,
  runtime?: RuntimeSource,
): Promise<CanvasOperationResult<readonly CanvasConnectionSettings[], PersistenceFailure>> {
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  try {
    const rows = await listCanvasConnectionSettingRows(database.value, auth);
    return {
      ok: true,
      value: rows.map((row) => canvasConnectionSettings(row.connection, row.currentUserAuthorized)),
    };
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

/** Create one tenant-owned Canvas installation with an encrypted developer-key secret. */
export async function createCanvasConnection(
  auth: RequestContext,
  input: {
    readonly name: string;
    readonly baseUrl: string;
    readonly clientId: string;
    readonly clientSecret: Redacted<string>;
  },
  runtime?: RuntimeSource,
): Promise<
  CanvasOperationResult<
    CanvasConnectionSettings,
    | 'CanvasInputInvalid'
    | 'CanvasConfigurationInvalid'
    | AdministrationFailure
    | PersistenceFailure
  >
> {
  const administrator = parseCanvasAdministrator(auth);
  if (!administrator) return canvasFailure('CanvasAdministrationDenied');
  const parsed = parseConnectionInput(input);
  if (!parsed.ok) return parsed;
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  const id = requireGeneratedConnectionId();
  let encryptedClientSecret: string;
  try {
    encryptedClientSecret = await encryptCredential(runtime, input.clientSecret, {
      purpose: 'canvas-client-secret',
      tenantId: administrator.tenantId,
      connectionId: id,
    });
  } catch (_cause: unknown) {
    return canvasFailure('CanvasConfigurationInvalid');
  }
  try {
    const connection = await insertCanvasConnection(database.value, administrator, {
      id,
      ...parsed.value,
      encryptedClientSecret,
    });
    return { ok: true, value: canvasConnectionSettings(connection, false) };
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

/** Change whether a tenant Canvas installation accepts new publishing work. */
export async function setCanvasConnectionLifecycle(
  auth: RequestContext,
  connectionId: CanvasConnectionId,
  lifecycleState: 'active' | 'disabled',
  runtime?: RuntimeSource,
): Promise<
  CanvasOperationResult<
    'changed' | 'unchanged',
    'CanvasConnectionNotFound' | AdministrationFailure | PersistenceFailure
  >
> {
  const administrator = parseCanvasAdministrator(auth);
  if (!administrator) return canvasFailure('CanvasAdministrationDenied');
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  try {
    const outcome = await updateCanvasConnectionLifecycle(
      database.value,
      administrator,
      connectionId,
      lifecycleState,
    );
    return outcome === 'not_found'
      ? canvasFailure('CanvasConnectionNotFound')
      : { ok: true, value: outcome };
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

/** Replace a Canvas developer key and revoke every grant issued under the prior key. */
export async function rotateCanvasDeveloperKey(
  auth: RequestContext,
  connectionId: CanvasConnectionId,
  input: {
    readonly clientId: string;
    readonly clientSecret: Redacted<string>;
    readonly expectedCredentialVersion: number;
  },
  runtime?: RuntimeSource,
): Promise<
  | { readonly ok: true; readonly credentialVersion: number }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag:
        | 'CanvasInputInvalid'
        | 'CanvasConnectionNotFound'
        | 'CanvasCredentialRotationConflict'
        | 'CanvasConfigurationInvalid'
        | AdministrationFailure
        | PersistenceFailure;
      readonly message: string;
    };
  }
> {
  const administrator = parseCanvasAdministrator(auth);
  if (!administrator) return canvasFailure('CanvasAdministrationDenied');
  const clientId = parseBoundedText(input.clientId, 1, 255);
  if (!clientId || !reveal(input.clientSecret).trim()) {
    return canvasFailure('CanvasInputInvalid', 'Enter a Canvas client ID and client secret.');
  }
  if (
    !Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 1
  ) {
    return canvasFailure('CanvasInputInvalid', 'The Canvas credential version is invalid.');
  }
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  let connection: StoredCanvasConnection | null;
  try {
    connection = await loadStoredCanvasConnection(
      database.value,
      administrator.tenantId,
      connectionId,
    );
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
  if (!connection) return canvasFailure('CanvasConnectionNotFound');
  if (connection.credentialVersion !== input.expectedCredentialVersion) {
    return canvasFailure('CanvasCredentialRotationConflict');
  }

  let encryptedClientSecret: string;
  try {
    encryptedClientSecret = await encryptCredential(runtime, input.clientSecret, {
      purpose: 'canvas-client-secret',
      tenantId: administrator.tenantId,
      connectionId,
    });
  } catch (_cause: unknown) {
    return canvasFailure('CanvasConfigurationInvalid');
  }
  try {
    const rotated = await rotateStoredCanvasDeveloperKey(database.value, administrator, {
      connectionId,
      clientId,
      encryptedClientSecret,
      expectedCredentialVersion: input.expectedCredentialVersion,
    });
    return rotated
      ? { ok: true, credentialVersion: input.expectedCredentialVersion + 1 }
      : canvasFailure('CanvasCredentialRotationConflict');
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

/** Remove the current user's local Canvas authorization grant. */
export async function disconnectCanvasConnection(
  auth: RequestContext,
  connectionId: CanvasConnectionId,
  runtime?: RuntimeSource,
): Promise<
  CanvasOperationResult<'disconnected' | 'already_disconnected', PersistenceFailure>
> {
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  try {
    return {
      ok: true,
      value: await deleteStoredCanvasGrant(database.value, auth, connectionId),
    };
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

/** Resolve one active connection only when the current user has authorized it. */
export async function resolveCanvasConnection(
  auth: RequestContext,
  connectionId: CanvasConnectionId,
  runtime?: RuntimeSource,
): Promise<CanvasConnectionResult<CanvasConnection, ConnectionLookupFailure>> {
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  const stored = await loadAuthorizedConnection(database.value, auth, connectionId);
  if (!stored.ok) return stored;
  return { ok: true, connection: publicCanvasConnection(stored.connection) };
}

/** Refresh and return a short-lived Canvas token for the current author. */
export async function authorizeCanvasConnection(
  runtime: RuntimeSource,
  auth: RequestContext,
  connectionId: CanvasConnectionId,
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<
  CanvasConnectionResult<
    AuthorizedCanvasConnection,
    AuthorizationFailure
  >
> {
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  const stored = await loadAuthorizedConnection(database.value, auth, connectionId);
  if (!stored.ok) return stored;

  let clientSecret: Redacted<string>;
  let refreshToken: Redacted<string>;
  try {
    [clientSecret, refreshToken] = await Promise.all([
      decryptCredential(runtime, stored.connection.encryptedClientSecret, {
        purpose: 'canvas-client-secret',
        tenantId: auth.tenantId,
        connectionId,
      }),
      decryptCredential(runtime, stored.grant.encryptedRefreshToken, {
        purpose: 'canvas-refresh-token',
        tenantId: auth.tenantId,
        connectionId,
        userId: auth.userId,
      }),
    ]);
  } catch (cause: unknown) {
    return classifyCipherFailure(cause);
  }
  const token = await requestCanvasAccessToken(
    stored.connection,
    { clientSecret, refreshToken },
    options,
  );
  if (!token.ok) return token;
  return {
    ok: true,
    connection: {
      ...publicCanvasConnection(stored.connection),
      accessToken: token.value.accessToken,
    },
  };
}

/** Create one-time OAuth state and return the Canvas authorization URL. */
export async function beginCanvasAuthorization(
  auth: RequestContext,
  connectionId: CanvasConnectionId,
  redirectUri: string,
  runtime?: RuntimeSource,
): Promise<
  | { readonly ok: true; readonly authorizationUrl: string }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag: 'CanvasConnectionNotFound' | PersistenceFailure;
      readonly message: string;
    };
  }
> {
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  const state = opaqueToken();
  const now = new Date();
  let target: CanvasAuthorizationTarget;
  try {
    const outcome = await createCanvasAuthorizationState(database.value, {
      stateHash: await hashOAuthState(state),
      connectionId,
      tenantId: auth.tenantId,
      userId: auth.userId,
      returnPath: '/settings/canvas',
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    });
    switch (outcome._tag) {
      case 'ConnectionNotActive':
        return canvasFailure('CanvasConnectionNotFound');
      case 'Stored':
        target = outcome.target;
        break;
      default:
        return unexpectedCanvasAuthorizationStateWriteOutcome(outcome);
    }
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
  const authorizationUrl = new URL('/login/oauth2/auth', target.baseUrl);
  authorizationUrl.searchParams.set('client_id', target.clientId);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('scope', CANVAS_DIRECT_PUBLISH_SCOPES.join(' '));
  return { ok: true, authorizationUrl: authorizationUrl.toString() };
}

/** Consume one OAuth state exactly once for the same authenticated user and tenant. */
export async function consumeCanvasAuthorizationState(
  auth: RequestContext,
  state: string,
  runtime?: RuntimeSource,
): Promise<
  CanvasOperationResult<
    CanvasAuthorizationState,
    'CanvasAuthorizationStateInvalid' | PersistenceFailure
  >
> {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(state)) {
    return canvasFailure('CanvasAuthorizationStateInvalid');
  }
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  try {
    const consumed = await takeCanvasAuthorizationState(
      database.value,
      auth,
      await hashOAuthState(state),
    );
    return consumed
      ? { ok: true, value: consumed }
      : canvasFailure('CanvasAuthorizationStateInvalid');
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

/** Exchange a Canvas authorization code and persist the user's encrypted refresh grant. */
export async function completeCanvasAuthorization(
  auth: RequestContext,
  state: CanvasAuthorizationState,
  code: string,
  redirectUri: string,
  runtime?: RuntimeSource,
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<
  CanvasOperationResult<
    'authorized',
    | 'CanvasAuthorizationStateInvalid'
    | 'CanvasConnectionNotFound'
    | 'CanvasCredentialRotationConflict'
    | 'CanvasOAuthRequestFailed'
    | CipherFailure
    | PersistenceFailure
  >
> {
  if (state.tenantId !== auth.tenantId || state.userId !== auth.userId) {
    return canvasFailure('CanvasAuthorizationStateInvalid');
  }
  if (!code.trim()) return canvasFailure('CanvasOAuthRequestFailed');
  const database = canvasDatabase(runtime);
  if (!database.ok) return database;
  let connection: StoredCanvasConnection | null;
  try {
    connection = await loadStoredCanvasConnection(
      database.value,
      auth.tenantId,
      state.connectionId,
    );
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
  if (!connection || connection.lifecycleState !== 'active') {
    return canvasFailure('CanvasConnectionNotFound');
  }
  if (connection.credentialVersion !== state.credentialVersion) {
    return canvasFailure('CanvasCredentialRotationConflict');
  }

  let clientSecret: Redacted<string>;
  try {
    clientSecret = await decryptCredential(runtime, connection.encryptedClientSecret, {
      purpose: 'canvas-client-secret',
      tenantId: auth.tenantId,
      connectionId: connection.id,
    });
  } catch (cause: unknown) {
    return classifyCipherFailure(cause);
  }
  const token = await requestCanvasAuthorizationToken(
    connection,
    { clientSecret, code: code.trim(), redirectUri },
    options,
  );
  if (!token.ok) return token;

  let encryptedRefreshToken: string;
  try {
    encryptedRefreshToken = await encryptCredential(runtime, token.value.refreshToken, {
      purpose: 'canvas-refresh-token',
      tenantId: auth.tenantId,
      connectionId: connection.id,
      userId: auth.userId,
    });
  } catch (cause: unknown) {
    return classifyCipherFailure(cause);
  }
  try {
    const outcome = await upsertStoredCanvasGrant(database.value, auth, {
      connectionId: connection.id,
      encryptedRefreshToken,
      canvasUserId: token.value.canvasUserId,
      expectedCredentialVersion: state.credentialVersion,
    });
    switch (outcome) {
      case 'stored':
        return { ok: true, value: 'authorized' };
      case 'credential_changed':
        return canvasFailure('CanvasCredentialRotationConflict');
      case 'connection_not_active':
        return canvasFailure('CanvasConnectionNotFound');
      default:
        return unexpectedCanvasGrantWriteOutcome(outcome);
    }
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

function unexpectedCanvasAuthorizationStateWriteOutcome(_outcome: never): never {
  throw new Error('Unhandled Canvas authorization-state write outcome.');
}

function parseCanvasAdministrator(auth: RequestContext): CanvasAdministrator | null {
  if (!roleAtLeast(auth.role, 'admin')) return null;
  // SAFETY: roleAtLeast established that the closed role union is owner or admin.
  return auth as CanvasAdministrator;
}

function unexpectedCanvasGrantWriteOutcome(_outcome: never): never {
  throw new Error('Unhandled Canvas grant write outcome.');
}

async function loadAuthorizedConnection(
  database: QflowDatabase,
  auth: RequestContext,
  connectionId: CanvasConnectionId,
): Promise<
  | {
    readonly ok: true;
    readonly connection: StoredCanvasConnection;
    readonly grant: StoredCanvasGrant;
  }
  | {
    readonly ok: false;
    readonly error: { readonly _tag: ConnectionLookupFailure; readonly message: string };
  }
> {
  try {
    const authorization = await loadStoredCanvasConnectionAuthorization(
      database,
      auth,
      connectionId,
    );
    if (!authorization) return canvasFailure('CanvasConnectionNotFound');
    if (!authorization.grant) return canvasFailure('CanvasAuthorizationRequired');
    return { ok: true, ...authorization, grant: authorization.grant };
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

function canvasDatabase(
  runtime: RuntimeSource,
): CanvasOperationResult<QflowDatabase, PersistenceFailure> {
  try {
    return { ok: true, value: getDb(runtime) };
  } catch (_cause: unknown) {
    return canvasFailure('CanvasPersistenceUnavailable');
  }
}

function parseConnectionInput(input: {
  readonly name: string;
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: Redacted<string>;
}): CanvasOperationResult<
  { readonly name: string; readonly baseUrl: string; readonly clientId: string },
  'CanvasInputInvalid'
> {
  const name = parseBoundedText(input.name, 1, 120);
  if (!name) return canvasFailure('CanvasInputInvalid', 'Enter a Canvas connection name.');
  const baseUrl = parseHttpsOrigin(input.baseUrl);
  if (!baseUrl) {
    return canvasFailure('CanvasInputInvalid', 'Enter one HTTPS Canvas URL without a path.');
  }
  const clientId = parseBoundedText(input.clientId, 1, 255);
  if (!clientId) return canvasFailure('CanvasInputInvalid', 'Enter a Canvas client ID.');
  if (!reveal(input.clientSecret).trim()) {
    return canvasFailure('CanvasInputInvalid', 'Enter a Canvas client secret.');
  }
  return { ok: true, value: { name, baseUrl, clientId } };
}

function parseBoundedText(input: string, minimum: number, maximum: number): string | null {
  const value = input.trim();
  return value.length >= minimum && value.length <= maximum ? value : null;
}

function requireGeneratedConnectionId(): CanvasConnectionId {
  const id = parseCanvasConnectionId(crypto.randomUUID());
  if (!id) throw new Error('Generated Canvas connection ID is invalid.');
  return id;
}

function opaqueToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hashOAuthState(state: string): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(state));
}

function classifyCipherFailure(
  cause: unknown,
): {
  readonly ok: false;
  readonly error: { readonly _tag: CipherFailure; readonly message: string };
} {
  return cause instanceof CredentialCipherError &&
      cause._tag === 'CredentialCipherEnvelopeInvalid'
    ? canvasFailure('CanvasCredentialInvalid')
    : canvasFailure('CanvasConfigurationInvalid');
}
