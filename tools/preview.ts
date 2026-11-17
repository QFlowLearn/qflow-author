import { startBuiltAppServer } from './built_app_server.ts';
import {
  assertSingleLocalEnvironment,
  LocalConfigurationError,
  parseLocalConfig,
} from './local_config.ts';
import { safeErrorSummary } from '../lib/error_summary.ts';
/** Preview the production bundle through the same owned, untrusted local ingress used by browser QA. */
export async function preview(): Promise<void> {
  assertSingleLocalEnvironment();
  const config = parseLocalConfig(process.env);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.DATABASE_URL = config.databaseUrl;
  const cancelled = new AbortController();
  let done: () => void = () => {};
  const cancellation = new Promise<void>((resolve) => {
    done = resolve;
  });
  const cancel = () => {
    cancelled.abort();
    done();
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const app = await startBuiltAppServer({
      cwd: process.cwd(),
      port: Number(config.listenOrigin.port),
      environment,
      mode: 'development',
      signal: cancelled.signal,
    });
    try {
      console.log(`Built Worker preview: ${config.origin.origin} (listener: ${app.baseUrl})`);
      await Promise.race([
        cancellation,
        app.exited.then(() => {
          throw Error('Preview Worker exited.');
        }),
      ]);
    } finally {
      await app.close();
    }
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
if (import.meta.main) {
  try {
    if (process.argv.length !== 2) {
      throw new LocalConfigurationError(
        'Use pnpm preview without arguments. It uses the development database and origin.',
      );
    }
    await preview();
  } catch (cause: unknown) {
    console.error(
      cause instanceof LocalConfigurationError
        ? cause.message
        : `Preview failed: ${
          safeErrorSummary(cause)
        }. Run pnpm run doctor and pnpm build; stop pnpm dev before previewing.`,
    );
    process.exitCode = 1;
  }
}
