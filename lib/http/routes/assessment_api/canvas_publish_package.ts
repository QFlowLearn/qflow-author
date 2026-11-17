import { defineHttpRoute } from '../../route.ts';

import { streamMaterializedAssessmentExportArtifact } from '../../../export/assessment_export_artifact.ts';
import { attachmentContentDisposition } from '../../attachment_content_disposition.ts';
import { parseCanvasPublishId } from '../../../lms/canvas_publish_contract.ts';
import { findCanvasPublishAttempt } from '../../../lms/canvas_publish_store.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const canvasPublishPackageApiRoute = defineHttpRoute(
  '/api/assessments/:id/canvas-publishes/:publishId/package',
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
      if (!found.ok) {
        return new Response('Not Found', {
          status: found.error._tag === 'CanvasPublishNotFound' ? 404 : 503,
        });
      }
      const artifact = await streamMaterializedAssessmentExportArtifact(
        resolveStorage(ctx),
        found.attempt.artifact,
      );
      if (!artifact.ok) {
        console.error(JSON.stringify({
          event: 'canvas_publish_package_read_failed',
          assessmentId: ctx.params.id,
          publishId,
          errorTag: artifact.error._tag,
        }));
        return Response.json(
          { error: artifact.error._tag, message: artifact.error.message },
          { status: 503 },
        );
      }
      return new Response(artifact.value.body, {
        headers: {
          'content-type': found.attempt.artifact.mediaType,
          'content-length': String(found.attempt.artifact.byteLength),
          'content-disposition': attachmentContentDisposition(found.attempt.artifact.filename),
          'cache-control': 'private, immutable',
          'x-qflow-canvas-publish-id': found.attempt.id,
          'x-qflow-export-receipt-id': found.attempt.exportReceiptId,
          'x-qflow-artifact-sha256': found.attempt.artifact.sha256,
        },
      });
    },
  },
);
