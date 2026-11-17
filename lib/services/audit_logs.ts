import { and, desc, eq, or, sql } from 'drizzle-orm';
import { getEnv } from '../config.ts';
import { db } from '../db.ts';
import { auditLogs, users } from '../db/schema.ts';
import { alias } from 'drizzle-orm/pg-core';

const DEFAULT_RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastPruneAt: number | null = null;

export type AuditLogRecord = {
  id: string;
  action: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  targetUserId?: string | null;
  targetEmail?: string | null;
  targetName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditLogFilters = {
  tenantId: string;
  action?: string;
  userId?: string;
  limit?: number;
};

export type RecordAuditEventInput = {
  eventId?: string;
  tenantId: string;
  action: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

/** Transaction handle accepted by audit persistence operations. */
export type AuditLogTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordAuditEvent(input: RecordAuditEventInput) {
  await db.transaction((tx) => recordAuditEventInTransaction(tx, input));
  await pruneAuditLogsIfNeeded();
}

/** Persist an idempotent audit event inside the caller's transaction. */
export async function recordAuditEventInTransaction(
  tx: AuditLogTransaction,
  input: RecordAuditEventInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    id: input.eventId ?? crypto.randomUUID(),
    tenantId: input.tenantId,
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? {},
  }).onConflictDoNothing();
}

export async function listAuditEvents(filters: AuditLogFilters): Promise<AuditLogRecord[]> {
  const conditions = [eq(auditLogs.tenantId, filters.tenantId)];
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
  if (filters.userId) {
    const userCondition = or(
      eq(auditLogs.actorUserId, filters.userId),
      eq(auditLogs.targetUserId, filters.userId),
    );
    if (userCondition) conditions.push(userCondition);
  }

  const actor = alias(users, 'actor');
  const target = alias(users, 'target');

  const rows = await db.select({
    id: auditLogs.id,
    action: auditLogs.action,
    actorUserId: auditLogs.actorUserId,
    actorEmail: actor.email,
    actorName: actor.displayName,
    targetUserId: auditLogs.targetUserId,
    targetEmail: target.email,
    targetName: target.displayName,
    ipAddress: auditLogs.ipAddress,
    userAgent: auditLogs.userAgent,
    metadata: auditLogs.metadata,
    createdAt: auditLogs.createdAt,
  })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorUserId))
    .leftJoin(target, eq(target.id, auditLogs.targetUserId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(filters.limit ?? 200);

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actorUserId ?? null,
    actorEmail: row.actorEmail ?? null,
    actorName: row.actorName ?? null,
    targetUserId: row.targetUserId ?? null,
    targetEmail: row.targetEmail ?? null,
    targetName: row.targetName ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    metadata: typeof row.metadata === 'object' && row.metadata ? row.metadata : {},
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date(0).toISOString(),
  }));
}

async function pruneAuditLogsIfNeeded() {
  const retentionDays = Number(
    getEnv('QFLOW_AUDIT_RETENTION_DAYS') ?? DEFAULT_RETENTION_DAYS,
  );
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const now = Date.now();
  if (lastPruneAt && now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  await db.delete(auditLogs).where(
    sql`${auditLogs.createdAt} < now() - (${retentionDays} * interval '1 day')`,
  );
}
