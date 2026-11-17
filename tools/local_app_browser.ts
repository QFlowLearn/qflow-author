import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
} from 'playwright';

import { assertAvailablePort, startBuiltAppServer } from './built_app_server.ts';
import {
  assertSharedBrowserEnvironment,
  parseSharedBrowserAppConfig,
} from './browser_app_config.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';

import { SESSION_COOKIE_NAME } from '../lib/http/cookies.ts';

/** Auth session fields required to create a browser context for a signed-in QFlow user. */
export type LocalAppBrowserAuthSession = {
  readonly token: string;
  readonly expiresAt: Date;
};

/** Explicit application endpoint used by a local browser run. */
export type LocalAppEndpoint =
  | {
    readonly _tag: 'ManagedLocalApp';
    /** Dynamic fixture configuration requires a separately owned built server in CI. */
    readonly isolation?: 'fixture';
    readonly portRange: {
      readonly first: number;
      readonly lastExclusive: number;
    };
    readonly environment: Readonly<Record<string, string>>;
  }
  | {
    readonly _tag: 'ExistingApp';
    readonly baseUrl: string;
  };

/** Inputs for opening one browser against a managed local app or an explicitly named existing app. */
export type OpenLocalAppBrowserInput = {
  readonly endpoint: LocalAppEndpoint;
  readonly headless: boolean;
};

/** Browser and app lifecycle owned as one resource. */
export type LocalAppBrowser = {
  readonly baseUrl: string;
  newContext(input?: {
    readonly browser?: BrowserContextOptions;
    readonly authSession?: LocalAppBrowserAuthSession;
  }): Promise<BrowserContext>;
  close(): Promise<void>;
};

/**
 * Opens Chromium against one explicit app endpoint and owns all acquired resources.
 *
 * Managed endpoints own the built Worker process. Build the selected candidate before running.
 * Missing build output fails explicitly. Existing endpoints are never replaced with a local server
 * when they fail.
 */
export async function openLocalAppBrowser(
  input: OpenLocalAppBrowserInput,
): Promise<LocalAppBrowser> {
  const app = await openAppEndpoint(input.endpoint);
  let browser: Browser | null = null;
  try {
    await waitForServer(app.baseUrl);
    browser = await chromium.launch({ headless: input.headless });
    const openedBrowser = browser;
    let closed = false;
    return {
      baseUrl: app.baseUrl,
      async newContext(contextInput = {}) {
        if (closed) throw new Error('Cannot create a context after the local app browser closed.');
        const context = await openedBrowser.newContext(contextInput.browser);
        if (contextInput.authSession) {
          await addSessionCookie(context, app.baseUrl, contextInput.authSession);
        }
        return context;
      },
      async close() {
        if (closed) return;
        closed = true;
        const failures: unknown[] = [];
        for (const close of [() => openedBrowser.close(), () => app.close()]) {
          try {
            await close();
          } catch (cause: unknown) {
            failures.push(cause);
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Local app browser cleanup failed.');
        }
      },
    };
  } catch (cause: unknown) {
    await browser?.close().catch(() => {});
    await app.close().catch(() => {});
    if (cause instanceof Error) throw cause;
    throw new Error('Could not open the local app browser.', { cause });
  }
}

type AppEndpointResource = {
  readonly baseUrl: string;
  close(): Promise<void>;
};

async function openAppEndpoint(endpoint: LocalAppEndpoint): Promise<AppEndpointResource> {
  if (endpoint._tag === 'ExistingApp') {
    return {
      baseUrl: normalizeBaseUrl(endpoint.baseUrl),
      close: () => Promise.resolve(),
    };
  }

  const shared = parseSharedBrowserAppConfig(process.env);
  if (shared && endpoint.isolation !== 'fixture') {
    assertSharedBrowserEnvironment(shared, endpoint.environment);
    return { baseUrl: shared.baseUrl, close: () => Promise.resolve() };
  }
  const port = await choosePort(endpoint.portRange);
  return await startBuiltAppServer({
    mode: 'qa',
    cwd: process.cwd(),
    port,
    environment: endpoint.environment,
  });
}

async function addSessionCookie(
  context: BrowserContext,
  baseUrl: string,
  session: LocalAppBrowserAuthSession,
): Promise<void> {
  const url = new URL(baseUrl);
  await context.addCookies([{
    name: SESSION_COOKIE_NAME,
    value: session.token,
    domain: url.hostname,
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'Lax',
    expires: Math.floor(session.expiresAt.getTime() / 1000),
  }]);
}

async function choosePort(
  range: { readonly first: number; readonly lastExclusive: number },
): Promise<number> {
  if (
    !Number.isInteger(range.first) ||
    !Number.isInteger(range.lastExclusive) ||
    range.first <= 0 ||
    range.lastExclusive <= range.first
  ) {
    throw new Error('Local app browser port range is invalid.');
  }
  for (let port = range.first; port < range.lastExclusive; port++) {
    try {
      await assertAvailablePort(port);
      return port;
    } catch (cause: unknown) {
      if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EADDRINUSE') {
        throw cause;
      }
    }
  }
  throw new Error('Could not find an open port for the local app browser.');
}

async function waitForServer(baseUrl: string): Promise<void> {
  const healthUrl = `${baseUrl}/health`;
  const deadline = Date.now() + 45_000;
  let lastFailure = 'No response.';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (cause: unknown) {
      lastFailure = safeErrorSummary(cause);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${healthUrl}: ${lastFailure}`);
}

function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Existing app URL must use HTTP or HTTPS.');
  }
  return parsed.toString().replace(/\/+$/, '');
}
