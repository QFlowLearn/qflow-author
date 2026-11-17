import { startFetchServer } from './fetch_server.ts';
import type { QflowRuntime } from '../../lib/runtime.ts';
import type { ObjectStorage } from '../../lib/storage_contract.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { canvasConnectionsApiRoute as connectionsHandlerEndpoint } from '../../lib/http/routes/canvas_api/connections.ts';
import { createCanvasPublishHandler } from '../../lib/http/routes/assessment_api/publish_canvas.ts';
import { canvasPublishesApiRoute as listHandlerEndpoint } from '../../lib/http/routes/assessment_api/canvas_publishes.ts';
import { canvasPublishResumeApiRoute as resumeHandlerEndpoint } from '../../lib/http/routes/assessment_api/canvas_publish_resume.ts';
import { canvasPublishResolveIdentityApiRoute as resolveHandlerEndpoint } from '../../lib/http/routes/assessment_api/canvas_publish_resolve_identity.ts';
import { invokeHttpRoute, makeHttpRequest } from './http_route.ts';

const connectionsHandler = connectionsHandlerEndpoint.handle;
const listHandler = listHandlerEndpoint.handle;
const resumeHandler = resumeHandlerEndpoint.handle;
const resolveHandler = resolveHandlerEndpoint.handle;

/**
 * Serve real Canvas publish HTTP handlers against the caller's seeded PostgreSQL workspace.
 * Auth is supplied at the existing handler seam; middleware/auth coverage remains in its owners.
 * Only the outbound third-party Canvas transport is controlled by the caller.
 */
export async function openCanvasPublishHttp(input: {
  readonly auth: RequestContext;
  readonly assessmentId: string;
  readonly storage: ObjectStorage;
  readonly runtime: QflowRuntime;
  readonly canvasFetch: typeof fetch;
}) {
  const createHandler = createCanvasPublishHandler({ fetchImpl: input.canvasFetch });
  const prefix = `/api/assessments/${encodeURIComponent(input.assessmentId)}`;
  const server = await startFetchServer((request) => {
    const path = new URL(request.url).pathname;
    const attempt = path.startsWith(`${prefix}/canvas-publishes/`)
      ? path.slice(`${prefix}/canvas-publishes/`.length).split('/')
      : [];
    const handler = path === '/api/canvas/connections'
      ? connectionsHandler
      : path === `${prefix}/publish/canvas`
      ? createHandler
      : path === `${prefix}/canvas-publishes`
      ? listHandler
      : attempt.length === 2 && attempt[1] === 'resume'
      ? resumeHandler
      : attempt.length === 2 && attempt[1] === 'resolve-remote-identity'
      ? resolveHandler
      : null;
    if (!handler) return new Response(null, { status: 404 });
    return invokeHttpRoute(
      handler,
      makeHttpRequest(request, {
        params: { id: input.assessmentId, publishId: attempt[0] ?? '' },
        auth: input.auth,
        state: { storage: input.storage, runtime: input.runtime },
      }),
    );
  });
  const origin = `http://${'127.0.0.1'}:${server.port}`;
  const fetchImpl: typeof fetch = (request, init) => {
    const url = new URL(String(request), origin);
    if (url.origin !== origin) {
      throw new Error('Canvas client must use the owned local HTTP fixture.');
    }
    return fetch(url, init);
  };
  return { origin, fetchImpl, close: () => server.close() };
}
