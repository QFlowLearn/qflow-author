import { expect, test as testCase } from 'vitest';

import { buildSessionClearCookie, buildSessionCookie } from '../lib/http/cookies.ts';

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

testCase('session cookies include hardened defaults', () => {
  const previousSecure = process.env['QFLOW_SECURE_COOKIES'];
  try {
    delete process.env['QFLOW_SECURE_COOKIES'];
    const url = new URL('http://example.test/');
    const expiresAt = new Date(Date.now() + 60_000);

    const cookie = buildSessionCookie(url, 'token-123', expiresAt);
    if (!(cookie.includes('HttpOnly'))) expect.unreachable("Expected cookie.includes('HttpOnly')");
    if (!(cookie.includes('SameSite=Lax'))) {
      expect.unreachable("Expected cookie.includes('SameSite=Lax')");
    }
    if (!(cookie.includes('Priority=High'))) {
      expect.unreachable("Expected cookie.includes('Priority=High')");
    }
    if (cookie.includes('Secure')) expect.unreachable("Expected !cookie.includes('Secure')");

    const clear = buildSessionClearCookie(url);
    if (!(clear.includes('HttpOnly'))) expect.unreachable("Expected clear.includes('HttpOnly')");
    if (!(clear.includes('SameSite=Lax'))) {
      expect.unreachable("Expected clear.includes('SameSite=Lax')");
    }
    if (!(clear.includes('Priority=High'))) {
      expect.unreachable("Expected clear.includes('Priority=High')");
    }
  } finally {
    restoreEnv('QFLOW_SECURE_COOKIES', previousSecure);
  }
});

testCase('session cookies are secure for Fresh trusted HTTPS URLs', () => {
  const previousSecure = process.env['QFLOW_SECURE_COOKIES'];
  try {
    delete process.env['QFLOW_SECURE_COOKIES'];
    const url = new URL('https://qflowlearn.com/');
    const expiresAt = new Date(Date.now() + 60_000);
    const cookie = buildSessionCookie(url, 'token-123', expiresAt);
    if (!(cookie.includes('Secure'))) expect.unreachable("Expected cookie.includes('Secure')");
  } finally {
    restoreEnv('QFLOW_SECURE_COOKIES', previousSecure);
  }
});

testCase('session cookie security can be explicitly forced', () => {
  const previousSecure = process.env['QFLOW_SECURE_COOKIES'];
  try {
    process.env['QFLOW_SECURE_COOKIES'] = 'true';
    const url = new URL('http://example.test/');
    const expiresAt = new Date(Date.now() + 60_000);
    const cookie = buildSessionCookie(url, 'token-123', expiresAt);
    if (!(cookie.includes('Secure'))) expect.unreachable("Expected cookie.includes('Secure')");
  } finally {
    restoreEnv('QFLOW_SECURE_COOKIES', previousSecure);
  }
});
