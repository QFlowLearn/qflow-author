import { hasCapability, parseRole } from '../roles.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import { and, eq } from 'drizzle-orm';
import { getEnv } from '../config.ts';
import { db, type QflowDatabase } from '../db.ts';
import { organizationMemberships, tenantDomains, tenants } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';

export type TenantSettings = {
  name: string;
  slug: string;
  bankDisplayName: string | null;
};

export async function getTenantSettings(auth: RequestContext): Promise<TenantSettings | null> {
  const rows = await db.select({
    name: tenants.name,
    bankDisplayName: tenants.bankDisplayName,
    slug: tenants.slug,
  }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
  return rows[0] ?? null;
}

export async function updateTenantName(auth: RequestContext, name: string): Promise<void> {
  await db.update(tenants).set({ name }).where(eq(tenants.id, auth.tenantId));
}

export async function resolveTenantIdForHost(hostname: string): Promise<string | null> {
  const normalized = String(hostname || '').toLowerCase();
  if (!normalized) return null;

  const domainRows = await db.select({ tenantId: tenantDomains.tenantId })
    .from(tenantDomains)
    .where(eq(tenantDomains.domain, normalized))
    .limit(1);
  if (domainRows.length) return domainRows[0].tenantId;

  const root = (getEnv('QFLOW_ROOT_DOMAIN') ?? '').toLowerCase();
  if (root && (normalized === root || normalized.endsWith(`.${root}`))) {
    if (normalized === root) return null;
    const slug = normalized.slice(0, -(root.length + 1));
    if (!slug) return null;
    const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  return null;
}

/** Validate the optional display name; null explicitly means no custom bank label. */
export function parseBankDisplayName(
  input: unknown,
): { readonly ok: true; readonly name: string | null } | { readonly ok: false } {
  if (typeof input !== 'string' || input.trim().length > 160) return { ok: false };
  return { ok: true, name: input.trim() || null };
}

/** Change workspace bank presentation under the same tenant lock as membership revocation. */
export async function updateBankDisplayName(
  ctx: RequestContext,
  input: unknown,
  database: QflowDatabase = db,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly code: 'invalid_name' | 'forbidden' }
> {
  const parsed = parseBankDisplayName(input);
  if (!parsed.ok) return { ok: false, code: 'invalid_name' };
  return await database.transaction(async (tx) => {
    const tenant = await tx.select({ bankDisplayName: tenants.bankDisplayName }).from(tenants)
      .where(
        eq(tenants.id, ctx.tenantId),
      ).for('update');
    if (!tenant.length) return { ok: false, code: 'forbidden' };
    const member = await tx.select({ role: organizationMemberships.role }).from(
      organizationMemberships,
    )
      .where(
        and(
          eq(organizationMemberships.tenantId, ctx.tenantId),
          eq(organizationMemberships.userId, ctx.userId),
        ),
      );
    const role = parseRole(member[0]?.role);
    if (!role || !hasCapability(role, 'manage_workspace')) return { ok: false, code: 'forbidden' };
    if (tenant[0].bankDisplayName === parsed.name) return { ok: true };
    await tx.update(tenants).set({ bankDisplayName: parsed.name }).where(
      eq(tenants.id, ctx.tenantId),
    );
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'question_bank.display_name_changed',
      metadata: { previousName: tenant[0].bankDisplayName, name: parsed.name },
    });
    return { ok: true };
  });
}
