import { defineHttpRoute } from '../../route.ts';

import {
  beginCanvasAuthorization,
  parseCanvasConnectionId,
} from '../../../lms/canvas_connections.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Starts Canvas OAuth for the authenticated workspace member. */
export const canvasStartAuthRoute = defineHttpRoute('/auth/canvas/:id', {
  '*': async (ctx) => {
    if (ctx.req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    const auth = requireAuthContext(ctx.state);
    const connectionId = parseCanvasConnectionId(ctx.params.id);
    if (!connectionId) return new Response('Not Found', { status: 404 });
    const redirectUri = new URL('/auth/canvas/callback', ctx.url.origin).toString();
    const result = await beginCanvasAuthorization(auth, connectionId, redirectUri, ctx);
    if (!result.ok) {
      const error = result.error._tag === 'CanvasPersistenceUnavailable'
        ? 'persistence-unavailable'
        : 'authorization-unavailable';
      return redirectToSettings(ctx.url.origin, error);
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: result.authorizationUrl,
        'cache-control': 'private, no-store',
      },
    });
  },
});

function redirectToSettings(origin: string, error: string): Response {
  const url = new URL('/settings/canvas', origin);
  url.searchParams.set('error', error);
  return new Response(null, {
    status: 303,
    headers: { location: url.pathname + url.search },
  });
}
