import { expect, test as testCase } from 'vitest';

import type { FetchFixtureServer } from './helpers/fetch_server.ts';
import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { createI18nPayload } from '../lib/i18n/payload.ts';
import enUSSettings from '../lib/i18n/messages/en-US/settings.json' with { type: 'json' };
import enGBSettings from '../lib/i18n/messages/en-GB/settings.json' with { type: 'json' };
import esESSettings from '../lib/i18n/messages/es-ES/settings.json' with { type: 'json' };
import es419Settings from '../lib/i18n/messages/es-419/settings.json' with { type: 'json' };

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const settingsByLocale = {
  'en-US': enUSSettings,
  'en-GB': enGBSettings,
  'es-ES': esESSettings,
  'es-419': es419Settings,
} as const;
type Mode = 'empty' | 'populated' | 'policy-error' | 'verification-error' | 'dns-failure';

testCase('Login Policy browser flow covers localized states and actions', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tmp = await _fs.mkdtemp(_path.join(process.cwd(), '.sso-policy-browser-'));
  let server: FetchFixtureServer | undefined;
  try {
    const entry = `${tmp}/entry.ts`, bundle = `${tmp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `
        import { h, render } from 'preact';
        import LoginPolicySettingsCard from '${process.cwd()}/components/sso_settings/LoginPolicySettingsCard.tsx';
        import { I18nProvider } from '${process.cwd()}/lib/i18n/context.tsx';
        const root = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
        root.id = 'root';
        window.renderPolicy = (config) => render(h(I18nProvider, { payload: config.payload }, h(LoginPolicySettingsCard)), root);
      `,
      'utf8',
    );
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=iife',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      `--outfile=${bundle}`,
    ], { cwd: process.cwd() });
    if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
    const bundleText = await _fs.readFile(bundle, 'utf8');
    if (!(!bundleText.includes('catalogForLocale') && !bundleText.includes('CATALOGS'))) {
      expect.unreachable(
        "Expected !bundleText.includes('catalogForLocale') && !bundleText.includes('CATALOGS')",
      );
    }
    let mode: Mode = 'empty';
    const requests: Array<{ endpoint: 'policy' | 'verification'; body: unknown }> = [];
    const record = {
      domain: 'google.example.com',
      verificationToken: 'token-value',
      expectedDnsTxt: 'qflow-domain-verification=token-value',
      httpsVerificationUrl: 'https://google.example.com/.well-known/qflow-domain-verification.txt',
      dnsVerifiedAt: '2026-01-02T03:04:05.000Z',
      httpsVerifiedAt: null,
      verifiedAt: '2026-01-02T03:04:05.000Z',
    };
    server = await startFetchServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/bundle.js') {
        return new Response(_fsSync.readFileSync(bundle, 'utf8'), {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      if (url.pathname === '/api/sso/policy') {
        if (req.method === 'PATCH') {
          requests.push({ endpoint: 'policy', body: await req.json() });
          await new Promise((r) => setTimeout(r, 250));
        }
        if (mode === 'policy-error' && req.method === 'GET') {
          return Response.json({ error: 'policy_load_failed' }, { status: 503 });
        }
        return Response.json({
          loginPolicy: 'allow_password',
          domainRoutes: mode === 'populated' || mode === 'dns-failure'
            ? [{ domain: 'google.example.com', provider: 'google' }]
            : [],
        });
      }
      if (url.pathname === '/api/sso/domain-verification') {
        if (req.method === 'PATCH') {
          const body = await req.json();
          requests.push({ endpoint: 'verification', body });
          await new Promise((r) => setTimeout(r, 250));
          if (mode === 'dns-failure') {
            return Response.json({
              error: 'dns_verification_failed',
              params: { domain: 'google.example.com' },
            }, { status: 422 });
          }
          return Response.json({ record });
        }
        if (mode === 'verification-error') {
          return Response.json({ error: 'domain_verification_load_failed' }, { status: 503 });
        }
        return Response.json({
          domains: mode === 'populated' || mode === 'dns-failure' ? [record] : [],
        });
      }
      if (url.pathname === '/') mode = (url.searchParams.get('mode') as Mode | null) ?? 'empty';
      return new Response('<!doctype html><div id="root"></div>');
    });
    const browser = await chromium.launch();
    try {
      const page: import('playwright').Page = await browser.newPage();
      const base = `http://${'127.0.0.1'}:${server.port}`;
      for (const locale of locales) {
        mode = 'empty';
        const settings = settingsByLocale[locale];
        await page.goto(`${base}/?locale=${locale}`);
        await page.evaluate((payload) => {
          (globalThis as typeof globalThis & { __POLICY_CONFIG__?: unknown }).__POLICY_CONFIG__ = {
            payload,
          };
        }, createI18nPayload(locale, { settings }, ['settings']));
        await page.addScriptTag({ url: `${base}/bundle.js` });
        await page.evaluate(() =>
          (globalThis as typeof globalThis & {
            renderPolicy: (config: unknown) => void;
            __POLICY_CONFIG__: unknown;
          }).renderPolicy(
            (globalThis as typeof globalThis & { __POLICY_CONFIG__: unknown }).__POLICY_CONFIG__,
          )
        );
        await page.getByRole('heading', { name: settings['settings.sso.policy.title'] })
          .waitFor();
        await page.getByText(settings['settings.sso.routes.empty']).waitFor();
        if ((await page.locator('body').innerText()).includes('settings.sso.')) {
          expect.unreachable(
            "Expected !(await page.locator('body').innerText()).includes('settings.sso.')",
          );
        }
      }
      const settings = enUSSettings;
      mode = 'populated';
      await page.goto(`${base}/?locale=en-US&mode=populated`);
      await page.evaluate((payload) => {
        (globalThis as typeof globalThis & { __POLICY_CONFIG__?: unknown }).__POLICY_CONFIG__ = {
          payload,
        };
      }, createI18nPayload('en-US', { settings }, ['settings']));
      await page.addScriptTag({ url: `${base}/bundle.js` });
      await page.evaluate(() =>
        (globalThis as typeof globalThis & {
          renderPolicy: (config: unknown) => void;
          __POLICY_CONFIG__: unknown;
        }).renderPolicy(
          (globalThis as typeof globalThis & { __POLICY_CONFIG__: unknown }).__POLICY_CONFIG__,
        )
      );
      await page.getByText('google.example.com').waitFor();
      await page.getByRole('button', {
        name: settings['settings.sso.routes.prepareFor'].replace(
          '{domain}',
          'google.example.com',
        ),
      }).click();
      await page.getByRole('status').waitFor();
      expect(await page.getByRole('status').innerText()).toContain('google.example.com');
      const preparePatch = requests.findLast((request) => request.endpoint === 'verification');
      expect(preparePatch?.body).toStrictEqual({ domain: 'google.example.com', action: 'prepare' });
      await page.getByText(settings['settings.sso.verificationPrepared']).waitFor();
      expect(await page.locator('body').innerText()).toContain(record.expectedDnsTxt);
      const policySelect = page.getByLabel(settings['settings.sso.policy.label']);
      await policySelect.selectOption('prefer_sso');
      const saveButton = page.getByRole('button', { name: settings['settings.sso.save'] });
      await saveButton.click();
      await page.waitForFunction(
        (text) =>
          Array.from(document.querySelectorAll('[role="status"]')).some((element) =>
            element.textContent?.includes(text as string)
          ),
        settings['settings.sso.savingPolicy'],
      );
      expect(await page.locator('[role="status"]').last().innerText()).toContain(
        settings['settings.sso.savingPolicy'],
      );
      if (!(await page.locator('button[type="submit"]').isDisabled())) {
        expect.unreachable('Expected await page.locator(\'button[type="submit"]\').isDisabled()');
      }
      const policyPatch = requests.findLast((request) => request.endpoint === 'policy');
      expect(policyPatch?.body).toStrictEqual({
        loginPolicy: 'prefer_sso',
        domainRoutes: [{ domain: 'google.example.com', provider: 'google' }],
      });
      await page.getByText(settings['settings.sso.saved']).waitFor();
      if (!(await page.locator('button[type="submit"]').isEnabled())) {
        expect.unreachable('Expected await page.locator(\'button[type="submit"]\').isEnabled()');
      }
      mode = 'dns-failure';
      await page.getByRole('button', {
        name: settings['settings.sso.routes.verifyDnsFor'].replace(
          '{domain}',
          'google.example.com',
        ),
      }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('alert').innerText()).toContain(
        settings['settings.sso.errors.dnsFailed'].replace('{domain}', 'google.example.com'),
      );
      mode = 'empty';
      await page.getByRole('button', { name: settings['settings.sso.routes.add'] }).click();
      const invalidPrepare = page.getByRole('button', { name: /Prepare.*verification/ }).last();
      if (!(await invalidPrepare.isEnabled())) {
        expect.unreachable('Expected await invalidPrepare.isEnabled()');
      }
      await invalidPrepare.click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('alert').innerText()).toContain(
        settings['settings.sso.errors.invalidDomain'],
      );
      for (const failedMode of ['policy-error', 'verification-error'] as const) {
        mode = failedMode;
        await page.goto(`${base}/?locale=en-US&mode=${failedMode}`);
        await page.evaluate((payload) => {
          (globalThis as typeof globalThis & { __POLICY_CONFIG__?: unknown }).__POLICY_CONFIG__ = {
            payload,
          };
        }, createI18nPayload('en-US', { settings }, ['settings']));
        await page.addScriptTag({ url: `${base}/bundle.js` });
        await page.evaluate(() =>
          (globalThis as typeof globalThis & {
            renderPolicy: (config: unknown) => void;
            __POLICY_CONFIG__: unknown;
          }).renderPolicy(
            (globalThis as typeof globalThis & { __POLICY_CONFIG__: unknown }).__POLICY_CONFIG__,
          )
        );
        await page.getByRole('alert').waitFor();
        const expected = settings['settings.sso.errors.invalidResponse'];
        expect(await page.getByRole('alert').innerText()).toContain(expected);
      }
    } finally {
      await browser.close();
    }
    if (!(requests.some((request) => request.endpoint === 'policy'))) {
      expect.unreachable("Expected requests.some((request) => request.endpoint === 'policy')");
    }
    if (!(requests.some((request) => request.endpoint === 'verification'))) {
      expect.unreachable(
        "Expected requests.some((request) => request.endpoint === 'verification')",
      );
    }
  } finally {
    if (server) await server.close();
    await _fs.rm(tmp, { recursive: true }).catch(() => undefined);
  }
});
