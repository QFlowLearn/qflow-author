import { defineHttpRoute } from '../../route.ts';

import {
  completeCanvasAuthorization,
  consumeCanvasAuthorizationState,
} from '../../../lms/canvas_connections.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Completes Canvas OAuth and stores the user's encrypted refresh grant. */
export const canvasCallbackAuthRoute = defineHttpRoute('/auth/canvas/callback', {
  '*': async (ctx) => {
    if (ctx.req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    const auth = requireAuthContext(ctx.state);
    const stateToken = ctx.url.searchParams.get('state') ?? '';
    const consumed = await consumeCanvasAuthorizationState(auth, stateToken, ctx);
    if (!consumed.ok) {
      return redirectToSettings(
        ctx.url.origin,
        consumed.error._tag === 'CanvasPersistenceUnavailable'
          ? 'persistence-unavailable'
          : 'state-invalid',
      );
    }
    const state = consumed.value;
    const providerError = ctx.url.searchParams.get('error');
    const code = ctx.url.searchParams.get('code') ?? '';
    if (providerError || !code) return redirectToSettings(ctx.url.origin, 'authorization-declined');
    const redirectUri = new URL('/auth/canvas/callback', ctx.url.origin).toString();
    const result = await completeCanvasAuthorization(auth, state, code, redirectUri, ctx, {
      signal: ctx.req.signal,
    });
    if (!result.ok) {
      const error = result.error._tag === 'CanvasPersistenceUnavailable'
        ? 'persistence-unavailable'
        : result.error._tag === 'CanvasConfigurationInvalid'
        ? 'configuration-invalid'
        : result.error._tag === 'CanvasConnectionNotFound'
        ? 'authorization-unavailable'
        : 'authorization-failed';
      return redirectToSettings(ctx.url.origin, error);
    }
    const url = new URL(state.returnPath, ctx.url.origin);
    url.searchParams.set('connected', '1');
    return new Response(null, {
      status: 303,
      headers: {
        location: url.pathname + url.search,
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
