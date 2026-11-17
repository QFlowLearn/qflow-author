import { and, eq, isNull } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { authSessions } from '../db/schema.ts';
import { generateAuthToken, hashAuthToken } from './auth_crypto.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AuthSessionStore = Pick<QflowDatabaseTransaction, 'insert' | 'update'>;

/** A generated session secret plus the persistence record containing only its hash. */
export type PreparedAuthSession = {
  readonly token: string;
  readonly expiresAt: Date;
  readonly row: typeof authSessions.$inferInsert;
};

/** Generate one session secret and its canonical persistence record. */
export async function prepareAuthSession(input: {
  readonly userId: string;
  readonly tenantId: string;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
  readonly now?: Date;
}): Promise<PreparedAuthSession> {
  const token = generateAuthToken();
  const tokenHash = await hashAuthToken(token);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  return {
    token,
    expiresAt,
    row: {
      id: crypto.randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      tokenHash,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    },
  };
}

/** Insert a previously prepared session through a database or caller-owned transaction. */
export async function insertPreparedAuthSession(
  store: AuthSessionStore,
  session: PreparedAuthSession,
): Promise<void> {
  await store.insert(authSessions).values(session.row);
}

/** Revoke every active session for a user through a database or caller-owned transaction. */
export async function revokeActiveAuthSessions(
  store: AuthSessionStore,
  userId: string,
  revokedAt: Date,
): Promise<void> {
  await store.update(authSessions).set({ revokedAt }).where(and(
    eq(authSessions.userId, userId),
    isNull(authSessions.revokedAt),
  ));
}
