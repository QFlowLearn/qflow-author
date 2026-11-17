import { Hono } from 'hono';
import { expect, it } from 'vitest';
import {
  type RequestDiagnostic,
  requestDiagnostics,
  type RequestDiagnosticVariables,
} from '../lib/http/request_diagnostics.ts';

function observedApp() {
  const events: RequestDiagnostic[] = [];
  let sequence = 0;
  let time = 100;
  const app = new Hono<{ Variables: RequestDiagnosticVariables }>();
  app.use(
    '*',
    requestDiagnostics({
      nextId: () => `owned-request-${++sequence}`,
      now: () => {
        const current = time;
        time += 2.25;
        return current;
      },
      emit: (event) => {
        events.push(event);
      },
    }),
  );
  app.onError((_cause, c) => c.text('Request failed', 500));
  return { app, events };
}

it('correlates the response and route-template log without accepting caller IDs or recording content', async () => {
  const { app, events } = observedApp();
  app.get('/items/:id', (c) => c.json({ requestId: c.get('requestId') }));
  const response = await app.request('/items/private-item?token=private-token', {
    headers: {
      'x-request-id': 'private-client-id',
      authorization: 'Bearer private-credential',
      cookie: 'session=private-cookie',
    },
  });
  expect(await response.json()).toEqual({ requestId: 'owned-request-1' });
  expect(response.headers.get('x-request-id')).toBe('owned-request-1');
  expect(events).toEqual([{
    event: 'http_request',
    requestId: 'owned-request-1',
    method: 'GET',
    route: '/items/:id',
    status: 200,
    durationMs: 2.25,
  }]);
  for (
    const privateValue of [
      'private-item',
      'private-token',
      'private-client-id',
      'private-credential',
      'private-cookie',
    ]
  ) {
    expect(JSON.stringify(events)).not.toContain(privateValue);
  }
});

it('observes early middleware rejection with the registered endpoint pattern', async () => {
  const { app, events } = observedApp();
  app.use('/items/*', (c) => Promise.resolve(c.text('Denied', 403)));
  app.post('/items/:id/edit', (c) => c.text('Must not be reached'));
  const response = await app.request('/items/private-item/edit', {
    method: 'POST',
    body: 'private-content',
  });
  expect(response.status).toBe(403);
  expect(await response.text()).toBe('Denied');
  expect(response.headers.get('x-request-id')).toBe('owned-request-1');
  expect(events[0]).toMatchObject({ route: '/items/:id/edit', status: 403 });
  expect(JSON.stringify(events)).not.toContain('private-content');
});

it('logs a handled exception once using its safe classification and final response status', async () => {
  const { app, events } = observedApp();
  app.get('/broken/:id', () => {
    throw new TypeError('private-exception-message');
  });
  const response = await app.request('/broken/private-item');
  expect(response.status).toBe(500);
  expect(response.headers.get('x-request-id')).toBe('owned-request-1');
  expect(events).toEqual([{
    event: 'http_request_error',
    requestId: 'owned-request-1',
    method: 'GET',
    route: '/broken/:id',
    status: 500,
    durationMs: 2.25,
    cause: 'TypeError',
  }]);
  expect(JSON.stringify(events)).not.toContain('private-exception-message');
});

it('keeps correlation separate across concurrent requests including HEAD, redirects, 405 and unknown paths', async () => {
  const { app, events } = observedApp();
  app.get('/items/:id', async (c) => {
    await Promise.resolve();
    return c.text('ready');
  });
  app.all('/items/:id', (c) => c.text('Method not allowed', 405, { allow: 'GET, HEAD' }));
  app.get('/redirect', (c) => c.redirect('/items/known'));
  const responses = await Promise.all([
    app.request('/items/private-first'),
    app.request('/items/private-second', { method: 'HEAD' }),
    app.request('/items/private-third', { method: 'POST' }),
    app.request('/redirect'),
    app.request('/unknown-private-path?query=private-value', { method: 'PRIVATE_METHOD' }),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200, 405, 302, 404]);
  const ids = responses.map((response) => response.headers.get('x-request-id'));
  expect(new Set(ids).size).toBe(5);
  expect(events).toHaveLength(5);
  for (const [index, response] of responses.entries()) {
    expect(events.find((event) => event.requestId === ids[index])?.status).toBe(response.status);
    await response.body?.cancel();
  }
  expect(events.find((event) => event.status === 404)).toMatchObject({
    route: null,
    method: 'OTHER',
  });
  expect(events.find((event) => event.method === 'HEAD')?.route).toBe('/items/:id');
  expect(JSON.stringify(events)).not.toContain('private-');
  expect(JSON.stringify(events)).not.toContain('PRIVATE_METHOD');
});
