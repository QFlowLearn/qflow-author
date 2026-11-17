import type { SelectableAssessmentExportTargetId } from '../export/assessment_export_targets.ts';
import { parseHttpsOrigin } from '../http_url.ts';
import type { Redacted } from '../redacted.ts';
import { parseCanonicalUuid } from '../uuid.ts';

declare const canvasConnectionIdBrand: unique symbol;

/** Stable identifier for one tenant-owned Canvas installation. */
export type CanvasConnectionId = string & {
  readonly [canvasConnectionIdBrand]: 'CanvasConnectionId';
};

/** Canvas export contracts supported by direct publishing. */
export type CanvasPublishTargetId = Extract<
  SelectableAssessmentExportTargetId,
  'canvas-classic' | 'canvas-new-quizzes'
>;

/** Public Canvas connection facts available to an authorized workspace member. */
export type CanvasConnection = {
  readonly id: CanvasConnectionId;
  readonly name: string;
  readonly baseUrl: string;
  readonly supportedTargetIds: readonly CanvasPublishTargetId[];
};

/** Canvas connection plus the short-lived access token resolved for one author. */
export type AuthorizedCanvasConnection = CanvasConnection & {
  readonly accessToken: Redacted<string>;
};

/** Workspace settings projection for one Canvas installation. */
export type CanvasConnectionSettings = CanvasConnection & {
  readonly lifecycleState: 'active' | 'disabled';
  readonly currentUserAuthorized: boolean;
  readonly credentialVersion: number;
};

/** Stored Canvas installation fields used by persistence and OAuth adapters. */
export type StoredCanvasConnection = {
  readonly id: CanvasConnectionId;
  readonly tenantId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly clientId: string;
  readonly encryptedClientSecret: string;
  readonly credentialVersion: number;
  readonly lifecycleState: 'active' | 'disabled';
};

/** Safe Canvas failure classifications that never carry credentials or provider payloads. */
export type CanvasConnectionFailureTag =
  | 'CanvasConnectionNotFound'
  | 'CanvasAuthorizationRequired'
  | 'CanvasAuthorizationStateInvalid'
  | 'CanvasOAuthRequestFailed'
  | 'CanvasCredentialInvalid'
  | 'CanvasConfigurationInvalid'
  | 'CanvasInputInvalid'
  | 'CanvasAdministrationDenied'
  | 'CanvasPersistenceUnavailable'
  | 'CanvasCredentialRotationConflict';

/** One safe Canvas failure narrowed to the tags an operation can produce. */
export type CanvasConnectionFailure<
  Tag extends CanvasConnectionFailureTag = CanvasConnectionFailureTag,
> = {
  readonly _tag: Tag;
  readonly message: string;
};

/** Generic operation result for Canvas commands and projections. */
export type CanvasOperationResult<T, Tag extends CanvasConnectionFailureTag> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CanvasConnectionFailure<Tag> };

/** Result for callers that consume a resolved Canvas connection. */
export type CanvasConnectionResult<T, Tag extends CanvasConnectionFailureTag> =
  | { readonly ok: true; readonly connection: T }
  | { readonly ok: false; readonly error: CanvasConnectionFailure<Tag> };

/** One-time Canvas authorization state consumed by the callback route. */
export type CanvasAuthorizationState = {
  readonly connectionId: CanvasConnectionId;
  readonly tenantId: string;
  readonly userId: string;
  readonly credentialVersion: number;
  readonly returnPath: string;
};

const CANVAS_TARGETS = ['canvas-classic', 'canvas-new-quizzes'] as const;

const FAILURE_MESSAGES = {
  CanvasConnectionNotFound: 'The selected Canvas connection is not available.',
  CanvasAuthorizationRequired: 'Connect your Canvas account before publishing.',
  CanvasAuthorizationStateInvalid: 'This Canvas authorization request is invalid or expired.',
  CanvasOAuthRequestFailed: 'Canvas could not authorize this connection.',
  CanvasCredentialInvalid: 'The Canvas connection credentials could not be used.',
  CanvasConfigurationInvalid: 'Canvas credential encryption is not configured correctly.',
  CanvasInputInvalid: 'The Canvas connection details are invalid.',
  CanvasAdministrationDenied: 'Only workspace admins can manage Canvas sites.',
  CanvasPersistenceUnavailable: 'QFlowLearn could not access saved Canvas connection data.',
  CanvasCredentialRotationConflict:
    'The Canvas developer key changed after this page loaded. Reload and try again.',
} as const satisfies Record<CanvasConnectionFailureTag, string>;

/** Build one catalog-owned Canvas failure. */
export function canvasFailure<Tag extends CanvasConnectionFailureTag>(
  tag: Tag,
  message: string = FAILURE_MESSAGES[tag],
): { readonly ok: false; readonly error: CanvasConnectionFailure<Tag> } {
  return { ok: false, error: { _tag: tag, message } };
}

/** Parse an untrusted Canvas connection identifier without aliases or defaults. */
export function parseCanvasConnectionId(input: unknown): CanvasConnectionId | null {
  const parsed = parseCanonicalUuid(input);
  if (!parsed) return null;
  // SAFETY: parseCanonicalUuid established the Canvas connection identity invariant.
  return parsed as CanvasConnectionId;
}

/** Parse and validate one persisted Canvas connection row. */
export function parseStoredCanvasConnection(
  row: {
    readonly id: string;
    readonly tenantId: string;
    readonly name: string;
    readonly baseUrl: string;
    readonly clientId: string;
    readonly encryptedClientSecret: string;
    readonly credentialVersion: number;
    readonly lifecycleState: string;
  },
): StoredCanvasConnection {
  const id = parseCanvasConnectionId(row.id);
  const baseUrl = parseHttpsOrigin(row.baseUrl);
  if (
    !id || !baseUrl || !row.tenantId || !row.name || !row.clientId ||
    !row.encryptedClientSecret ||
    !Number.isSafeInteger(row.credentialVersion) || row.credentialVersion < 1 ||
    (row.lifecycleState !== 'active' && row.lifecycleState !== 'disabled')
  ) throw new Error('Persisted Canvas connection is invalid.');
  return { ...row, id, baseUrl, lifecycleState: row.lifecycleState };
}

/** Project a stored connection without credentials or tenant-internal fields. */
export function publicCanvasConnection(connection: StoredCanvasConnection): CanvasConnection {
  return {
    id: connection.id,
    name: connection.name,
    baseUrl: connection.baseUrl,
    supportedTargetIds: CANVAS_TARGETS,
  };
}

/** Project one connection for tenant settings without credential material. */
export function canvasConnectionSettings(
  connection: StoredCanvasConnection,
  currentUserAuthorized: boolean,
): CanvasConnectionSettings {
  return {
    ...publicCanvasConnection(connection),
    lifecycleState: connection.lifecycleState,
    currentUserAuthorized,
    credentialVersion: connection.credentialVersion,
  };
}
