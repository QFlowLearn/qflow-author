import { defineHttpRoute } from '../../route.ts';

import { listCanvasConnections } from '../../../lms/canvas_connections.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const canvasConnectionsApiRoute = defineHttpRoute('/api/canvas/connections', {
  '*': async (ctx) => {
    if (ctx.req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    const auth = requireAuthContext(ctx.state);
    const result = await listCanvasConnections(auth, ctx);
    if (!result.ok) {
      console.error(JSON.stringify({
        event: 'canvas_connections_load_failed',
        errorTag: result.error._tag,
      }));
      return Response.json(
        {
          error: result.error._tag,
          message: 'QFlowLearn could not load Canvas connections.',
        },
        { status: 503 },
      );
    }
    return Response.json(
      { connections: result.value },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  },
});
