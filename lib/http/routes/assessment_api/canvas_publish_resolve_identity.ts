import { defineHttpRoute } from '../../route.ts';

import { parseCanvasPublishId } from '../../../lms/canvas_publish_contract.ts';
import {
  canvasPublishView,
  parseCanvasRemoteIdentityResolutionRequest,
} from '../../../lms/canvas_publish_http.ts';
import { resolveCanvasRemoteIdentity } from '../../../lms/canvas_publish_transition_store.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const canvasPublishResolveIdentityApiRoute = defineHttpRoute(
  '/api/assessments/:id/canvas-publishes/:publishId/resolve-remote-identity',
  {
    '*': async (ctx) => {
      if (ctx.req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const publishId = parseCanvasPublishId(ctx.params.publishId);
      const decision = await parseCanvasRemoteIdentityResolutionRequest(ctx.req);
      if (!publishId || !decision) {
        return Response.json(
          {
            error: 'CanvasRemoteIdentityResolutionInvalid',
            message: 'Record whether you found this import in Canvas.',
          },
          { status: 400, headers: { 'cache-control': 'private, no-store' } },
        );
      }
      const result = await resolveCanvasRemoteIdentity(
        requireAuthContext(ctx.state),
        {
          assessmentId: ctx.params.id,
          publishId,
          outcome: decision.outcome,
          resolvedAt: new Date(),
        },
        ctx,
      );
      if (!result.ok) {
        const status = result.error._tag === 'CanvasPublishNotFound'
          ? 404
          : result.error._tag === 'CanvasRemoteIdentityNotOpen'
          ? 409
          : 503;
        return Response.json(
          { error: result.error._tag, message: result.error.message },
          { status, headers: { 'cache-control': 'private, no-store' } },
        );
      }
      return Response.json(
        { publish: canvasPublishView(result.attempt, ctx.url.origin) },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    },
  },
);
