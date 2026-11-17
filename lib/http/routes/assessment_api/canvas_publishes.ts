import { defineHttpRoute } from '../../route.ts';

import {
  formatCanvasPublishTerminalCursor,
  parseCanvasPublishTerminalCursor,
} from '../../../lms/canvas_publish_contract.ts';
import { canvasPublishView } from '../../../lms/canvas_publish_http.ts';
import { listCanvasPublishAttempts } from '../../../lms/canvas_publish_store.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const canvasPublishesApiRoute = defineHttpRoute(
  '/api/assessments/:id/canvas-publishes',
  {
    '*': async (ctx) => {
      if (ctx.req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      const targetId = ctx.url.searchParams.get('target');
      if (targetId !== 'canvas-classic' && targetId !== 'canvas-new-quizzes') {
        return Response.json(
          {
            error: 'CanvasPublishTargetInvalid',
            message: 'Select the Canvas export target whose publishes you want to load.',
          },
          { status: 400, headers: { 'cache-control': 'private, no-store' } },
        );
      }
      const terminalCursorInput = ctx.url.searchParams.get('terminalCursor');
      const terminalCursor = terminalCursorInput === null
        ? null
        : parseCanvasPublishTerminalCursor(terminalCursorInput);
      if (terminalCursorInput !== null && terminalCursor === null) {
        return Response.json(
          {
            error: 'CanvasPublishCursorInvalid',
            message: 'Reload Canvas publish history before you load earlier results.',
          },
          { status: 400, headers: { 'cache-control': 'private, no-store' } },
        );
      }
      const result = await listCanvasPublishAttempts(
        requireAuthContext(ctx.state),
        ctx.params.id,
        targetId,
        { terminalCursor, runtime: ctx },
      );
      if (!result.ok) {
        console.error(JSON.stringify({
          event: 'canvas_publish_list_failed',
          assessmentId: ctx.params.id,
          errorTag: result.error._tag,
        }));
        return Response.json(
          {
            error: result.error._tag,
            message: 'QFlowLearn could not load Canvas publishes.',
          },
          { status: 503, headers: { 'cache-control': 'private, no-store' } },
        );
      }
      return Response.json(
        {
          actionRequired: result.actionRequired.map((attempt) =>
            canvasPublishView(attempt, ctx.url.origin)
          ),
          terminal: result.terminal.map((attempt) => canvasPublishView(attempt, ctx.url.origin)),
          nextTerminalCursor: result.nextTerminalCursor === null
            ? null
            : formatCanvasPublishTerminalCursor(result.nextTerminalCursor),
        },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    },
  },
);
