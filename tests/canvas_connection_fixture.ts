import { eq } from 'drizzle-orm';

import { encodeBase64Url } from '../lib/base64.ts';
import { encryptCredential } from '../lib/credential_cipher.ts';
import { db } from '../lib/db.ts';
import { canvasConnections, canvasUserGrants } from '../lib/db/schema.ts';
import { parseCanvasConnectionId } from '../lib/lms/canvas_connections.ts';
import { redact } from '../lib/redacted.ts';
import type { RequestContext } from '../lib/tenants.ts';

export const TEST_CANVAS_CONNECTION_ID = '8fdcd9d7-3cb3-4f7e-8c92-31bd3272fda0';

export function canvasTestRuntime() {
  return {
    bindings: {
      QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: testEncryptionKey(),
    },
  };
}

export async function seedCanvasConnectionFixture(
  auth: RequestContext,
  runtime: ReturnType<typeof canvasTestRuntime>,
) {
  const connectionId = parseCanvasConnectionId(TEST_CANVAS_CONNECTION_ID);
  if (!connectionId) throw new Error('Expected valid test connection ID.');
  const encryptedClientSecret = await encryptCredential(runtime, redact('test-client-secret'), {
    purpose: 'canvas-client-secret',
    tenantId: auth.tenantId,
    connectionId,
  });
  const encryptedRefreshToken = await encryptCredential(runtime, redact('test-refresh-token'), {
    purpose: 'canvas-refresh-token',
    tenantId: auth.tenantId,
    connectionId,
    userId: auth.userId,
  });
  await db.insert(canvasConnections).values({
    id: connectionId,
    tenantId: auth.tenantId,
    name: 'Canvas production',
    baseUrl: 'https://canvas.example.edu',
    clientId: 'test-client-id',
    encryptedClientSecret,
    credentialVersion: 1,
    lifecycleState: 'active',
    createdBy: auth.userId,
  });
  await db.insert(canvasUserGrants).values({
    connectionId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    encryptedRefreshToken,
    canvasUserId: '7',
    authorizedAt: new Date(),
  });
}

export async function deleteCanvasConnectionFixture(tenantId: string): Promise<void> {
  await db.delete(canvasConnections).where(eq(canvasConnections.tenantId, tenantId));
}

export function authorizedCanvasFetch(accessToken: string, next: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = String(input);
    if (url.endsWith('/login/oauth2/token')) {
      return Promise.resolve(Response.json({ access_token: accessToken, token_type: 'Bearer' }));
    }
    return next(input, init);
  };
}

function testEncryptionKey(): string {
  return encodeBase64Url(new Uint8Array(32).fill(7));
}
