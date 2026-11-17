import { parseRole, type Role } from '../roles.ts';

/** Account information consumed by the browser menu after HTTP parsing. */
export type AccountPayload = {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
  };
  readonly tenant: { readonly id: string; readonly slug: string; readonly name: string };
  readonly role: Role;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Refine the authenticated account response before rendering user-controlled labels. */
export function parseAccountPayload(value: unknown): AccountPayload | null {
  if (!record(value) || !record(value.user) || !record(value.tenant)) return null;
  const { user, tenant } = value;
  if (typeof value.role !== 'string') return null;
  const role = parseRole(value.role);
  if (
    !role || typeof user.id !== 'string' || typeof user.email !== 'string' ||
    (user.displayName !== null && typeof user.displayName !== 'string') ||
    typeof tenant.id !== 'string' || typeof tenant.slug !== 'string' ||
    typeof tenant.name !== 'string'
  ) return null;
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    role,
  };
}
