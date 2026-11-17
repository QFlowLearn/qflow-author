import { encodeBase64Url } from '../lib/base64.ts';
import { encryptCredential } from '../lib/credential_cipher.ts';
import { db } from '../lib/db.ts';
import { oidcTenantConfigs } from '../lib/db/schema.ts';
import type { OidcProviderId } from '../lib/oidc_provider.ts';
import { redact } from '../lib/redacted.ts';

/** Runtime with a deterministic credential key reserved for OIDC tests. */
export function oidcTestRuntime() {
  return {
    bindings: {
      QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: encodeBase64Url(new Uint8Array(32).fill(13)),
    },
  };
}

/** Insert one OIDC provider with a correctly bound encrypted client secret. */
export async function seedOidcConfig(input: {
  readonly tenantId: string;
  readonly provider: OidcProviderId;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly enabled?: boolean;
  readonly microsoftTenant?: string | null;
}): Promise<void> {
  const encryptedClientSecret = await encryptCredential(
    oidcTestRuntime(),
    redact(input.clientSecret),
    {
      purpose: 'oidc-client-secret',
      tenantId: input.tenantId,
      provider: input.provider,
    },
  );
  await db.insert(oidcTenantConfigs).values({
    tenantId: input.tenantId,
    provider: input.provider,
    enabled: input.enabled ?? true,
    clientId: input.clientId,
    encryptedClientSecret,
    microsoftTenant: input.microsoftTenant,
  });
}
