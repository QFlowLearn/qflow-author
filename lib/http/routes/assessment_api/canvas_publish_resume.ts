import { defineHttpRoute } from '../../route.ts';

import { parseCanvasPublishId } from '../../../lms/canvas_publish_contract.ts';
import { canvasPublishHttpStatus, canvasPublishView } from '../../../lms/canvas_publish_http.ts';
import { advanceCanvasPublish } from '../../../lms/canvas_publish_service.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const canvasPublishResumeApiRoute = defineHttpRoute(
  '/api/assessments/:id/canvas-publishes/:publishId/resume',
  {
    '*': async (ctx) => {
      if (ctx.req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const publishId = parseCanvasPublishId(ctx.params.publishId);
      if (!publishId) {
        return Response.json(
          { error: 'CanvasPublishIdInvalid', message: 'The Canvas publish ID is invalid.' },
          { status: 400 },
        );
      }
      const result = await advanceCanvasPublish(requireAuthContext(ctx.state), {
        assessmentId: ctx.params.id,
        publishId,
        storage: resolveStorage(ctx),
        runtime: ctx,
      }, { signal: ctx.req.signal });
      if (!result.ok) {
        const status = result.error._tag === 'CanvasPublishNotFound' ? 404 : 503;
        return Response.json(
          { error: result.error._tag, message: result.error.message },
          { status },
        );
      }
      return Response.json(
        { publish: canvasPublishView(result.attempt, ctx.url.origin) },
        {
          status: canvasPublishHttpStatus(result.attempt.state),
          headers: { 'cache-control': 'private, no-store' },
        },
      );
    },
  },
);
