import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { oidcLoginStates, tenants } from '../lib/db/schema.ts';
import { consumeOidcLoginState, createOidcLoginState } from '../lib/services/oidc.ts';

testCase('OIDC login state can be consumed exactly once under concurrency', async () => {
  const tenantId = crypto.randomUUID();
  await db.insert(tenants).values({
    id: tenantId,
    slug: `oidc-state-${tenantId.slice(0, 8)}`,
    name: 'OIDC State Test',
  });
  const loginState = await createOidcLoginState({
    tenantId,
    provider: 'google',
    redirectPath: '/dashboard',
  });

  try {
    const results = await Promise.all([
      consumeOidcLoginState(loginState.state),
      consumeOidcLoginState(loginState.state),
    ]);

    expect(results.filter((result) => result !== null).length).toStrictEqual(1);
    expect(results.filter((result) => result === null).length).toStrictEqual(1);
    expect(results.find((result) => result !== null)?.redirectPath).toStrictEqual('/dashboard');
  } finally {
    await db.delete(oidcLoginStates).where(eq(oidcLoginStates.state, loginState.state)).catch(
      () => {},
    );
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
    await shutdownDb().catch(() => {});
  }
});
