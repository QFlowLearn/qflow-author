import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

import { CATALOGS } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

testCase('MemberPicker browser behavior is localized and rejects hostile responses', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tempDirectory = await _fs.mkdtemp(_path.join(process.cwd(), '.member-picker-browser-'));
  const entryPath = `${tempDirectory}/entry.tsx`;
  const bundlePath = `${tempDirectory}/bundle.js`;
  await _fs.writeFile(
    entryPath,
    `
import { h, render } from "preact";
import MemberPicker from "${process.cwd()}/islands/MemberPicker.tsx";
const config = (globalThis as { __MEMBER_PICKER_CONFIG__: Parameters<typeof MemberPicker>[0] }).__MEMBER_PICKER_CONFIG__;
render(h(MemberPicker, config), document.getElementById("root"));
`,
    'utf8',
  );
  const bundled = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
    entryPath,
    '--bundle',
    '--format=esm',
    '--jsx=automatic',
    '--jsx-import-source=preact',
    `--outfile=${bundlePath}`,
  ], { cwd: process.cwd() });
  if (!(bundled.success)) expect.unreachable(new TextDecoder().decode(bundled.stderr));
  const bundleText = await _fs.readFile(bundlePath, 'utf8');
  if (bundleText.includes('catalogForLocale')) {
    expect.unreachable("Expected !bundleText.includes('catalogForLocale')");
  }
  if (bundleText.includes('en-US/items.json')) {
    expect.unreachable("Expected !bundleText.includes('en-US/items.json')");
  }

  let configJson = '{}';
  const server = await startFetchServer((request) => {
    if (new URL(request.url).pathname === '/bundle.js') {
      return new Response(_fsSync.readFileSync(bundlePath, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    return new Response(
      `<!doctype html><div id="root"></div><script>globalThis.__MEMBER_PICKER_CONFIG__=${configJson}</script><script type="module" src="/bundle.js"></script>`,
      {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    );
  });
  const browser = await chromium.launch();
  try {
    const page: import('playwright').Page = await browser.newPage();
    let mode = 'zero';
    let requests = 0;
    await page.route('**/api/members/search**', async (route) => {
      requests++;
      if (mode === 'failure') {
        await route.fulfill({ status: 503, body: 'hostile server secret' });
      } else if (mode === 'malformed') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ members: [{}] }),
        });
      } else {
        const members = mode === 'zero' ? [] : mode === 'one'
          ? [{
            userId: 'member-1',
            label: 'Ada Lovelace',
            email: 'ada@example.test',
            displayName: 'Ada',
          }]
          : [{
            userId: 'member-1',
            label: 'Ada Lovelace',
            email: 'ada@example.test',
            displayName: 'Ada',
          }, {
            userId: 'member-2',
            label: 'Grace Hopper',
            email: 'grace@example.test',
            displayName: 'Grace',
          }];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ members }),
        });
      }
    });
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
      const i18n = createI18n(locale, CATALOGS[locale]);
      const payload = createI18nPayload(locale, CATALOGS[locale], ['items']);
      const config = {
        name: 'ownerUserId',
        label: 'Owner',
        hint: 'Caller-provided hint.',
        payload,
      };
      configJson = JSON.stringify(config).replaceAll('<', '\\u003c');
      expect((await page.goto(server.origin))?.status()).toStrictEqual(200);
      await page.reload();
      const input = page.getByRole('searchbox');
      const status = page.locator('[aria-live="polite"]');
      await input.waitFor();
      expect(await page.locator('body').innerText()).toContain('Caller-provided hint.');
      expect(await input.getAttribute('aria-describedby') ?? '').toContain(
        await status.getAttribute('id') ?? '',
      );
      requests = 0;
      await input.fill('a');
      await page.waitForTimeout(300);
      expect(requests).toStrictEqual(0);
      expect(await status.innerText()).toStrictEqual(i18n.t('items.memberPicker.minLength'));
      for (const nextMode of ['zero', 'one', 'many', 'failure', 'malformed']) {
        mode = nextMode;
        await input.fill(nextMode === 'zero' ? 'zz' : nextMode);
        await page.waitForTimeout(350);
        if (nextMode === 'zero') {
          expect(await status.innerText()).toStrictEqual(i18n.t('items.memberPicker.noResults'));
        }
        if (nextMode === 'one') {
          expect(await status.innerText()).toStrictEqual(
            i18n.t('items.memberPicker.resultCount', { count: 1 }),
          );
          await page.getByRole('button', { name: /Ada Lovelace/ }).click();
          expect(await status.innerText()).toStrictEqual(
            i18n.t('items.memberPicker.selected', { label: 'Ada Lovelace' }),
          );
          expect(await page.locator('input[type="hidden"]').inputValue()).toStrictEqual('member-1');
        }
        if (nextMode === 'many') {
          expect(await status.innerText()).toStrictEqual(
            i18n.t('items.memberPicker.resultCount', { count: 2 }),
          );
        }
        if (nextMode === 'failure') {
          expect(await status.innerText()).toStrictEqual(i18n.t('items.memberPicker.failure'));
          expect((await page.locator('body').innerText()).includes('hostile server secret'))
            .toStrictEqual(false);
        }
        if (nextMode === 'malformed') {
          expect(await status.innerText()).toStrictEqual(i18n.t('items.memberPicker.noResults'));
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tempDirectory, { recursive: true });
  }
});
