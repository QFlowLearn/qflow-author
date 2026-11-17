import { expect, test as testCase } from 'vitest';

import { Hono } from 'hono';

testCase(
  'Hono uses the ingress request URL without trusting caller-supplied forwarding headers',
  async () => {
    const app = new Hono().get('/origin', (ctx) => {
      const url = new URL(ctx.req.url);
      return Response.json({
        origin: url.origin,
        href: url.href,
        protocol: url.protocol,
        host: url.host,
      });
    });

    const res = await app.fetch(
      new Request('http://internal.local/origin', {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'qflowlearn.com',
        },
      }),
    );

    expect(await res.json()).toStrictEqual({
      origin: 'http://internal.local',
      href: 'http://internal.local/origin',
      protocol: 'http:',
      host: 'internal.local',
    });
  },
);
