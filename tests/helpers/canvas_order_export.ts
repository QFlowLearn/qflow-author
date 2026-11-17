import { expect } from 'vitest';

import { unzipSync } from 'fflate';
import { validateApiRoute as validateEndpoint } from '../../lib/http/routes/assessment_api/validate.ts';
import { packageApiRoute as packageRouteEndpoint } from '../../lib/http/routes/assessment_api/package.ts';
import { invokeHttpRoute, makeHttpRequest } from './http_route.ts';
import { createMemoryObjectStorage } from '../memory_object_storage.ts';
import type { RequestContext } from '../../lib/tenants.ts';

const validate = validateEndpoint.handle;
const packageRoute = packageRouteEndpoint.handle;

export async function verifyCanvasOrderExport(ctx: RequestContext, id: string, itemIds: string[]) {
  const storage = createMemoryObjectStorage();
  const query = new URLSearchParams({
    target: 'qti3-conformant',
    scoring: 'automatic',
    interaction: 'preserve',
  });
  const response = await invokeHttpRoute(
    validate,
    makeHttpRequest(new Request(`http://local/api/assessments/${id}/validate?${query}`), {
      params: { id },
      auth: ctx,
      state: { storage },
    }),
  );
  expect(response.status).toStrictEqual(200);
  const payload: unknown = await response.json();
  if (!(payload && typeof payload === 'object' && 'preflight' in payload)) {
    expect.unreachable("Expected payload && typeof payload === 'object' && 'preflight' in payload");
  }
  const preflight = payload.preflight;
  if (
    !(preflight && typeof preflight === 'object' && 'preflightId' in preflight &&
      typeof preflight.preflightId === 'string')
  ) {
    expect.unreachable(
      "Expected preflight && typeof preflight === 'object' && 'preflightId' in preflight && typeof preflig",
    );
  }
  query.set('preflightId', preflight.preflightId);
  if ('acknowledgementToken' in preflight && typeof preflight.acknowledgementToken === 'string') {
    query.set('acknowledgement', preflight.acknowledgementToken);
  }
  const packaged = await invokeHttpRoute(
    packageRoute,
    makeHttpRequest(new Request(`http://local/api/assessments/${id}/package?${query}`), {
      params: { id },
      auth: ctx,
      state: { storage },
    }),
  );
  expect(packaged.status).toStrictEqual(200);
  const files = unzipSync(new Uint8Array(await packaged.arrayBuffer()));
  const xml = new TextDecoder().decode(files['assessment.xml']);
  expect(xml).toContain('submission-mode="simultaneous"');
  expect(xml).toContain('max-time="300"');
  expect([...xml.matchAll(/href="items\/([^"]+)\.xml"/g)].map((match) => match[1])).toStrictEqual(
    itemIds,
  );
  for (const itemId of itemIds) {
    if (!(files[`items/${itemId}.xml`])) {
      expect.unreachable('Expected files[`items/${itemId}.xml`]');
    }
  }
}
