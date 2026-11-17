import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db.ts';
import { authSessions, users } from '../db/schema.ts';
import { hashAuthToken } from './auth_crypto.ts';
import { insertPreparedAuthSession, prepareAuthSession } from './auth_session_records.ts';

/** Public projection of one active tenant session. */
export type TenantSessionRecord = {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string | null;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
};

/** Create one session, atomically replacing a previous token when supplied. */
export async function createSession(input: {
  readonly userId: string;
  readonly tenantId: string;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
  readonly replaceToken?: string | null;
  readonly now?: Date;
}): Promise<{ readonly token: string; readonly expiresAt: Date }> {
  const now = input.now ?? new Date();
  const [session, replaceTokenHash] = await Promise.all([
    prepareAuthSession({ ...input, now }),
    input.replaceToken ? hashAuthToken(input.replaceToken) : Promise.resolve(null),
  ]);

  if (!replaceTokenHash) {
    await insertPreparedAuthSession(db, session);
  } else {
    await db.transaction(async (tx) => {
      await insertPreparedAuthSession(tx, session);
      await tx.update(authSessions).set({ revokedAt: now }).where(and(
        eq(authSessions.tokenHash, replaceTokenHash),
        isNull(authSessions.revokedAt),
      ));
    });
  }

  return { token: session.token, expiresAt: session.expiresAt };
}

/** Resolve and refresh one active session token. */
export async function getSessionByToken(
  token: string,
): Promise<
  | {
    readonly id: string;
    readonly userId: string;
    readonly tenantId: string;
    readonly expiresAt: Date;
    readonly mustChangePassword: boolean;
  }
  | null
> {
  if (!token) return null;
  const tokenHash = await hashAuthToken(token);
  const now = new Date();
  const rows = await db.select({
    id: authSessions.id,
    userId: authSessions.userId,
    tenantId: authSessions.tenantId,
    expiresAt: authSessions.expiresAt,
    revokedAt: authSessions.revokedAt,
    mustChangePassword: users.mustChangePassword,
  })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) return null;
  await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, row.id));
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    expiresAt: row.expiresAt,
    mustChangePassword: row.mustChangePassword ?? false,
  };
}

/** Revoke one session by its bearer token. */
export async function revokeSessionByToken(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = await hashAuthToken(token);
  await db.update(authSessions).set({ revokedAt: new Date() }).where(
    and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)),
  );
}

/** Revoke one active session only when it belongs to the supplied tenant. */
export async function revokeSessionById(tenantId: string, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const rows = await db.update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(authSessions.id, sessionId),
      eq(authSessions.tenantId, tenantId),
      isNull(authSessions.revokedAt),
    ))
    .returning({ id: authSessions.id });
  return rows.length > 0;
}

/** Revoke every active session for one user within one tenant. */
export async function revokeSessionsForUserInTenant(
  tenantId: string,
  userId: string,
): Promise<number> {
  const rows = await db.update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(authSessions.userId, userId),
      eq(authSessions.tenantId, tenantId),
      isNull(authSessions.revokedAt),
    ))
    .returning({ id: authSessions.id });
  return rows.length;
}

/** List active sessions in a tenant ordered by most recent use. */
export async function listActiveSessionsForTenant(
  tenantId: string,
): Promise<ReadonlyArray<TenantSessionRecord>> {
  const now = new Date();
  const rows = await db.select({
    id: authSessions.id,
    userId: authSessions.userId,
    email: users.email,
    displayName: users.displayName,
    userAgent: authSessions.userAgent,
    ipAddress: authSessions.ipAddress,
    createdAt: authSessions.createdAt,
    lastSeenAt: authSessions.lastSeenAt,
    expiresAt: authSessions.expiresAt,
  })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(
      eq(authSessions.tenantId, tenantId),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, now),
    ))
    .orderBy(desc(authSessions.lastSeenAt));
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName ?? null,
    userAgent: row.userAgent ?? null,
    ipAddress: row.ipAddress ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date(0).toISOString(),
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : new Date(0).toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}
