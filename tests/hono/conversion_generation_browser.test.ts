import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { startFetchServer } from '../helpers/fetch_server.ts';
import { safeErrorSummary } from '../../lib/error_summary.ts';

import { join } from 'node:path';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import { generationFailureMessage } from '../../islands/ConversionGeneration.tsx';

const assertStringIncludes = (actual: string, expected: string) => {
  if (!(actual.includes(expected))) {
    expect.unreachable('Expected generation fixture text was absent.');
  }
};

type GenerationFailureCode =
  | 'startFailed'
  | 'progressFailed'
  | 'failed'
  | 'timeout'
  | 'invalidDestination'
  | 'malformedResponse';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const pollScenarios = new Set<Scenario>([
  'poll-failure',
  'poll-network-failure',
  'poll-malformed',
  'terminal-failure',
]);
const expectedFailure: Readonly<Record<Exclude<Scenario, 'success'>, GenerationFailureCode>> = {
  'start-failure': 'startFailed',
  'start-network-failure': 'startFailed',
  'start-malformed': 'malformedResponse',
  'external': 'invalidDestination',
  'poll-failure': 'progressFailed',
  'poll-network-failure': 'progressFailed',
  'poll-malformed': 'malformedResponse',
  'terminal-failure': 'failed',
};
type BundleArtifact = {
  readonly temp: string;
  readonly out: string;
  readonly payload: I18nPayload;
};
const bundleCache = new Map<typeof locales[number], BundleArtifact>();
type Scenario =
  | 'success'
  | 'start-failure'
  | 'start-network-failure'
  | 'start-malformed'
  | 'poll-failure'
  | 'poll-network-failure'
  | 'poll-malformed'
  | 'terminal-failure'
  | 'external';

it('ConversionGeneration browser workflow is localized and safe', async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    for (const locale of locales) await runScenario(browser, locale, 'success');
    for (
      const scenario of [
        'start-failure',
        'start-network-failure',
        'start-malformed',
        'poll-failure',
        'poll-network-failure',
        'terminal-failure',
        'poll-malformed',
        'external',
      ] as const
    ) {
      for (const locale of locales) await runScenario(browser, locale, scenario);
    }
  } finally {
    await browser.close();
    for (const artifact of bundleCache.values()) {
      await rm(artifact.temp, { recursive: true, force: true });
    }
    bundleCache.clear();
  }
}, 180000);

