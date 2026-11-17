import { defineHttpRoute } from '../../route.ts';

import { parseCanvasPublishId } from '../../../lms/canvas_publish_contract.ts';
import { canvasPublishView } from '../../../lms/canvas_publish_http.ts';
import { findCanvasPublishAttempt } from '../../../lms/canvas_publish_store.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const canvasPublishApiRoute = defineHttpRoute(
  '/api/assessments/:id/canvas-publishes/:publishId',
  {
    '*': async (ctx) => {
      if (ctx.req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      const publishId = parseCanvasPublishId(ctx.params.publishId);
      if (!publishId) {
        return Response.json(
          { error: 'CanvasPublishIdInvalid', message: 'The Canvas publish ID is invalid.' },
          { status: 400 },
        );
      }
      const found = await findCanvasPublishAttempt(
        requireAuthContext(ctx.state),
        ctx.params.id,
        publishId,
        ctx,
      );
      if (!found.ok) {
        const status = found.error._tag === 'CanvasPublishNotFound' ? 404 : 503;
        return Response.json(
          {
            error: found.error._tag,
            message: status === 404
              ? 'Canvas publish not found.'
              : 'QFlowLearn could not load Canvas publish status.',
          },
          { status },
        );
      }
      return Response.json(
        { publish: canvasPublishView(found.attempt, ctx.url.origin) },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    },
  },
);
