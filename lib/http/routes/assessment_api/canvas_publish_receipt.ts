import { defineHttpRoute } from '../../route.ts';

import { attachmentContentDisposition } from '../../attachment_content_disposition.ts';
import { parseCanvasPublishId } from '../../../lms/canvas_publish_contract.ts';
import { findCanvasPublishAttempt } from '../../../lms/canvas_publish_store.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const canvasPublishReceiptApiRoute = defineHttpRoute(
  '/api/assessments/:id/canvas-publishes/:publishId/receipt',
  {
    '*': async (ctx) => {
      if (ctx.req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      const publishId = parseCanvasPublishId(ctx.params.publishId);
      if (!publishId) return new Response('Not Found', { status: 404 });
      const found = await findCanvasPublishAttempt(
        requireAuthContext(ctx.state),
        ctx.params.id,
        publishId,
        ctx,
      );
      if (!found.ok || found.attempt.state._tag !== 'Published') {
        return new Response('Not Found', {
          status: !found.ok && found.error._tag !== 'CanvasPublishNotFound' ? 503 : 404,
        });
      }
      return new Response(JSON.stringify(found.attempt.state.receipt), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': attachmentContentDisposition(`canvas-publish-${publishId}.json`),
          'cache-control': 'private, immutable',
        },
      });
    },
  },
);
