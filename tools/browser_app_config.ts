/** Explicit shared built-app configuration passed only by the CI browser runner. */
export type SharedBrowserAppConfig = {
  readonly baseUrl: string;
  readonly environment: Readonly<Record<string, string>>;
};

/** Parses the named execution mode; missing/invalid shared settings never launch development. */
export function parseSharedBrowserAppConfig(
  environment: Readonly<Record<string, string | undefined>>,
): SharedBrowserAppConfig | undefined {
  const mode = environment.QFLOW_BROWSER_APP_MODE;
  if (mode === undefined) return undefined;
  if (mode !== 'shared-built') throw new Error('Unknown QFLOW_BROWSER_APP_MODE.');
  const baseUrl = environment.QFLOW_BROWSER_APP_URL;
  const raw = environment.QFLOW_BROWSER_APP_ENV;
  if (!baseUrl || !raw) throw new Error('Shared built app URL and environment are required.');
  const parsedUrl = new URL(baseUrl);
  if (
    parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1' ||
    parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash ||
    parsedUrl.pathname !== '/' || !/^http:\/\/127\.0\.0\.1(?::[0-9]+)?\/?$/.test(baseUrl)
  ) {
    throw new Error('Shared built app must be an explicitly configured loopback HTTP endpoint.');
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Shared built app environment must be an object.');
  }
  const values: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error('Shared built app environment must contain strings.');
    }
    values.push([key, value]);
  }
  return { baseUrl: parsedUrl.origin, environment: Object.fromEntries(values) };
}

/** Rejects conflicting fixture configuration before reusing a shared server; values stay private. */
export function assertSharedBrowserEnvironment(
  shared: SharedBrowserAppConfig,
  requested: Readonly<Record<string, string>>,
): void {
  for (const [key, value] of Object.entries(requested)) {
    if (shared.environment[key] !== value) {
      throw new Error(`Shared built app fixture configuration differs for ${key}.`);
    }
  }
}
