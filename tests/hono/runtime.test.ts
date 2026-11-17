import { startBuiltWorker } from '../../tools/start_built_worker.ts';
import { builtWorkerBrowserEnvironment } from '../helpers/built_worker_environment.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Miniflare } from 'miniflare';
import { createI18n } from '../../lib/i18n/messages.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { chromium } from 'playwright';
import { assertNoBlockingA11y } from '../helpers/browser_accessibility.ts';

let runtime: Miniflare;

beforeAll(async () => {
  runtime = await startBuiltWorker({
    mode: 'qa',
    databaseUrl: null,
    bindings: builtWorkerBrowserEnvironment,
  });
});

afterAll(async () => {
  await runtime?.dispose();
});

const request = (path: string, init?: Parameters<Miniflare['dispatchFetch']>[1]) =>
  runtime.dispatchFetch('https://app.example.test' + path, init);

describe('built Hono application in workerd', () => {
  it('renders the existing reset form, localized shell, private headers and built assets', async () => {
    const response = await request('/password/reset?token=owned-test-token', {
      headers: { 'accept-language': 'es-ES' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-language')).toBe('es-ES');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('set-cookie')).toContain('qflow-locale=es-ES');
    const html = await response.text();
    expect(html).toContain('<html lang="es-ES"');
    expect(html).toContain('action="/password/reset"');
    expect(html).toContain('name="token"');
    expect(html).toContain('owned-test-token');
    expect(html).toMatch(/\/assets\/bootstrap-[\w-]+\.css/);
    expect(html).toMatch(/type="module" src="\/assets\/bootstrap-[\w-]+\.js"/);
    expect(html).not.toContain('fresh-island');
  });

  it('preserves HEAD and rejects unsupported methods without forwarding to Fresh', async () => {
    const response = await request('/password/reset?token=owned-test-token', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const unsupported = await request('/password/reset', {
      method: 'PUT',
      headers: { origin: 'https://app.example.test' },
    });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get('allow')).toBe('GET, HEAD, POST');
    await unsupported.body?.cancel();
    const unconverted = await request('/items', { redirect: 'manual' });
    expect(unconverted.status).toBe(302);
    expect(unconverted.headers.get('location')).toBe('/login?next=%2Fitems');
    await unconverted.body?.cancel();
    const anonymous = await request('/api/me');
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'unauthorized' });
  });

  it('handles invalid native forms without requiring or selecting a database', async () => {
    const invalid = await request('/password/forgot', {
      method: 'POST',
      headers: { origin: 'https://app.example.test' },
      body: new URLSearchParams({ email: 'invalid' }),
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.text()).toContain('id="forgot-error"');
    const missingToken = await request('/password/reset', {
      method: 'POST',
      headers: { origin: 'https://app.example.test' },
      body: new URLSearchParams({ password: 'Not consumed' }),
    });
    expect(missingToken.status).toBe(200);
    expect(await missingToken.text()).not.toContain('id="new-password"');
  });

  it('keeps CSRF security headers and missing-config health behavior explicit', async () => {
    const denied = await request('/password/reset', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      body: new URLSearchParams({ token: 'not-consumed', password: 'Not consumed' }),
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('x-content-type-options')).toBe('nosniff');
    await denied.body?.cancel();
    const health = await request('/health');
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({
      status: 'degraded',
      checks: { database: 'error' },
    });
    const wrongMethod = await request('/health', {
      method: 'POST',
      headers: { origin: 'https://app.example.test' },
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET, HEAD');
    await wrongMethod.body?.cancel();
    const failedAuth = await request('/settings', {
      headers: { cookie: 'qflow_session=missing-database-fixture', 'accept-language': 'sv-SE' },
    });
    expect(failedAuth.status).toBe(500);
    expect(failedAuth.headers.get('x-content-type-options')).toBe('nosniff');
    expect(failedAuth.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const i18n = createI18n('sv-SE', catalogForLocale('sv-SE'));
    expect(failedAuth.headers.get('content-language')).toBe('sv-SE');
    const html = await failedAuth.text();
    expect(html).toContain('<html lang="sv-SE"');
    expect(html).toContain(i18n.t('help.page.error.title'));
    expect(html).toContain('href="/assessments"');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        extraHTTPHeaders: {
          cookie: 'qflow_session=missing-database-fixture',
          'accept-language': 'sv-SE',
        },
      });
      expect((await page.goto((await runtime.ready).origin + '/settings'))?.status()).toBe(500);
      expect(
        await page.getByRole('heading', { name: i18n.t('help.page.error.title'), exact: true })
          .isVisible(),
      ).toBe(true);
      await assertNoBlockingA11y(page);
    } finally {
      await browser.close();
    }
  });
});

it('adds server-owned request IDs to normal, HEAD, rejected and failed Worker responses', async () => {
  const ids: string[] = [];
  for (
    const [path, init, status] of [
      ['/password/reset?token=private-query', {}, 200],
      ['/password/reset?token=private-query', { method: 'HEAD' }, 200],
      [
        '/password/reset',
        { method: 'POST', headers: { origin: 'https://attacker.example.test' } },
        403,
      ],
      ['/settings', { headers: { cookie: 'qflow_session=missing-database-fixture' } }, 500],
    ] as const
  ) {
    const response = await request(path, {
      ...init,
      headers: { ...('headers' in init ? init.headers : {}), 'x-request-id': 'caller-supplied-id' },
    });
    expect(response.status).toBe(status);
    const id = response.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    if (!id) throw Error('Missing request identity.');
    ids.push(id);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await response.body?.cancel();
  }
  expect(new Set(ids).size).toBe(ids.length);
});

it('accepts native reset forms without leaking the reset URL in the referrer', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ javaScriptEnabled: false, locale: 'sv-SE' });
    page.setDefaultTimeout(5_000);
    const origin = (await runtime.ready).origin;
    await page.context().addCookies([{ name: 'qflow-locale', value: 'es-ES', url: origin }]);
    for (const path of ['/password/forgot', '/password/reset?token=private-reset-token']) {
      await page.goto(origin + path);
      if (path === '/password/forgot') {
        await page.locator('input[name="email"]').fill('user@localhost');
      } else {
        await page.locator('input[name="password"]').fill('A valid password 2026');
        // Exercise the missing-token response without contacting a database.
        await page.locator('input[name="token"]').evaluate((input: HTMLInputElement) => {
          input.value = '';
        });
      }
      const [response] = await Promise.all([
        page.waitForResponse((response) => response.request().method() === 'POST'),
        page.locator('form.ds-card button[type="submit"]').press('Enter'),
      ]);
      expect(response.status()).toBe(200);
      expect(await page.locator('html').getAttribute('lang')).toBe('sv-SE');
      expect(await page.locator('form[action="/api/locale"]').count()).toBe(0);
      const headers = await response.request().allHeaders();
      expect(headers['origin']).toBe(origin);
      expect(headers['referer']).toBe(origin + '/');
      expect(await response.text()).toContain(
        path === '/password/forgot' ? 'id="forgot-error"' : 'role="alert"',
      );
    }
  } finally {
    await browser.close();
  }
});
