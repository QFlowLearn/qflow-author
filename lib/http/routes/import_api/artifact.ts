import { defineHttpRoute, type HttpRequest } from '../../route.ts';

import { attachmentContentDisposition } from '../../attachment_content_disposition.ts';
import { getMigrationRun } from '../../../import/migration_run_queries.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const artifactImportRoute = defineHttpRoute('/imports/:id/artifacts/:artifactId', {
  'GET': handle,
});

async function handle(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const run = await getMigrationRun(auth, ctx.params.id);
  if (!run) return new Response('Not Found', { status: 404 });
  const artifact = run.artifacts.find((entry) => entry.id === ctx.params.artifactId);
  if (!artifact) return new Response('Not Found', { status: 404 });
  const bytes = await resolveStorage(ctx.runtime).readObject(artifact.storageKey);
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body.buffer, {
    headers: {
      'content-type': artifact.mimeType,
      'content-length': String(bytes.byteLength),
      'content-disposition': attachmentContentDisposition(artifact.filename),
      'x-content-type-options': 'nosniff',
    },
  });
}