async function runScenario(
  browser: import('playwright').Browser,
  locale: typeof locales[number],
  scenario: Scenario,
): Promise<void> {
  const artifact = await getBundle(locale);
  const { out, payload } = artifact;
  const i18n = createI18n(locale, payload.namespaces);
  let startRequests = 0;
  let documentRequests = 0;
  let pollRequests = 0;
  let submitted: unknown = null;
  let releaseStartGate: () => void = () => {};
  const startGate = new Promise<void>((resolve) => releaseStartGate = resolve);
  const server = await startFetchServer(async (request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') documentRequests += 1;
    if (url.pathname === '/api/imports/run-1/generate' && request.method === 'POST') {
      startRequests += 1;
      submitted = await request.json();
      if (scenario === 'start-failure') {
        return Response.json({ code: 'start_failed', error: 'HOSTILE' }, { status: 500 });
      }
      if (scenario === 'start-malformed') return Response.json({ nope: true });
      if (scenario === 'external') return Response.json({ pollUrl: 'https://evil.example/job' });
      await startGate;
      return Response.json({ pollUrl: '/api/imports/run-1/generate/jobs/job-1' });
    }
    if (url.pathname === '/api/imports/run-1/generate/jobs/job-1' && request.method === 'GET') {
      pollRequests += 1;
      if (scenario === 'poll-failure') {
        return Response.json({ error: 'HOSTILE-POLL' }, { status: 503 });
      }
      if (scenario === 'terminal-failure') {
        return Response.json({ status: 'failed', progress: 50, error: 'HOSTILE-TERMINAL' });
      }
      if (scenario === 'poll-malformed') {
        return Response.json({ status: 'running', progress: 'fifty' });
      }
      return pollRequests === 1
        ? Response.json({ status: 'running', progress: 50 })
        : Response.json({ status: 'completed', progress: 100 });
    }
    if (url.pathname === '/entry.js') {
      try {
        return new Response(await readFile(join(out, 'entry.js')), {
          headers: { 'content-type': 'text/javascript' },
        });
      } catch (_error) {
        return new Response('missing entry', { status: 404 });
      }
    }
    if (url.pathname.startsWith('/chunks/')) {
      try {
        return new Response(await readFile(join(out, url.pathname.slice(1))), {
          headers: { 'content-type': 'text/javascript' },
        });
      } catch (_error) {
        return new Response('missing chunk', { status: 404 });
      }
    }
    return new Response(
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
  });
  let page: import('playwright').Page | null = null;
  try {
    page = await browser.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(safeErrorSummary(error)));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        consoleErrors.push('Unexpected browser console error.');
      }
    });
    if (scenario === 'start-network-failure' || scenario === 'poll-network-failure') {
      await page.route('**/api/imports/run-1/generate**', (route) => {
        const request = route.request();
        const isStart = request.method() === 'POST';
        const shouldAbort = scenario === 'start-network-failure' ? isStart : !isStart;
        return shouldAbort ? route.abort() : route.continue();
      });
    }
    const origin = server.origin;
    await page.goto(`${origin}/?scenario=${scenario}`);
    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __runtimeErrors?: string[];
        __runtimeRejections?: string[];
      };
      state.__runtimeErrors = [];
      state.__runtimeRejections = [];
      addEventListener('error', () => state.__runtimeErrors?.push('BrowserError'));
      addEventListener('unhandledrejection', () => {
        state.__runtimeRejections?.push('UnhandledRejection');
      });
    });
    await page.getByRole('combobox', { name: i18n.t('imports.generation.mode') }).waitFor();
    const visibleText = await page.locator('body').innerText();
    for (
      const id of [
        'imports.generation.mode',
        'imports.generation.fast',
        'imports.generation.thorough',
        'imports.generation.generate',
        'imports.generation.policy',
        'imports.generation.policyLink',
        'imports.blueprint.learningOutcomes',
        'imports.blueprint.targets',
        'imports.blueprint.outcome',
        'imports.blueprint.weight',
        'imports.blueprint.cognitiveDemand',
        'imports.blueprint.difficulty',
        'imports.blueprint.questionType',
        'imports.blueprint.count',
      ] as const
    ) assertStringIncludes(visibleText, i18n.t(id));
    const outcomeInput = page.locator('fieldset').first().locator('input').first();
    await outcomeInput.fill('Éxito ✨');
    await page.getByRole('combobox', { name: i18n.t('imports.generation.mode') }).selectOption(
      'thorough',
    );
    const dispatchResult = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) throw new Error('production form missing');
      return form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    });
    expect(dispatchResult).toStrictEqual(false);
    if (pollScenarios.has(scenario)) releaseStartGate();
    if (scenario === 'success') {
      await page.getByRole('button', { name: i18n.t('imports.generation.starting') }).waitFor();
      expect(startRequests).toStrictEqual(1);
      const secondDispatch = await page.evaluate(() => {
        const form = document.querySelector('form');
        if (!form) throw new Error('production form missing');
        return form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
      });
      expect(secondDispatch).toStrictEqual(false);
      expect(startRequests).toStrictEqual(1);
      const reload = page.waitForNavigation({ waitUntil: 'load' });
      releaseStartGate();
      await page.getByText(i18n.t('imports.generation.progress', { value: 0.5 }), { exact: true })
        .waitFor();
      expect(pollRequests).toStrictEqual(1);
      expect(submitted).toStrictEqual({
        mode: 'thorough',
        blueprint: {
          _tag: 'Defined',
          version: 1,
          outcomes: [{ id: 'outcome-1', title: 'Éxito ✨', weight: 100 }],
          targets: [{
            id: 'target-1',
            outcomeId: 'outcome-1',
            count: 5,
            cognitiveDemand: 'understand',
            difficulty: 'medium',
            questionType: 'single_select',
          }],
        },
      });
      await reload;
      expect(documentRequests).toStrictEqual(2);
    } else {
      await page.getByRole('alert').waitFor();
      const text = await page.getByRole('alert').innerText();
      expect(text).toStrictEqual(generationFailureMessage(i18n, expectedFailure[scenario]));
      expect(text.includes('HOSTILE')).toStrictEqual(false);
      expect(text.includes('evil.example')).toStrictEqual(false);
      expect(text.includes('start_failed')).toStrictEqual(false);
    }
    expect(pageErrors).toStrictEqual([]);
    expect(consoleErrors).toStrictEqual([]);
    const runtimeErrors = await page.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __runtimeErrors?: string[];
        __runtimeRejections?: string[];
      };
      return { errors: state.__runtimeErrors ?? [], rejections: state.__runtimeRejections ?? [] };
    });
    expect(runtimeErrors).toStrictEqual({ errors: [], rejections: [] });
  } finally {
    await page?.close();
    releaseStartGate();
    await server.close();
    // Bundle artifacts are shared across scenarios and cleaned by the test owner.
  }
}

