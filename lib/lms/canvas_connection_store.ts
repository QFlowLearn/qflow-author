import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';

import type { QflowDatabase } from '../db.ts';
import { canvasConnections, canvasOauthStates, canvasUserGrants } from '../db/schema.ts';
import { recordAuditEventInTransaction } from '../services/audit_logs.ts';
import type { RequestContext } from '../tenants.ts';
import {
  type CanvasAuthorizationState,
  type CanvasConnectionId,
  parseCanvasConnectionId,
  parseStoredCanvasConnection,
  type StoredCanvasConnection,
} from './canvas_connection_types.ts';

/** Encrypted per-user Canvas authorization stored without plaintext token material. */
export type StoredCanvasGrant = {
  readonly encryptedRefreshToken: string;
  readonly canvasUserId: string | null;
};

/** Active tenant connection and the current user's encrypted grant loaded together. */
export type StoredCanvasConnectionAuthorization = {
  readonly connection: StoredCanvasConnection;
  readonly grant: StoredCanvasGrant | null;
};

/** Outcome of writing a grant guarded by the developer-key version used for OAuth. */
export type CanvasGrantWriteOutcome =
  | 'stored'
  | 'connection_not_active'
  | 'credential_changed';

/** Credential-free Canvas fields required to begin an OAuth authorization request. */
export type CanvasAuthorizationTarget = {
  readonly baseUrl: string;
  readonly clientId: string;
};

/** Outcome of atomically creating an OAuth state against one active developer-key version. */
export type CanvasAuthorizationStateWriteOutcome =
  | { readonly _tag: 'Stored'; readonly target: CanvasAuthorizationTarget }
  | { readonly _tag: 'ConnectionNotActive' };

/** List active tenant connections authorized by the current user. */
export async function listAuthorizedCanvasConnections(
  database: QflowDatabase,
  auth: RequestContext,
): Promise<readonly StoredCanvasConnection[]> {
  const rows = await database.select({ connection: canvasConnections })
    .from(canvasConnections)
    .innerJoin(
      canvasUserGrants,
      and(
        eq(canvasUserGrants.connectionId, canvasConnections.id),
        eq(canvasUserGrants.tenantId, auth.tenantId),
        eq(canvasUserGrants.userId, auth.userId),
      ),
    )
    .where(and(
      eq(canvasConnections.tenantId, auth.tenantId),
      eq(canvasConnections.lifecycleState, 'active'),
    ))
    .orderBy(canvasConnections.name);
  return rows.map((row) => parseStoredCanvasConnection(row.connection));
}

/** List tenant connections with the current user's authorization projection. */
export async function listCanvasConnectionSettingRows(
  database: QflowDatabase,
  auth: RequestContext,
): Promise<
  readonly {
    readonly connection: StoredCanvasConnection;
    readonly currentUserAuthorized: boolean;
  }[]
> {
  const rows = await database.select({
    connection: canvasConnections,
    grantedUserId: canvasUserGrants.userId,
  }).from(canvasConnections).leftJoin(
    canvasUserGrants,
    and(
      eq(canvasUserGrants.connectionId, canvasConnections.id),
      eq(canvasUserGrants.tenantId, auth.tenantId),
      eq(canvasUserGrants.userId, auth.userId),
    ),
  ).where(eq(canvasConnections.tenantId, auth.tenantId)).orderBy(canvasConnections.name);
  return rows.map((row) => ({
    connection: parseStoredCanvasConnection(row.connection),
    currentUserAuthorized: row.grantedUserId === auth.userId,
  }));
}

