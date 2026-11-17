import { expect, test as testCase } from 'vitest';

import type { FetchFixtureServer } from './helpers/fetch_server.ts';
import { startFetchServer } from './helpers/fetch_server.ts';

import { renderPage as render } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { applyLocalizedResponseHeaders } from '../lib/http/request_policy.ts';
import { localeMutationResponse } from '../lib/http/routes/public_pages/locale.ts';
import { parseAuthReturnPath } from '../lib/http/auth_return_path.ts';
import { accountSettingsRedirect } from '../lib/http/routes/settings_pages/account_settings.tsx';
import {
  buildLocaleCookie,
  parseInterfaceLocale,
  parseLocaleCookie,
  resolveInterfaceLocale,
} from '../lib/i18n/locale.ts';
import { parseUserSettings, parseUserSettingsPatch } from '../lib/settings.ts';
import {
  accounts,
  assertBrowserErrors,
  assertLocalizedSurface,
  type Locale,
  locales,
  pageContent,
  persistedAccountValues,
} from './helpers/auth_locale_browser_fixtures.tsx';

testCase('signed-out and account locale browser contract uses authoritative locale state', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let server: FetchFixtureServer | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const localePosts: Array<Record<string, string[]>> = [];
  const settingsPosts: Array<Record<string, string[]>> = [];
  try {
    server = await startFetchServer(async (request) => {
      const url = new URL(request.url);
      const cookieHeader = request.headers.get('cookie');
      const account = cookieHeader?.match(/(?:^|; )account=([^;]+)/)?.[1];
      if (request.method === 'POST' && url.pathname === '/api/locale') {
        const form = await request.formData();
        const values: Record<string, string[]> = {};
        for (const key of ['locale', 'next']) values[key] = form.getAll(key).map(String);
        localePosts.push(values);
        return localeMutationResponse(url, form);
      }
      if (request.method === 'POST' && url.pathname === '/settings') {
        const form = await request.formData();
        const values: Record<string, string[]> = {};
        for (const key of ['displayName', 'email', 'theme', 'interfaceLocale']) {
          values[key] = form.getAll(key).map(String);
        }
        settingsPosts.push(values);
        const patch = parseUserSettingsPatch({ interfaceLocale: form.get('interfaceLocale') });
        const current = accounts[account ?? 'account-a'];
        if (!current || !patch?.interfaceLocale) {
          return Response.json({ code: 'invalid_settings' }, { status: 400 });
        }
        accounts[account ?? 'account-a'] = { ...current, interfaceLocale: patch.interfaceLocale };
        persistedAccountValues[account ?? 'account-a'] = accounts[account ?? 'account-a'];
        return accountSettingsRedirect(url, patch.interfaceLocale);
      }
      let persisted: Locale | null = null;
      if (url.pathname === '/settings') {
        const stored = persistedAccountValues[account ?? 'account-a'];
        if (stored === undefined) {
          return Response.json({ code: 'missing_account_settings' }, { status: 500 });
        }
        try {
          persisted = parseUserSettings(stored).interfaceLocale;
        } catch {
          return Response.json({ code: 'invalid_account_settings' }, { status: 500 });
        }
      }
      const locale = resolveInterfaceLocale(
        persisted,
        cookieHeader,
        request.headers.get('accept-language'),
      );
      const next = url.pathname === '/login' || url.pathname === '/signup'
        ? parseAuthReturnPath(url.searchParams.get('next'))
        : null;
      const i18n = createI18n(locale, catalogForLocale(locale));
      const content = render(
        pageContent(
          url.pathname,
          locale,
          i18n,
          next,
          account,
          url.searchParams.get('success') === '1',
          url.searchParams.get('state') === 'invalid'
            ? 'invalid_link'
            : url.searchParams.get('state') === 'success'
            ? 'success'
            : 'form',
          url.searchParams.get('provider') === 'microsoft',
        ),
      );
      const response = new Response(
        `<!doctype html><html lang="${locale}" dir="ltr"><head><meta charset="utf-8"><title>${
          i18n.t(
            url.pathname === '/settings'
              ? 'settings.title'
              : url.pathname === '/signup'
              ? 'signup.title'
              : url.pathname === '/password/forgot'
              ? 'forgot.title'
              : url.pathname === '/password/reset'
              ? 'reset.title'
              : 'login.title',
          )
        }</title></head><body>${content}</body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
      return applyLocalizedResponseHeaders(
        url,
        response,
        parseLocaleCookie(cookieHeader),
        locale,
      );
    });
    browser = await chromium.launch();
    const base = `http://${'127.0.0.1'}:${server.port}`;
    const acceptHeaders: Record<Locale, string> = {
      'en-US': 'en-US,en;q=0.8',
      'en-GB': 'en-GB,en;q=0.8',
      'es-ES': 'es-ES,es;q=0.8',
      'es-419': 'es-MX,es;q=0.8',
      'sv-SE': 'sv-SE,sv;q=0.8',
    };
    for (const locale of locales) {
      const context: import('playwright').BrowserContext = await browser.newContext({
        extraHTTPHeaders: { 'accept-language': acceptHeaders[locale] },
      });
      const page: import('playwright').Page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.addInitScript(() => {
        const events: string[] = [];
        (globalThis as typeof globalThis & { __AUTH_BROWSER_ERRORS__?: string[] })
          .__AUTH_BROWSER_ERRORS__ = events;
        addEventListener('unhandledrejection', (event) => events.push(String(event.reason)));
      });
      try {
        const firstResponse = await page.goto(`${base}/login`);
        expect(firstResponse?.headers()['content-language']).toStrictEqual(locale);
        expect(buildLocaleCookie(new URL(`${base}/login`), locale)).toStrictEqual(
          `qflow-locale=${locale}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
        );
        expect(await page.locator('html').getAttribute('lang')).toStrictEqual(locale);
        expect(await page.locator('html').getAttribute('dir')).toStrictEqual('ltr');
        expect(await page.locator('html').getAttribute('lang')).toStrictEqual(locale);
        expect(await page.locator('body').innerText()).toContain(
          createI18n(locale, catalogForLocale(locale)).t('login.title'),
        );
        const loginBody = await page.locator('body').innerText();
        const loginI18n = createI18n(locale, catalogForLocale(locale));
        assertLocalizedSurface(loginBody, locale);
        for (const prefix of ['login.', 'signup.', 'forgot.', 'reset.', 'locale.', 'settings.']) {
          expect(loginBody.includes(prefix)).toStrictEqual(false);
        }
        expect(loginBody.includes('{')).toStrictEqual(false);
        for (
          const id of [
            'login.email',
            'login.password',
            'login.submit',
            'login.forgot',
            'login.createAccount',
          ]
        ) {
          expect(loginBody).toContain(loginI18n.t(id));
        }
        expect(await page.locator('form[action="/api/locale"]').count()).toStrictEqual(0);
        await page.goto(`${base}/signup`);
        const chooser = page.locator('form[action="/api/locale"]');
        expect(await chooser.locator('option').count()).toStrictEqual(locales.length);
        for (const optionLocale of locales) {
          expect(await chooser.locator(`option[value="${optionLocale}"]`).getAttribute('lang'))
            .toStrictEqual(optionLocale);
        }
        if (locale.startsWith('es-')) {
          for (const phrase of ['Sign in', 'Create account', 'Forgot password', 'Save changes']) {
            expect(loginBody.includes(phrase)).toStrictEqual(false);
          }
          expect(await chooser.innerText()).toContain(
            createI18n(locale, catalogForLocale(locale)).t('locale.beta'),
          );
        }
        const cookie = (await context.cookies()).find((item) => item.name === 'qflow-locale');
        expect(cookie?.value).toStrictEqual(locale);
        expect(cookie?.path).toStrictEqual('/');
        expect(cookie?.httpOnly).toStrictEqual(true);
        expect(cookie?.sameSite).toStrictEqual('Lax');
        const target = ({
          'en-US': 'en-GB',
          'en-GB': 'es-ES',
          'es-ES': 'es-419',
          'es-419': 'sv-SE',
          'sv-SE': 'en-US',
        } as const)[locale];
        await chooser.locator('select[name="locale"]').selectOption(target);
        await chooser.getByRole('button', {
          name: createI18n(locale, catalogForLocale(locale)).t('locale.apply'),
        }).click();
        await page.waitForURL(`${base}/login`);
        expect(await page.locator('html').getAttribute('lang')).toStrictEqual(target);
        expect(localePosts.at(-1)?.locale).toStrictEqual([target]);
        expect(localePosts.at(-1)?.next).toStrictEqual(['']);
        expect((await context.cookies()).find((item) => item.name === 'qflow-locale')?.value)
          .toStrictEqual(target);
        await page.goto(`${base}/signup`);
        const loginEmail = page.locator('input[name="email"]');
        await loginEmail.fill('usuario+ñ@example.test');
        await page.locator('input[name="password"]').fill('never-send-this-password');
        await page.locator('form[action="/api/locale"] select').selectOption(locale);
        await page.locator('form[action="/api/locale"]').getByRole('button').click();
        const lastPost = localePosts.at(-1)!;
        expect(lastPost.locale).toStrictEqual([locale]);
        expect(lastPost.next).toStrictEqual(['']);
        expect(Object.values(lastPost).flat().includes('never-send-this-password')).toStrictEqual(
          false,
        );
        expect(Object.values(lastPost).flat().includes('usuario+ñ@example.test')).toStrictEqual(
          false,
        );
        const authPages = [
          ['/signup', 'signup.title'],
          ['/password/forgot', 'forgot.title'],
          ['/password/reset?token=safe-token', 'reset.title'],
        ] as const;
        for (const [path, titleId] of authPages) {
          const authResponse = await page.goto(`${base}${path}`);
          const pageI18n = createI18n(locale, catalogForLocale(locale));
          expect(authResponse?.headers()['content-language']).toStrictEqual(locale);
          expect(await page.locator('body').innerText()).toContain(pageI18n.t(titleId));
          expect(await page.locator('form[action="/api/locale"]').count()).toStrictEqual(
            path === '/signup' ? 1 : 0,
          );
          const authBody = await page.locator('body').innerText();
          assertLocalizedSurface(authBody, locale);
          for (
            const prefix of ['login.', 'signup.', 'forgot.', 'reset.', 'locale.', 'settings.']
          ) {
            expect(authBody.includes(prefix)).toStrictEqual(false);
          }
          expect(authBody.includes('{count')).toStrictEqual(false);
          const expected = path === '/signup'
            ? ['signup.name', 'signup.email', 'signup.password', 'signup.submit']
            : path.startsWith('/password/forgot')
            ? ['login.email', 'forgot.submit', 'forgot.back']
            : ['reset.newPassword', 'reset.submit', 'reset.back'];
          for (const id of expected) expect(authBody).toContain(pageI18n.t(id));
          if (path.startsWith('/password/reset')) {
            expect(await page.locator('body').innerHTML()).toContain('autocomplete="new-password"');
          }
          if (locale.startsWith('es-')) {
            for (
              const phrase of ['Sign in', 'Create account', 'Forgot password', 'Save changes']
            ) {
              expect(authBody.includes(phrase)).toStrictEqual(false);
            }
          }
        }
        for (const state of ['invalid', 'success'] as const) {
          await page.goto(`${base}/password/reset?state=${state}`);
          const stateI18n = createI18n(locale, catalogForLocale(locale));
          expect(await page.locator('body').innerText()).toContain(loginI18n.t('reset.title'));
          expect(await page.locator('form[action="/api/locale"]').count()).toStrictEqual(0);
          const stateBody = await page.locator('body').innerText();
          assertLocalizedSurface(stateBody, locale);
          expect(stateBody).toContain(
            state === 'invalid' ? stateI18n.t('reset.invalidLink') : stateI18n.t('reset.success'),
          );
          expect(stateBody).toContain(
            state === 'invalid' ? stateI18n.t('reset.requestLink') : stateI18n.t('login.submit'),
          );
          expect(await page.locator('input[name="password"]').count()).toStrictEqual(0);
        }
        await page.goto(`${base}/login?provider=microsoft`);
        const providerBody = await page.locator('body').innerText();
        assertLocalizedSurface(providerBody, locale);
        expect(providerBody).toContain('<Campus Ω>');
        expect((await page.locator('body').innerHTML()).includes('<Campus')).toStrictEqual(false);
        expect(await page.locator('a[href="/auth/oidc/microsoft"]').count()).toStrictEqual(1);
        const safeNext = '/assessments/new?intent=recover&source=respondus';
        await page.goto(`${base}/login?next=${encodeURIComponent(safeNext)}`);
        expect(await page.locator('body').innerHTML()).toContain(
          `name="next" value="${safeNext.replaceAll('&', '&amp;')}"`,
        );
        await page.goto(`${base}/signup?next=${encodeURIComponent(safeNext)}`);
        const safeChooser = page.locator('form[action="/api/locale"]');
        await safeChooser.locator('select[name="locale"]').selectOption(target);
        await safeChooser.getByRole('button', {
          name: createI18n(locale, catalogForLocale(locale)).t('locale.apply'),
        }).click();
        await page.waitForURL(`${base}/assessments/new?intent=recover&source=respondus`);
        expect(await page.locator('html').getAttribute('lang')).toStrictEqual(target);
        expect(localePosts.at(-1)?.locale).toStrictEqual([target]);
        expect(localePosts.at(-1)?.next).toStrictEqual([safeNext]);
        await assertBrowserErrors(page, errors);
      } finally {
        await page.close();
        await context.close();
      }
    }
    const invalidCookieContext: import('playwright').BrowserContext = await browser.newContext({
      extraHTTPHeaders: { 'accept-language': 'es-ES,es;q=0.8' },
    });
    const invalidCookiePage: import('playwright').Page = await invalidCookieContext.newPage();
    try {
      const errors: string[] = [];
      invalidCookiePage.on('pageerror', (error) => errors.push(error.message));
      invalidCookiePage.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await invalidCookiePage.addInitScript(() => {
        const events: string[] = [];
        (globalThis as typeof globalThis & { __AUTH_BROWSER_ERRORS__?: string[] })
          .__AUTH_BROWSER_ERRORS__ = events;
        addEventListener('unhandledrejection', (event) => events.push(String(event.reason)));
      });
      await invalidCookieContext.addCookies([{
        name: 'qflow-locale',
        value: 'fr-FR',
        url: base,
      }]);
      const response = await invalidCookiePage.goto(`${base}/login`);
      expect(response?.headers()['content-language']).toStrictEqual('es-ES');
      expect(await invalidCookiePage.locator('html').getAttribute('lang')).toStrictEqual('es-ES');
      assertLocalizedSurface(await invalidCookiePage.locator('body').innerText(), 'es-ES');
      expect(await invalidCookiePage.locator('form[action="/api/locale"]').count()).toStrictEqual(
        0,
      );
      await assertBrowserErrors(invalidCookiePage, errors);
      expect(
        (await invalidCookieContext.cookies()).find((item) => item.name === 'qflow-locale')
          ?.value,
      ).toStrictEqual('es-ES');
    } finally {
      await invalidCookiePage.close();
      await invalidCookieContext.close();
    }
    const accountContextA: import('playwright').BrowserContext = await browser.newContext({
      extraHTTPHeaders: { 'accept-language': 'en-US' },
    });
    const accountContextB: import('playwright').BrowserContext = await browser.newContext({
      extraHTTPHeaders: { 'accept-language': 'es-419' },
    });
    try {
      await accountContextA.addCookies([{ name: 'account', value: 'account-a', url: base }]);
      await accountContextB.addCookies([{ name: 'account', value: 'account-b', url: base }]);
      await accountContextA.addCookies([{ name: 'qflow-locale', value: 'en-US', url: base }]);
      await accountContextB.addCookies([{ name: 'qflow-locale', value: 'es-ES', url: base }]);
      const [pageA, pageB] = [await accountContextA.newPage(), await accountContextB.newPage()];
      const accountErrorsA: string[] = [];
      const accountErrorsB: string[] = [];
      for (
        const [accountPage, accountErrors] of [[pageA, accountErrorsA], [
          pageB,
          accountErrorsB,
        ]] as const
      ) {
        accountPage.on('pageerror', (error) => accountErrors.push(error.message));
        accountPage.on('console', (message) => {
          if (message.type() === 'error') {
            accountErrors.push(message.text());
          }
        });
        await accountPage.addInitScript(() => {
          const events: string[] = [];
          (globalThis as typeof globalThis & { __AUTH_BROWSER_ERRORS__?: string[] })
            .__AUTH_BROWSER_ERRORS__ = events;
          addEventListener('unhandledrejection', (event) => events.push(String(event.reason)));
        });
      }
      try {
        const [settingsResponseA, settingsResponseB] = await Promise.all([
          pageA.goto(`${base}/settings`),
          pageB.goto(`${base}/settings`),
        ]);
        for (const settingsPage of [pageA, pageB]) {
          const settingsBody = await settingsPage.locator('body').innerText();
          assertLocalizedSurface(
            settingsBody,
            (await settingsPage.locator('html').getAttribute('lang')) as Locale,
          );
          expect(settingsBody.includes('settings.')).toStrictEqual(false);
          expect(settingsBody.includes('{count')).toStrictEqual(false);
        }
        expect(settingsResponseA?.headers()['content-language']).toStrictEqual('es-ES');
        expect(settingsResponseB?.headers()['content-language']).toStrictEqual('en-GB');
        expect(await pageA.locator('html').getAttribute('lang')).toStrictEqual('es-ES');
        expect(await pageB.locator('html').getAttribute('lang')).toStrictEqual('en-GB');
        if (!(await pageA.locator('input[name="interfaceLocale"][value="es-ES"]').isChecked())) {
          expect.unreachable(
            'Expected await pageA.locator(\'input[name="interfaceLocale"][value="es-ES"]\').isChecked()',
          );
        }
        if (!(await pageB.locator('input[name="interfaceLocale"][value="en-GB"]').isChecked())) {
          expect.unreachable(
            'Expected await pageB.locator(\'input[name="interfaceLocale"][value="en-GB"]\').isChecked()',
          );
        }
        expect(await pageA.locator('input[name="theme"]').count()).toStrictEqual(3);
        expect(await pageA.locator('input[name="theme"][value="wireframe"]').isChecked())
          .toStrictEqual(true);
        for (const optionLocale of locales) {
          expect(
            await pageA.locator(`input[name="interfaceLocale"][value="${optionLocale}"]`).count(),
          ).toStrictEqual(1);
          expect(await pageA.locator(`span[lang="${optionLocale}"]`).count()).toStrictEqual(1);
        }
        expect(await pageA.locator('body').innerText()).toContain(
          createI18n('es-ES', catalogForLocale('es-ES')).t('locale.beta'),
        );
        expect(await pageA.locator('input[name="displayName"]').inputValue()).toStrictEqual(
          '<Ana ✨>',
        );
        expect(await pageA.locator('input[name="email"]').inputValue()).toStrictEqual(
          'ana+✨@example.test',
        );
        expect(await pageA.locator('body').innerHTML()).toContain('&lt;Ana ✨&gt;');
        expect((await pageA.locator('body').innerHTML()).includes('<Ana')).toStrictEqual(false);
        await pageA.locator('input[name="interfaceLocale"][value="es-419"]').check();
        await pageA.getByRole('button', {
          name: createI18n('es-ES', catalogForLocale('es-ES')).t('settings.save'),
        }).click();
        await pageA.waitForURL(`${base}/settings?success=1`);
        expect(await pageA.locator('html').getAttribute('lang')).toStrictEqual('es-419');
        assertLocalizedSurface(await pageA.locator('body').innerText(), 'es-419');
        expect(await pageA.locator('input[name="displayName"]').inputValue()).toStrictEqual(
          '<Ana ✨>',
        );
        const settingsPost = settingsPosts.at(-1)!;
        expect(settingsPost.displayName).toStrictEqual(['<Ana ✨>']);
        expect(settingsPost.email).toStrictEqual([]);
        expect(settingsPost.theme).toStrictEqual(['wireframe']);
        expect(settingsPost.interfaceLocale).toStrictEqual(['es-419']);
        expect(await pageA.locator('html').getAttribute('lang')).toStrictEqual('es-419');
        expect(await pageA.locator('body').innerText()).toContain(
          createI18n('es-419', catalogForLocale('es-419')).t('settings.saved'),
        );
        expect(await pageA.locator('input[name="email"]').inputValue()).toStrictEqual(
          'ana+✨@example.test',
        );
        expect(await pageA.locator('input[name="theme"][value="wireframe"]').isChecked())
          .toStrictEqual(true);
        expect(
          (await accountContextA.cookies()).find((item) => item.name === 'qflow-locale')?.value,
        ).toStrictEqual('es-419');
        const savedCookie = (await accountContextA.cookies()).find((item) =>
          item.name === 'qflow-locale'
        );
        expect(savedCookie?.value).toStrictEqual('es-419');
        expect(savedCookie?.path).toStrictEqual('/');
        expect(savedCookie?.httpOnly).toStrictEqual(true);
        expect(savedCookie?.sameSite).toStrictEqual('Lax');
        expect(savedCookie?.secure).toStrictEqual(false);
        expect(await pageB.locator('html').getAttribute('lang')).toStrictEqual('en-GB');
        expect(accounts['account-a'].interfaceLocale).toStrictEqual('es-419');
        await accountContextA.addCookies([{ name: 'qflow-locale', value: 'en-US', url: base }]);
        await accountContextB.addCookies([{ name: 'qflow-locale', value: 'es-419', url: base }]);
        const [reloadA, reloadB] = await Promise.all([
          pageA.goto(`${base}/settings`),
          pageB.goto(`${base}/settings`),
        ]);
        expect(reloadA?.headers()['content-language']).toStrictEqual('es-419');
        expect(reloadB?.headers()['content-language']).toStrictEqual('en-GB');
        expect(await pageA.locator('html').getAttribute('lang')).toStrictEqual('es-419');
        expect(await pageB.locator('html').getAttribute('lang')).toStrictEqual('en-GB');
        expect(await pageA.locator('input[name="interfaceLocale"][value="es-419"]').isChecked())
          .toStrictEqual(true);
        expect(await pageB.locator('input[name="interfaceLocale"][value="en-GB"]').isChecked())
          .toStrictEqual(true);
        expect(
          (await accountContextA.cookies()).find((item) => item.name === 'qflow-locale')?.value,
        ).toStrictEqual('es-419');
        expect(
          (await accountContextB.cookies()).find((item) => item.name === 'qflow-locale')?.value,
        ).toStrictEqual('en-GB');
        expect((await pageA.locator('body').innerText()).includes('settings.')).toStrictEqual(
          false,
        );
        expect((await pageB.locator('body').innerText()).includes('settings.')).toStrictEqual(
          false,
        );
        assertLocalizedSurface(await pageA.locator('body').innerText(), 'es-419');
        assertLocalizedSurface(await pageB.locator('body').innerText(), 'en-GB');
        await assertBrowserErrors(pageA, accountErrorsA);
        await assertBrowserErrors(pageB, accountErrorsB);
      } finally {
        await pageA.close();
        await pageB.close();
      }
    } finally {
      await accountContextA.close();
      await accountContextB.close();
    }
    const invalidAccountContext: import('playwright').BrowserContext = await browser.newContext({
      extraHTTPHeaders: { 'accept-language': 'es-ES' },
    });
    const invalidAccountPage: import('playwright').Page = await invalidAccountContext.newPage();
    try {
      const invalidErrors: string[] = [];
      invalidAccountPage.on('pageerror', (error) => invalidErrors.push(error.message));
      invalidAccountPage.on('console', (message) => {
        if (message.type() === 'error') invalidErrors.push(message.text());
      });
      await invalidAccountPage.addInitScript(() => {
        const events: string[] = [];
        (globalThis as typeof globalThis & { __AUTH_BROWSER_ERRORS__?: string[] })
          .__AUTH_BROWSER_ERRORS__ = events;
        addEventListener('unhandledrejection', (event) => events.push(String(event.reason)));
      });
      await invalidAccountContext.addCookies([{
        name: 'account',
        value: 'account-invalid',
        url: base,
      }]);
      await invalidAccountPage.goto(`${base}/login`);
      const invalidResult = await invalidAccountPage.evaluate(async () => {
        const response = await fetch('/settings');
        return { status: response.status, body: await response.json() };
      });
      expect(invalidResult).toStrictEqual({
        status: 500,
        body: { code: 'invalid_account_settings' },
      });
      await assertBrowserErrors(invalidAccountPage, invalidErrors, /status of 500/);
    } finally {
      await invalidAccountPage.close();
      await invalidAccountContext.close();
    }
    const missingAccountContext: import('playwright').BrowserContext = await browser.newContext({
      extraHTTPHeaders: { 'accept-language': 'es-ES' },
    });
    const missingAccountPage: import('playwright').Page = await missingAccountContext.newPage();
    try {
      const errors: string[] = [];
      missingAccountPage.on('pageerror', (error) => errors.push(error.message));
      missingAccountPage.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await missingAccountPage.addInitScript(() => {
        const events: string[] = [];
        (globalThis as typeof globalThis & { __AUTH_BROWSER_ERRORS__?: string[] })
          .__AUTH_BROWSER_ERRORS__ = events;
        addEventListener('unhandledrejection', (event) => events.push(String(event.reason)));
      });
      await missingAccountContext.addCookies([{
        name: 'account',
        value: 'account-missing',
        url: base,
      }]);
      await missingAccountPage.goto(`${base}/login`);
      const missingResult = await missingAccountPage.evaluate(async () => {
        const response = await fetch('/settings');
        return { status: response.status, body: await response.json() };
      });
      expect(missingResult).toStrictEqual({
        status: 500,
        body: { code: 'missing_account_settings' },
      });
      await assertBrowserErrors(missingAccountPage, errors, /status of 500/);
    } finally {
      await missingAccountPage.close();
      await missingAccountContext.close();
    }
    const probeContext: import('playwright').BrowserContext = await browser.newContext();
    const probePage: import('playwright').Page = await probeContext.newPage();
    try {
      const probeErrors: string[] = [];
      probePage.on('pageerror', (error) => probeErrors.push(error.message));
      probePage.on('console', (message) => {
        if (message.type() === 'error') probeErrors.push(message.text());
      });
      await probePage.addInitScript(() => {
        const events: string[] = [];
        (globalThis as typeof globalThis & { __AUTH_BROWSER_ERRORS__?: string[] })
          .__AUTH_BROWSER_ERRORS__ = events;
        addEventListener('unhandledrejection', (event) => events.push(String(event.reason)));
      });
      await probePage.goto(`${base}/login`);
      const invalidCases = [
        { locale: 'fr-FR', next: '/login', code: 'invalid_locale' },
      ] as const;
      for (const item of invalidCases) {
        const result = await probePage.evaluate(async ({ locale, next }) => {
          const form = new FormData();
          form.append('locale', locale);
          form.append('next', next);
          const response = await fetch('/api/locale', {
            method: 'POST',
            body: form,
            redirect: 'manual',
          });
          return {
            status: response.status,
            contentType: response.headers.get('content-type'),
            body: await response.text(),
          };
        }, item);
        if (item.code === 'invalid_locale') {
          expect(result).toStrictEqual({
            status: 400,
            contentType: 'application/json',
            body: '{"code":"invalid_locale"}',
          });
        }
      }
      for (
        const hostileNext of [
          'https://evil.example/steal',
          '//evil.example/steal',
          '/login\\\\evil',
          '/login\r\nX-Hostile: yes',
        ]
      ) {
        await probePage.goto(`${base}/signup`);
        await probePage.locator('form[action="/api/locale"] input[name="next"]').evaluate(
          (input, value) => (input as HTMLInputElement).value = value as string,
          hostileNext,
        );
        await probePage.locator('form[action="/api/locale"] select').selectOption('es-ES');
        await Promise.all([
          probePage.waitForURL(`${base}/login`),
          probePage.locator('form[action="/api/locale"]').getByRole('button').click(),
        ]);
        expect(await probePage.locator('html').getAttribute('lang')).toStrictEqual('es-ES');
      }
      const duplicate = await probePage.evaluate(async () => {
        const form = new FormData();
        form.append('locale', 'es-ES');
        form.append('locale', 'en-US');
        form.append('next', '/login');
        const response = await fetch('/api/locale', {
          method: 'POST',
          body: form,
          redirect: 'manual',
        });
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          body: await response.text(),
        };
      });
      expect(duplicate).toStrictEqual({
        status: 400,
        contentType: 'application/json',
        body: '{"code":"invalid_locale_form"}',
      });
      const duplicateNext = await probePage.evaluate(async () => {
        const form = new FormData();
        form.append('locale', 'es-ES');
        form.append('next', '/login');
        form.append('next', '/signup');
        const response = await fetch('/api/locale', {
          method: 'POST',
          body: form,
          redirect: 'manual',
        });
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          body: await response.text(),
        };
      });
      expect(duplicateNext).toStrictEqual({
        status: 400,
        contentType: 'application/json',
        body: '{"code":"invalid_locale_form"}',
      });
      await assertBrowserErrors(probePage, probeErrors, /status of 400/);
    } finally {
      await probePage.close();
      await probeContext.close();
    }
    const unsafe = new FormData();
    unsafe.append('locale', 'es-ES');
    unsafe.append('next', '//evil.example/path');
    expect(localeMutationResponse(new URL(`${base}/login`), unsafe).headers.get('location'))
      .toStrictEqual('/login');
    const duplicateLocale = new FormData();
    duplicateLocale.append('locale', 'es-ES');
    duplicateLocale.append('locale', 'en-US');
    expect(localeMutationResponse(new URL(`${base}/login`), duplicateLocale).status).toStrictEqual(
      400,
    );
    const duplicateNext = new FormData();
    duplicateNext.append('locale', 'es-ES');
    duplicateNext.append('next', '/login');
    duplicateNext.append('next', '/signup');
    expect(localeMutationResponse(new URL(`${base}/login`), duplicateNext).status).toStrictEqual(
      400,
    );
    const newlineNext = new FormData();
    newlineNext.append('locale', 'es-ES');
    newlineNext.append('next', '/login\r\nX-Injected: yes');
    expect(localeMutationResponse(new URL(`${base}/login`), newlineNext).headers.get('location'))
      .toStrictEqual('/login');
    expect(parseInterfaceLocale('not-a-locale')).toStrictEqual(null);
  } finally {
    await browser?.close();
    await server?.close();
  }
});
