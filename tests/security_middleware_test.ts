import { expect, test as testCase } from 'vitest';

import { finalizeResponse, resolveRequest } from '../lib/http/request_policy.ts';
import { parseLocaleCookie } from '../lib/i18n/locale.ts';

async function invokeMiddleware(req: Request, next: () => Promise<Response>) {
  const result = await resolveRequest({ req, url: new URL(req.url), runtime: {} });
  return finalizeResponse(
    new URL(req.url),
    result.kind === 'respond' ? result.response : await next(),
    parseLocaleCookie(req.headers.get('cookie')),
    result.locale,
  );
}

testCase('security middleware adds baseline headers for public pages', async () => {
  const req = new Request('http://example.test/login', { method: 'GET' });
  const res = await invokeMiddleware(
    req,
    () => Promise.resolve(new Response('ok', { status: 200 })),
  );

  expect(res.status).toStrictEqual(200);
  const csp = res.headers.get('content-security-policy');
  if (!(csp?.includes("default-src 'self'"))) {
    expect.unreachable('Expected csp?.includes("default-src \'self\'")');
  }
  if (!(csp?.includes("font-src 'self' data:"))) {
    expect.unreachable('Expected csp?.includes("font-src \'self\' data:")');
  }
  if (!(csp?.includes("style-src 'self' 'unsafe-inline'"))) {
    expect.unreachable("Expected csp?.includes(\"style-src 'self' 'unsafe-inline'\")");
  }
  if (!(csp?.includes("connect-src 'self'"))) {
    expect.unreachable('Expected csp?.includes("connect-src \'self\'")');
  }
  if (csp?.includes('fresh-island:')) {
    expect.unreachable("Expected !csp?.includes('fresh-island:')");
  }
  if (csp?.includes('https://fonts.googleapis.com')) {
    expect.unreachable("Expected !csp?.includes('https://fonts.googleapis.com')");
  }
  if (csp?.includes('https://fonts.gstatic.com')) {
    expect.unreachable("Expected !csp?.includes('https://fonts.gstatic.com')");
  }
  if (!(csp?.includes("frame-ancestors 'none'"))) {
    expect.unreachable('Expected csp?.includes("frame-ancestors \'none\'")');
  }
  expect(res.headers.get('x-content-type-options')).toStrictEqual('nosniff');
  expect(res.headers.get('referrer-policy')).toStrictEqual('strict-origin-when-cross-origin');
  expect(res.headers.get('x-frame-options')).toStrictEqual('DENY');
  expect(res.headers.get('strict-transport-security')).toStrictEqual(null);
});

testCase('security middleware allows unauthenticated health endpoint', async () => {
  let calledNext = false;
  const req = new Request('https://example.test/health', { method: 'GET' });
  const res = await invokeMiddleware(req, () => {
    calledNext = true;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  expect(calledNext).toStrictEqual(true);
  expect(res.status).toStrictEqual(200);
  if (!(res.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"))) {
    expect.unreachable(
      "Expected res.headers.get('content-security-policy')?.includes(\"frame-ancestors 'none'\")",
    );
  }
});

testCase('security middleware allows unauthenticated help pages', async () => {
  for (
    const path of ['/help/portability', '/help/qti-fidelity', '/help/qti-sample-report']
  ) {
    let calledNext = false;
    const req = new Request(`https://example.test${path}`, { method: 'GET' });
    const res = await invokeMiddleware(req, () => {
      calledNext = true;
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    expect(calledNext).toStrictEqual(true);
    expect(res.status).toStrictEqual(200);
  }
});

testCase('security middleware allows unauthenticated asset requests', async () => {
  let calledNext = false;
  const req = new Request('https://example.test/assets/client-entry.css?__frsh_c=1', {
    method: 'GET',
  });
  const res = await invokeMiddleware(req, () => {
    calledNext = true;
    return Promise.resolve(
      new Response('body { color: red; }', {
        status: 200,
        headers: { 'content-type': 'text/css; charset=utf-8' },
      }),
    );
  });

  expect(calledNext).toStrictEqual(true);
  expect(res.status).toStrictEqual(200);
  expect(res.headers.get('content-type')).toStrictEqual('text/css; charset=utf-8');
});

testCase('security middleware blocks cross-site settings writes', async () => {
  let calledNext = false;
  const req = new Request('https://example.test/settings/tenant', {
    method: 'POST',
    headers: {
      origin: 'https://attacker.test',
      'sec-fetch-site': 'cross-site',
    },
  });
  const res = await invokeMiddleware(req, () => {
    calledNext = true;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  expect(calledNext).toStrictEqual(false);
  expect(res.status).toStrictEqual(403);
  expect(await res.text()).toStrictEqual('CSRF check failed');
});

testCase('security middleware blocks cross-site CSRF on non-safe methods', async () => {
  let calledNext = false;
  const req = new Request('https://example.test/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'https://attacker.test',
      'sec-fetch-site': 'cross-site',
    },
  });
  const res = await invokeMiddleware(req, () => {
    calledNext = true;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  expect(calledNext).toStrictEqual(false);
  expect(res.status).toStrictEqual(403);
  expect(await res.text()).toStrictEqual('CSRF check failed');
});

testCase('security middleware allows same-origin non-safe methods', async () => {
  let calledNext = false;
  const req = new Request('https://example.test/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'https://example.test',
      'sec-fetch-site': 'same-origin',
    },
  });
  const res = await invokeMiddleware(req, () => {
    calledNext = true;
    return Promise.resolve(new Response('ok', { status: 201 }));
  });

  expect(calledNext).toStrictEqual(true);
  expect(res.status).toStrictEqual(201);
});

testCase('security middleware allows same-origin posts behind custom domains', async () => {
  let calledNext = false;
  const req = new Request('https://qflowlearn.com/login', {
    method: 'POST',
    headers: {
      origin: 'https://qflowlearn.com',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'untrusted-host.example.test',
    },
  });
  const res = await invokeMiddleware(req, () => {
    calledNext = true;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  expect(calledNext).toStrictEqual(true);
  expect(res.status).toStrictEqual(200);
});

testCase('reset screens use browser language even when a language cookie is present', async () => {
  for (const path of ['/password/forgot', '/password/reset?token=private-token']) {
    const req = new Request('https://example.test' + path, {
      headers: { cookie: 'qflow-locale=es-ES', 'accept-language': 'sv-SE, en;q=0.8' },
    });
    const result = await resolveRequest({ req, url: new URL(req.url), runtime: {} });
    expect(result.kind).toBe('continue');
    expect(result.locale).toBe('sv-SE');
  }
});

testCase('reset screens continue to reject opaque-origin and cross-site submissions', async () => {
  for (const path of ['/password/forgot', '/password/reset']) {
    for (
      const headers of [
        { origin: 'null', 'sec-fetch-site': 'same-origin' },
        { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' },
      ]
    ) {
      const req = new Request('https://example.test' + path, { method: 'POST', headers });
      const result = await resolveRequest({ req, url: new URL(req.url), runtime: {} });
      expect(result.kind).toBe('respond');
      if (result.kind !== 'respond') throw Error('Expected CSRF rejection.');
      expect(result.response.status).toBe(403);
    }
  }
});
