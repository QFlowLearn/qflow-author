import type { Role } from './roles.ts';

export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export type RequestContext = {
  tenantId: string;
  userId: string;
  role: Role;
};

/** Tenant-scoped identity for background workers acting on behalf of a user. */
export type WorkerContext = {
  readonly tenantId: string;
  readonly userId: string;
};

/** Build one worker context without inventing a request role. */
export function workerContext(tenantId: string, userId: string): WorkerContext {
  return { tenantId, userId };
}

export function resolveUserId(ctx: RequestContext): string {
  if (!ctx.userId) throw new Error('User id is required for this action.');
  return ctx.userId;
}

export function requireAuthContext(state: unknown): RequestContext {
  if (!state || typeof state !== 'object') throw new Error('Auth context is not set.');
  const auth = (state as { auth?: RequestContext }).auth;
  if (!auth) throw new Error('Auth context is not set.');
  return auth;
}
