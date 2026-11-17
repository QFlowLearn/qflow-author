import { expect, test as testCase } from 'vitest';

import { createServer } from 'node:net';
import { runCommand } from '../tools/process_command.ts';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { shutdownDb } from '../lib/db.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

testCase(
  'managed browser acceptance rejects a missing build without starting the app',
  async () => {
    const directory = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qflow-'));
    try {
      const helper = new URL('../tools/local_app_browser.ts', import.meta.url).href;
      const source = `
      import { openLocalAppBrowser } from ${JSON.stringify(helper)};
      try {
        const app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            isolation: 'fixture',
            portRange: { first: 5900, lastExclusive: 5910 },
            environment: {QFLOW_WRANGLER_CONFIG: 'wrangler.jsonc', DATABASE_URL:'postgres://test:test@127.0.0.1/qflow_test'},
          },
          headless: true,
        });
        await app.close();
        throw new Error('Missing build unexpectedly opened an application.');
      } catch (cause) {
        if (!(cause instanceof Error) ||
            !cause.message.startsWith('Built app startup failed:')) {
          throw cause;
        }
        console.log('missing-build-rejected');
      }
    `;
      const result = await runCommand(process.execPath, [
        '--import',
        import.meta.resolve('tsx'),
        '--input-type=module',
        '--eval',
        source,
      ], { cwd: directory });
      expect(result.success).toStrictEqual(true);
      expect(new TextDecoder().decode(result.stdout).trim()).toStrictEqual(
        'missing-build-rejected',
      );
    } finally {
      await _fs.rm(directory, { recursive: true });
    }
  },
);

testCase('managed browser hydrates compiled assets and releases only its owned app server', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
      const app = await openLocalAppBrowser({
        endpoint: {
          _tag: 'ManagedLocalApp',
          isolation: 'fixture',
          portRange: { first: 5900, lastExclusive: 5910 },
          environment: { ...builtWorkerBrowserEnvironment, DATABASE_URL: databaseUrl },
        },
        headless: true,
      });
      try {
        const context: import('playwright').BrowserContext = await app.newContext({
          authSession: await createSession({ tenantId: ctx.tenantId, userId: ctx.userId }),
        });
        const page: import('playwright').Page = await context.newPage();
        const scripts = new Set<string>();
        const failures: string[] = [];
        page.on('request', (request) => {
          if (request.resourceType() === 'script') scripts.add(new URL(request.url()).pathname);
        });
        page.on('requestfailed', (request) => {
          if (request.resourceType() === 'script') failures.push('script_failed');
        });
        page.on('pageerror', (cause) => failures.push(safeErrorSummary(cause)));
        // This request originates from AccountMenu's hydrated client effect.
        const [account, response] = await Promise.all([
          page.waitForResponse(`${app.baseUrl}/api/me`),
          page.goto(`${app.baseUrl}/assessments`),
        ]);
        if (!(response?.ok())) expect.unreachable('Expected response?.ok()');
        if (!(account.ok())) expect.unreachable('Expected account.ok()');
        if (!(scripts.size > 0)) expect.unreachable('Expected scripts.size > 0');
        if (!([...scripts].every((path) => /^\/assets\/.+-[\w-]{8}\.js$/.test(path)))) {
          expect.unreachable(
            'Expected [...scripts].every((path) => /^\\/assets\\/.+-[\\w-]{8}\\.js$/.test(path))',
          );
        }
        expect(failures).toStrictEqual([]);

        const existing = await openLocalAppBrowser({
          endpoint: { _tag: 'ExistingApp', baseUrl: app.baseUrl },
          headless: true,
        });
        await existing.close();
        const health = await fetch(`${app.baseUrl}/health`);
        if (!(health.ok)) expect.unreachable('Expected health.ok');
        await health.body?.cancel();
        await expect(Promise.resolve().then(() => existing.newContext())).rejects.toSatisfy((
          caught: unknown,
        ) =>
          caught instanceof Error && caught.message.includes('after the local app browser closed')
        );
      } finally {
        await app.close();
      }
      await app.close();
      const listener = createServer();
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(Number(new URL(app.baseUrl).port), '127.0.0.1', resolve);
      });
      await new Promise<void>((resolve, reject) =>
        listener.close((cause) => cause ? reject(cause) : resolve())
      );
    });
  } finally {
    await shutdownDb();
  }
});