/** Persist one tenant connection and its credential-free audit record. */
export async function insertCanvasConnection(
  database: QflowDatabase,
  auth: RequestContext,
  input: {
    readonly id: CanvasConnectionId;
    readonly name: string;
    readonly baseUrl: string;
    readonly clientId: string;
    readonly encryptedClientSecret: string;
  },
): Promise<StoredCanvasConnection> {
  const now = new Date();
  return await database.transaction(async (tx) => {
    const rows = await tx.insert(canvasConnections).values({
      ...input,
      tenantId: auth.tenantId,
      credentialVersion: 1,
      lifecycleState: 'active',
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    }).returning();
    const persisted = rows[0];
    if (!persisted) throw new Error('Canvas connection was not persisted.');
    await recordAuditEventInTransaction(tx, {
      tenantId: auth.tenantId,
      action: 'canvas_connection_created',
      actorUserId: auth.userId,
      metadata: { connectionId: input.id, baseUrl: input.baseUrl, credentialVersion: 1 },
    });
    return parseStoredCanvasConnection(persisted);
  });
}

/** Load one tenant-owned connection, including encrypted credential fields. */
export async function loadStoredCanvasConnection(
  database: QflowDatabase,
  tenantId: string,
  connectionId: CanvasConnectionId,
): Promise<StoredCanvasConnection | null> {
  const rows = await database.select().from(canvasConnections).where(and(
    eq(canvasConnections.id, connectionId),
    eq(canvasConnections.tenantId, tenantId),
  )).limit(1);
  return rows[0] ? parseStoredCanvasConnection(rows[0]) : null;
}

/** Load one active connection and the current user's grant in a single tenant-scoped query. */
export async function loadStoredCanvasConnectionAuthorization(
  database: QflowDatabase,
  auth: RequestContext,
  connectionId: CanvasConnectionId,
): Promise<StoredCanvasConnectionAuthorization | null> {
  const rows = await database.select({
    connection: canvasConnections,
    encryptedRefreshToken: canvasUserGrants.encryptedRefreshToken,
    canvasUserId: canvasUserGrants.canvasUserId,
  }).from(canvasConnections).leftJoin(
    canvasUserGrants,
    and(
      eq(canvasUserGrants.connectionId, canvasConnections.id),
      eq(canvasUserGrants.tenantId, canvasConnections.tenantId),
      eq(canvasUserGrants.userId, auth.userId),
    ),
  ).where(and(
    eq(canvasConnections.id, connectionId),
    eq(canvasConnections.tenantId, auth.tenantId),
    eq(canvasConnections.lifecycleState, 'active'),
  )).limit(1);
  const row = rows[0];
  return row
    ? {
      connection: parseStoredCanvasConnection(row.connection),
      grant: row.encryptedRefreshToken === null ? null : {
        encryptedRefreshToken: row.encryptedRefreshToken,
        canvasUserId: row.canvasUserId,
      },
    }
    : null;
}

/** Change one tenant connection's enabled lifecycle state. */
export async function updateCanvasConnectionLifecycle(
  database: QflowDatabase,
  auth: RequestContext,
  connectionId: CanvasConnectionId,
  lifecycleState: 'active' | 'disabled',
): Promise<'changed' | 'unchanged' | 'not_found'> {
  return await database.transaction(async (tx) => {
    const rows = await tx.select({ lifecycleState: canvasConnections.lifecycleState })
      .from(canvasConnections).where(and(
        eq(canvasConnections.id, connectionId),
        eq(canvasConnections.tenantId, auth.tenantId),
      )).for('update').limit(1);
    const current = rows[0];
    if (!current) return 'not_found';
    if (current.lifecycleState === lifecycleState) return 'unchanged';
    await tx.update(canvasConnections).set({ lifecycleState, updatedAt: sql`now()` }).where(and(
      eq(canvasConnections.id, connectionId),
      eq(canvasConnections.tenantId, auth.tenantId),
      ne(canvasConnections.lifecycleState, lifecycleState),
    ));
    await recordAuditEventInTransaction(tx, {
      tenantId: auth.tenantId,
      action: 'canvas_connection_lifecycle_changed',
      actorUserId: auth.userId,
      metadata: {
        connectionId,
        previousLifecycleState: current.lifecycleState,
        lifecycleState,
      },
    });
    return 'changed';
  });
}