async function getBundle(locale: typeof locales[number]): Promise<BundleArtifact> {
  const cached = bundleCache.get(locale);
  if (cached) return cached;
  const temp = await mkdtemp(join(tmpdir(), 'qflow-conversion-generation-'));
  const out = join(temp, 'client');
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['imports']);
  try {
    const bundle = await build({
      stdin: {
        contents: browserEntrySource(JSON.stringify(payload)),
        resolveDir: process.cwd(),
        sourcefile: 'entry.tsx',
        loader: 'tsx',
      },
      bundle: true,
      format: 'esm',
      splitting: true,
      jsx: 'automatic',
      jsxImportSource: 'preact',
      entryNames: 'entry',
      chunkNames: 'chunks/[name]-[hash]',
      outdir: out,
      metafile: true,
      logLevel: 'silent',
    });
    if (!bundle.metafile) throw new Error('Generation fixture metadata was not emitted.');
    assertStringIncludes(JSON.stringify(bundle.metafile), 'ConversionGeneration.tsx');
    for (const input of Object.keys(bundle.metafile.inputs)) {
      expect(input.includes('lib/i18n/catalogs.ts')).toStrictEqual(false);
      expect(input.includes('lib/i18n/messages/')).toStrictEqual(false);
      expect(input.includes('lib/i18n/player_messages/')).toStrictEqual(false);
    }
    const result = { temp, out, payload } satisfies BundleArtifact;
    bundleCache.set(locale, result);
    return result;
  } catch (cause: unknown) {
    await rm(temp, { recursive: true, force: true });
    throw cause;
  }
}

function browserEntrySource(payload: string): string {
  return `
import { render } from 'preact';
import ConversionGeneration from './islands/ConversionGeneration.tsx';
import BlueprintPanel from './islands/BlueprintPanel.tsx';
const root = document.getElementById('root');
if (!root) throw new Error('Generation fixture root is missing.');
globalThis.unmountGeneration = () => render(null, root);
if (new URLSearchParams(location.search).get('surface') === 'blueprint') {
  render(<BlueprintPanel resource="conversion" resourceId="run-1" initialBlueprint={{_tag:'Unspecified',version:1}} payload={${payload}} />, root);
} else render(<ConversionGeneration runId="run-1" initialBlueprint={{_tag:'Unspecified',version:1}} payload={${payload}} />, root);
`;
}

declare global {
  var unmountGeneration: () => void;
}

it(
  'generation unmount aborts its pending start without polling or reloading the page',
  async () => {
    await checkEditorCancellation('generation');
  },
  15000,
);

it(
  'blueprint unmount aborts its pending save without reloading or changing another tree',
  async () => {
    await checkEditorCancellation('blueprint');
  },
  15000,
);

async function checkEditorCancellation(surface: 'generation' | 'blueprint'): Promise<void> {
  const { chromium } = await import('playwright');
  const artifact = await getBundle('en-US');
  let started = false;
  let aborted = false, polls = 0, documents = 0;
  const commandPath = surface === 'generation'
    ? '/api/imports/run-1/generate'
    : '/api/imports/run-1/blueprint';
  const server = await startFetchServer(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === commandPath) {
      started = true;
      await new Promise<void>((done) =>
        request.signal.addEventListener('abort', () => {
          aborted = true;
          done();
        }, { once: true })
      );
      return Response.json({
        pollUrl: '/api/imports/run-1/generate/jobs/job-1',
        blueprint: { _tag: 'Unspecified', version: 1 },
      });
    }
    if (path.includes('/generate/jobs/')) {
      polls += 1;
      return Response.json({ status: 'completed', progress: 100 });
    }
    if (path.endsWith('.js')) {
      return new Response(await readFile(join(artifact.out, path.slice(1))), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (path !== '/') return new Response(null, { status: 404 });
    documents += 1;
    return new Response(
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
  });
  let browser: import('playwright').Browser | undefined;
  try {
    browser = await chromium.launch();
    const page: import('playwright').Page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(server.origin + (surface === 'blueprint' ? '/?surface=blueprint' : '/'));
    await page.getByRole('button', {
      name: surface === 'generation' ? 'Generate questions' : 'Save plan',
      exact: true,
    }).click();
    await expect.poll(() => started, { timeout: 3000 }).toBe(true);
    await page.evaluate(() => globalThis.unmountGeneration());
    await expect.poll(() => aborted, { timeout: 3000 }).toBe(true);
    expect(polls).toBe(0);
    expect(documents).toBe(1);
    expect(
      await page.getByRole('button', {
        name: surface === 'generation' ? 'Generate questions' : 'Save plan',
        exact: true,
      }).count(),
    ).toBe(0);
  } finally {
    await browser?.close();
    await server.close();
    for (const bundle of bundleCache.values()) {
      await rm(bundle.temp, { recursive: true, force: true });
    }
    bundleCache.clear();
  }
}
