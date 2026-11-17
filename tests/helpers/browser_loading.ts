import * as _fs from 'node:fs/promises';
import type { Page, Request, Response } from 'playwright';
import { safeErrorSummary } from '../../lib/error_summary.ts';
import type { BrowserEvidenceDirectory } from './browser_evidence.ts';

const WINDOW_LIMIT = 64;
const FAILURE_LIMIT = 16;
const ERROR_TYPES = [
  'Error',
  'TypeError',
  'SyntaxError',
  'ReferenceError',
  'RangeError',
  'DOMException',
];
const NETWORK_CODES = [
  'net::ERR_ABORTED',
  'net::ERR_INSUFFICIENT_RESOURCES',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_FAILED',
  'net::ERR_CACHE_READ_FAILURE',
  'net::ERR_NETWORK_CHANGED',
] as const;

type LoadingEvent = {
  readonly event: 'script_requested' | 'script_response' | 'script_failed' | 'pageerror';
  readonly elapsedMs: number;
  readonly phase: string;
  readonly path?: string;
  readonly status?: number;
  readonly networkCode?: string;
  readonly cause?: string;
};

/** Bounded first-failure and recent-event evidence; never includes query values or credentials. */
export type BrowserLoadingEvidence = {
  readonly snapshot: () => {
    readonly totalEvents: number;
    readonly firstFailures: readonly LoadingEvent[];
    readonly recentEvents: readonly LoadingEvent[];
  };
  readonly stop: () => void;
};

/** Observe real browser script delivery without changing loading, timeouts or retry behavior. */
export function observeBrowserLoading(
  page: Page,
  origin: string,
  phase: () => string,
): BrowserLoadingEvidence {
  const firstFailures: LoadingEvent[] = [];
  const recentEvents: LoadingEvent[] = [];
  const started = performance.now();
  let totalEvents = 0;
  function record(input: Omit<LoadingEvent, 'elapsedMs' | 'phase'>) {
    const event = { ...input, elapsedMs: Math.round(performance.now() - started), phase: phase() };
    totalEvents++;
    recentEvents.push(event);
    if (recentEvents.length > WINDOW_LIMIT) recentEvents.shift();
    // Navigation aborts remain in recent events; they cannot evict the first actual failures.
    if (
      ((event.event === 'script_failed' && event.networkCode !== 'net::ERR_ABORTED') ||
        event.event === 'pageerror' ||
        (event.event === 'script_response' && event.status !== undefined && event.status >= 400)) &&
      firstFailures.length < FAILURE_LIMIT
    ) firstFailures.push(event);
  }
  function path(url: string) {
    const parsed = new URL(url);
    return parsed.origin === origin ? parsed.pathname : '[external script]';
  }
  function requested(request: Request) {
    if (request.resourceType() === 'script') {
      record({ event: 'script_requested', path: path(request.url()) });
    }
  }
  function responded(response: Response) {
    if (response.request().resourceType() === 'script') {
      record({ event: 'script_response', path: path(response.url()), status: response.status() });
    }
  }
  function failed(request: Request) {
    if (request.resourceType() !== 'script') return;
    const code = request.failure()?.errorText;
    record({
      event: 'script_failed',
      path: path(request.url()),
      networkCode: NETWORK_CODES.find((known) => known === code) ?? '[other network failure]',
    });
  }
  function pageerror(cause: Error) {
    const summary = safeErrorSummary(cause);
    record({
      event: 'pageerror',
      cause: ERROR_TYPES.includes(summary) ? summary : '[other error type]',
    });
  }
  page.on('request', requested);
  page.on('response', responded);
  page.on('requestfailed', failed);
  page.on('pageerror', pageerror);
  return {
    snapshot: () => ({
      totalEvents,
      firstFailures: [...firstFailures],
      recentEvents: [...recentEvents],
    }),
    stop() {
      page.off('request', requested);
      page.off('response', responded);
      page.off('requestfailed', failed);
      page.off('pageerror', pageerror);
    },
  };
}

/** Preserve the original flow failure even if writing diagnostic evidence fails. */
export async function captureBrowserLoading(
  loading: BrowserLoadingEvidence,
  directory: BrowserEvidenceDirectory,
  prefix: string,
): Promise<void> {
  try {
    await _fs.writeFile(
      directory.path(`${prefix}-loading.json`),
      JSON.stringify(loading.snapshot(), null, 2) + '\n',
      'utf8',
    );
  } catch (cause: unknown) {
    console.error(JSON.stringify({
      event: 'browser_loading_evidence_unavailable',
      cause: safeErrorSummary(cause),
    }));
  }
}