/** Atomically replace a developer key and revoke all grants and pending OAuth states. */
export async function rotateStoredCanvasDeveloperKey(
  database: QflowDatabase,
  auth: RequestContext,
  input: {
    readonly connectionId: CanvasConnectionId;
    readonly clientId: string;
    readonly encryptedClientSecret: string;
    readonly expectedCredentialVersion: number;
  },
): Promise<boolean> {
  const nextVersion = input.expectedCredentialVersion + 1;
  return await database.transaction(async (tx) => {
    const updated = await tx.update(canvasConnections).set({
      clientId: input.clientId,
      encryptedClientSecret: input.encryptedClientSecret,
      credentialVersion: nextVersion,
      updatedAt: sql`now()`,
    }).where(and(
      eq(canvasConnections.id, input.connectionId),
      eq(canvasConnections.tenantId, auth.tenantId),
      eq(canvasConnections.credentialVersion, input.expectedCredentialVersion),
    )).returning({ id: canvasConnections.id });
    if (!updated.length) return false;
    const revokedGrants = await tx.delete(canvasUserGrants).where(and(
      eq(canvasUserGrants.connectionId, input.connectionId),
      eq(canvasUserGrants.tenantId, auth.tenantId),
    )).returning({ userId: canvasUserGrants.userId });
    const revokedStates = await tx.delete(canvasOauthStates).where(and(
      eq(canvasOauthStates.connectionId, input.connectionId),
      eq(canvasOauthStates.tenantId, auth.tenantId),
    )).returning({ stateHash: canvasOauthStates.stateHash });
    await recordAuditEventInTransaction(tx, {
      tenantId: auth.tenantId,
      action: 'canvas_developer_key_rotated',
      actorUserId: auth.userId,
      metadata: {
        connectionId: input.connectionId,
        previousCredentialVersion: input.expectedCredentialVersion,
        credentialVersion: nextVersion,
        revokedGrantCount: revokedGrants.length,
        revokedAuthorizationStateCount: revokedStates.length,
      },
    });
    return true;
  });
}

/** Remove the current user's grant and record the change when one existed. */
export async function deleteStoredCanvasGrant(
  database: QflowDatabase,
  auth: RequestContext,
  connectionId: CanvasConnectionId,
): Promise<'disconnected' | 'already_disconnected'> {
  return await database.transaction(async (tx) => {
    const removed = await tx.delete(canvasUserGrants).where(and(
      eq(canvasUserGrants.connectionId, connectionId),
      eq(canvasUserGrants.tenantId, auth.tenantId),
      eq(canvasUserGrants.userId, auth.userId),
    )).returning({ connectionId: canvasUserGrants.connectionId });
    if (!removed.length) return 'already_disconnected';
    await recordAuditEventInTransaction(tx, {
      tenantId: auth.tenantId,
      action: 'canvas_user_grant_disconnected',
      actorUserId: auth.userId,
      targetUserId: auth.userId,
      metadata: { connectionId },
    });
    return 'disconnected';
  });
}

/** Lock one active connection and create a one-time OAuth state for its current credentials. */
export async function createCanvasAuthorizationState(
  database: QflowDatabase,
  input: {
    readonly stateHash: string;
    readonly connectionId: CanvasConnectionId;
    readonly tenantId: string;
    readonly userId: string;
    readonly returnPath: string;
    readonly createdAt: Date;
    readonly expiresAt: Date;
  },
): Promise<CanvasAuthorizationStateWriteOutcome> {
  return await database.transaction(async (tx) => {
    const rows = await tx.select().from(canvasConnections).where(and(
      eq(canvasConnections.id, input.connectionId),
      eq(canvasConnections.tenantId, input.tenantId),
    )).for('update').limit(1);
    const row = rows[0];
    if (!row || row.lifecycleState !== 'active') return { _tag: 'ConnectionNotActive' };
    const connection = parseStoredCanvasConnection(row);
    await tx.delete(canvasOauthStates).where(and(
      eq(canvasOauthStates.connectionId, input.connectionId),
      eq(canvasOauthStates.tenantId, input.tenantId),
      eq(canvasOauthStates.userId, input.userId),
      lt(canvasOauthStates.expiresAt, input.createdAt),
    ));
    await tx.insert(canvasOauthStates).values({
      ...input,
      credentialVersion: connection.credentialVersion,
    });
    return {
      _tag: 'Stored',
      target: { baseUrl: connection.baseUrl, clientId: connection.clientId },
    };
  });
}

/** Consume one unexpired OAuth state exactly once for the same tenant and user. */
export async function takeCanvasAuthorizationState(
  database: QflowDatabase,
  auth: RequestContext,
  stateHash: string,
): Promise<CanvasAuthorizationState | null> {
  return await database.transaction(async (tx) => {
    const rows = await tx.select().from(canvasOauthStates).where(and(
      eq(canvasOauthStates.stateHash, stateHash),
      eq(canvasOauthStates.tenantId, auth.tenantId),
      eq(canvasOauthStates.userId, auth.userId),
      gt(canvasOauthStates.expiresAt, new Date()),
    )).for('update').limit(1);
    const row = rows[0];
    if (!row) return null;
    await tx.delete(canvasOauthStates).where(and(
      eq(canvasOauthStates.stateHash, stateHash),
      eq(canvasOauthStates.tenantId, auth.tenantId),
      eq(canvasOauthStates.userId, auth.userId),
    ));
    const connectionId = parseCanvasConnectionId(row.connectionId);
    if (
      !connectionId || row.tenantId !== auth.tenantId || row.userId !== auth.userId ||
      !Number.isSafeInteger(row.credentialVersion) || row.credentialVersion < 1
    ) return null;
    return {
      connectionId,
      tenantId: row.tenantId,
      userId: row.userId,
      credentialVersion: row.credentialVersion,
      returnPath: row.returnPath,
    };
  });
}

/** Upsert one encrypted user grant after a successful authorization-code exchange. */
export async function upsertStoredCanvasGrant(
  database: QflowDatabase,
  auth: RequestContext,
  input: {
    readonly connectionId: CanvasConnectionId;
    readonly encryptedRefreshToken: string;
    readonly canvasUserId: string | null;
    readonly expectedCredentialVersion: number;
  },
): Promise<CanvasGrantWriteOutcome> {
  const now = new Date();
  return await database.transaction(async (tx) => {
    const connections = await tx.select({
      credentialVersion: canvasConnections.credentialVersion,
      lifecycleState: canvasConnections.lifecycleState,
    }).from(canvasConnections).where(and(
      eq(canvasConnections.id, input.connectionId),
      eq(canvasConnections.tenantId, auth.tenantId),
    )).for('update').limit(1);
    const connection = connections[0];
    if (!connection || connection.lifecycleState !== 'active') return 'connection_not_active';
    if (connection.credentialVersion !== input.expectedCredentialVersion) {
      return 'credential_changed';
    }
    await tx.insert(canvasUserGrants).values({
      connectionId: input.connectionId,
      tenantId: auth.tenantId,
      userId: auth.userId,
      encryptedRefreshToken: input.encryptedRefreshToken,
      canvasUserId: input.canvasUserId,
      authorizedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [canvasUserGrants.connectionId, canvasUserGrants.userId],
      set: {
        tenantId: auth.tenantId,
        encryptedRefreshToken: input.encryptedRefreshToken,
        canvasUserId: input.canvasUserId,
        authorizedAt: now,
        updatedAt: now,
      },
    });
    await recordAuditEventInTransaction(tx, {
      tenantId: auth.tenantId,
      action: 'canvas_user_grant_authorized',
      actorUserId: auth.userId,
      targetUserId: auth.userId,
      metadata: { connectionId: input.connectionId, canvasUserId: input.canvasUserId },
    });
    return 'stored';
  });
}
