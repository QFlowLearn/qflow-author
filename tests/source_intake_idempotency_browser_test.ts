import { expect, test as testCase } from 'vitest';

import type { FetchFixtureServer } from './helpers/fetch_server.ts';
import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const BATCH = '00000000-0000-4000-8000-0000000000a1';
const RUN = '00000000-0000-4000-8000-0000000000a2';
const RUN2 = '00000000-0000-4000-8000-0000000000a3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Scenario =
  | 'single'
  | 'hold-inspect'
  | 'hold-execute'
  | 'confirmation'
  | 'batch'
  | 'generation-batch'
  | 'conflict-retry'
  | 'lifecycle';
type Capture = {
  scenario: Scenario;
  kind: 'inspect' | 'execute';
  purpose: string;
  files: Array<{ name: string; type: string; size: number; text: string }>;
  adapters: Array<{ field: string; value: string }>;
  key: string | null;
  text: string | null;
  formIdempotencyValues: string[];
};

const capturesFor = (captures: Capture[], scenario: Scenario, kind: Capture['kind']) =>
  captures.filter((capture) => capture.scenario === scenario && capture.kind === kind);

testCase('source-intake browser harness captures request-scoped multipart contracts', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let tmp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>> | null =
    null;
  const captures: Capture[] = [];
  const navigations: Array<{ scenario: Scenario; pathname: string }> = [];
  const gates = new Map<
    string,
    {
      promise: Promise<void>;
      entered: Promise<void>;
      markEntered: () => void;
      release: () => void;
    }
  >();
  try {
    tmp = await _fs.mkdtemp(_path.join(process.cwd(), '.source-intake-idempotency-'));
    const entry = `${tmp}/entry.ts`, output = `${tmp}/bundle.js`;
    await _fs.writeFile(
      entry,
      `import {h,render} from 'preact';import Intake from '../islands/BringFilesIntake.tsx';render(h(Intake,window.cfg),document.querySelector('#root'));`,
      'utf8',
    );
    const built = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=esm',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      `--outfile=${output}`,
    ], { cwd: process.cwd() });
    if (!(built.success)) expect.unreachable('Expected built.success');
    const bundle = await _fs.readFile(output, 'utf8');
    for (
      const forbidden of [
        'catalogForLocale',
        'CATALOGS',
        'lib/i18n/messages/',
        'playerMessageCatalogForLocale',
      ]
    ) {
      if (bundle.includes(forbidden)) {
        expect.unreachable('Expected !bundle.includes(forbidden)');
      }
    }
    const mode = (r: Request): Scenario =>
      (new URL(r.headers.get('referer') ?? 'http://x/?scenario=single')).searchParams.get(
        'scenario',
      ) as Scenario ?? 'single';
    const gate = (scenario: Scenario, operation: 'inspect' | 'execute') => {
      const name = `${scenario}:${operation}`;
      let release!: () => void;
      let markEntered!: () => void;
      const promise = new Promise<void>((resolve) => release = resolve);
      const entered = new Promise<void>((resolve) => markEntered = resolve);
      const value = { promise, entered, markEntered, release };
      gates.set(name, value);
      return value;
    };
    server = await startFetchServer(async (r) => {
      const u = new URL(r.url);
      if (u.pathname === '/bundle.js') {
        return new Response(bundle, { headers: { 'content-type': 'text/javascript' } });
      }
      const s = mode(r);
      if (u.pathname.startsWith('/imports/')) {
        navigations.push({ scenario: s, pathname: u.pathname });
        return new Response('redirect target', { headers: { 'content-type': 'text/plain' } });
      }
      if (u.pathname.endsWith('/inspect')) {
        const f = await r.formData();
        const files = await Promise.all(
          f.getAll('files').filter((v): v is File => v instanceof File).map(async (x) => ({
            name: x.name,
            type: x.type,
            size: x.size,
            text: await x.text(),
          })),
        );
        captures.push({
          scenario: s,
          kind: 'inspect',
          purpose: String(f.get('purpose') ?? ''),
          files,
          adapters: [...f.entries()].filter(([k]) => k.startsWith('adapter-')).map((
            [field, v],
          ) => ({ field, value: String(v) })),
          key: null,
          text: typeof f.get('text') === 'string' ? String(f.get('text')) : null,
          formIdempotencyValues: f.getAll('idempotency-key').map(String),
        });
        if (s === 'hold-inspect') {
          const held = gates.get(`${s}:inspect`);
          held?.markEntered();
          await held?.promise;
        }
        const purpose = String(f.get('purpose') ?? 'recover_existing');
        if (s === 'confirmation' || files.some((file) => file.name === 'confirm.pdf')) {
          const confirmation = JSON.stringify({
            purpose,
            inspections: [{
              _tag: 'confirmation_required',
              sourceName: files[0]?.name ?? 'source',
              code: 'confirmation_required',
              message: 'Confirm the source format before continuing.',
              candidates: [{
                adapter: { id: 'pdf', version: '1' },
                label: 'PDF',
                confidence: .9,
                reason: 'file_type',
              }, {
                adapter: { id: 'qti21', version: '1' },
                label: 'QTI 2.1',
                confidence: .8,
                reason: 'content_match',
              }],
            }],
          });
          return new Response(confirmation, {
            headers: {
              'content-type': 'application/json',
              'content-length': String(new TextEncoder().encode(confirmation).length),
            },
          });
        }
        const count = s === 'batch' ? 2 : 1;
        const inspectionSources = s === 'batch' ? files : [files[0]];
        return Response.json({
          purpose,
          inspections: Array.from({ length: count }, (_, index) => ({
            _tag: 'resolved',
            sourceName: inspectionSources[index]?.name ?? 'source',
            candidate: {
              adapter: { id: 'pdf', version: '1' },
              label: 'PDF',
              confidence: 1,
              reason: 'file_type',
            },
          })),
        });
      }
      if (u.pathname.endsWith('/execute')) {
        const f = await r.formData();
        const files = await Promise.all(
          f.getAll('files').filter((v): v is File => v instanceof File).map(async (x) => ({
            name: x.name,
            type: x.type,
            size: x.size,
            text: await x.text(),
          })),
        );
        captures.push({
          scenario: s,
          kind: 'execute',
          purpose: String(f.get('purpose') ?? ''),
          files,
          adapters: [...f.entries()].filter(([k]) => k.startsWith('adapter-')).map((
            [field, v],
          ) => ({ field, value: String(v) })),
          key: r.headers.get('idempotency-key'),
          text: typeof f.get('text') === 'string' ? String(f.get('text')) : null,
          formIdempotencyValues: f.getAll('idempotency-key').map(String),
        });
        if (s === 'hold-execute' || files.some((file) => file.name === 'execute.pdf')) {
          const held = gates.get(`${s}:execute`);
          held?.markEntered();
          await held?.promise;
        }
        if (
          s === 'conflict-retry' && capturesFor(captures, s, 'execute').length === 1
        ) return Response.json({ code: 'conflict' }, { status: 409 });
        const many = s === 'batch' || s === 'generation-batch';
        const purpose = String(f.get('purpose') ?? 'recover_existing');
        return Response.json({
          purpose,
          batchId: BATCH,
          runIds: many ? [RUN, RUN2] : [RUN],
          statusUrl: `/imports/batches/${BATCH}`,
          redirectTo: many ? `/imports/batches/${BATCH}` : `/imports/${RUN}`,
        });
      }
      const locale = (u.searchParams.get('locale') ?? 'en-US') as
        | 'en-US'
        | 'en-GB'
        | 'es-ES'
        | 'es-419';
      const cfg = {
        destination: { _tag: 'Assessment' as const },
        initialPurpose: 'recover_existing' as const,
        payload: createI18nPayload(locale, catalogForLocale(locale), ['imports']),
      };
      return new Response(
        `<!doctype html><html lang="${locale}"><body><div id="root"></div><script>globalThis.__SOURCE_UNHANDLED__=[];addEventListener('unhandledrejection',e=>globalThis.__SOURCE_UNHANDLED__.push(String(e.reason??'')));window.cfg=${
          JSON.stringify(cfg).replaceAll('<', '\\u003c')
        }</script><script type="module" src="/bundle.js"></script></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
    browser = await chromium.launch();
    page = await browser.newPage();
    const activePage = page,
      base = `http://${'127.0.0.1'}:${server.port}`,
      i18n = createI18n('en-US', catalogForLocale('en-US'));
    const pageErrors: string[] = [], consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const open = async (s: Scenario, purpose?: string) => {
      await activePage.goto(`${base}/?locale=en-US&scenario=${s}`);
      if (purpose) {
        await activePage.locator(`input[name="source-purpose"][value="${purpose}"]`).check();
      }
    };
    const file = (name: string, text: string) =>
      activePage.locator('#bring-source-files').setInputFiles({
        name,
        mimeType: 'application/pdf',
        buffer: Buffer.from(text),
      });
    const storageKey = () =>
      activePage.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
    const waitForCanonicalKey = (previous?: string | null) =>
      activePage.waitForFunction((oldKey) => {
        const value = sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment');
        const canonical = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        return Boolean(value && canonical.test(value) && (!oldKey || value !== oldKey));
      }, previous ?? null);
    const freshOpen = async (s: Scenario, purpose?: string) => {
      await open(s);
      await activePage.evaluate(() =>
        sessionStorage.removeItem('qflow.source-intake.submission-key.v2:assessment')
      );
      await activePage.reload();
      await waitForCanonicalKey();
      if (purpose) {
        await activePage.locator(`input[name="source-purpose"][value="${purpose}"]`).check();
      }
    };
    await open('hold-inspect');
    await file('held.pdf', 'held');
    const g = gate('hold-inspect', 'inspect'),
      check = page.getByRole('button', { name: i18n.t('imports.intake.checkSource') });
    await check.evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await g.entered;
    expect(capturesFor(captures, 'hold-inspect', 'inspect').length).toStrictEqual(1);
    expect(capturesFor(captures, 'hold-inspect', 'inspect')[0]).toStrictEqual({
      scenario: 'hold-inspect',
      kind: 'inspect',
      purpose: 'recover_existing',
      files: [{ name: 'held.pdf', type: 'application/pdf', size: 4, text: 'held' }],
      adapters: [],
      key: null,
      text: null,
      formIdempotencyValues: [],
    });
    const checking = page.getByRole('button', {
      name: i18n.t('imports.intake.checking'),
    });
    await checking.waitFor({ state: 'attached' });
    expect(await checking.isDisabled()).toStrictEqual(true);
    g.release();
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).waitFor();
    expect(capturesFor(captures, 'hold-inspect', 'inspect').length).toStrictEqual(1);
    await open('single');
    await file('single.pdf', 'single');
    await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).waitFor();
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
    await page.waitForFunction((run) => location.pathname === `/imports/${run}`, RUN);
    expect(captures.at(-1)?.key ?? '').toMatch(UUID);
    await open('hold-execute');
    await file('execute.pdf', 'execute');
    await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
    const continueButton = page.getByRole('button', {
      name: i18n.t('imports.intake.continueReview'),
    });
    await continueButton.waitFor();
    const executeGate = gate('hold-execute', 'execute');
    await continueButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await executeGate.entered;
    const heldExecutes = capturesFor(captures, 'hold-execute', 'execute');
    expect(heldExecutes.length).toStrictEqual(1);
    expect(heldExecutes[0].purpose).toStrictEqual('recover_existing');
    expect(heldExecutes[0].files).toStrictEqual([{
      name: 'execute.pdf',
      type: 'application/pdf',
      size: 7,
      text: 'execute',
    }]);
    expect(heldExecutes[0].adapters).toStrictEqual([{ field: 'adapter-0', value: 'pdf@1' }]);
    expect(heldExecutes[0].key ?? '').toMatch(UUID);
    expect(heldExecutes[0].text).toStrictEqual(null);
    expect(heldExecutes[0].formIdempotencyValues).toStrictEqual([]);
    const heldKey = await page.evaluate(() =>
      sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
    );
    expect(heldKey ?? '').toMatch(UUID);
    expect(heldExecutes[0].key).toStrictEqual(heldKey);
    if (
      !(await page.getByRole('button', { name: i18n.t('imports.intake.preparing') }).isDisabled())
    ) {
      expect.unreachable(
        "Expected await page.getByRole('button', { name: i18n.t('imports.intake.preparing') }).isDisabled()",
      );
    }
    executeGate.release();
    await page.waitForFunction((run) => location.pathname === `/imports/${run}`, RUN);
    expect(capturesFor(captures, 'hold-execute', 'execute')).toStrictEqual(heldExecutes);
    expect(navigations.filter((navigation) => navigation.scenario === 'hold-execute'))
      .toStrictEqual([
        { scenario: 'hold-execute', pathname: `/imports/${RUN}` },
      ]);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      ),
    ).toStrictEqual(null);
    await freshOpen('lifecycle');
    const initialLifecycleKey = await storageKey();
    expect(initialLifecycleKey ?? '').toMatch(UUID);
    await file('first.pdf', 'first');
    await activePage.evaluate(() =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    const firstFileKey = await storageKey();
    expect(firstFileKey ?? '').toMatch(UUID);
    await file('second.pdf', 'second');
    await waitForCanonicalKey(initialLifecycleKey);
    const secondFileKey = await storageKey();
    expect(secondFileKey ?? '').toMatch(UUID);
    await page.locator('input[name="source-purpose"][value="generate_new"]').check();
    await waitForCanonicalKey(secondFileKey);
    const generationKey = await storageKey();
    expect(generationKey ?? '').toMatch(UUID);
    await page.locator('input[name="source-method"][value="paste"]').check();
    await waitForCanonicalKey(generationKey);
    const pasteKey = await storageKey();
    expect(pasteKey ?? '').toMatch(UUID);
    await page.locator('input[name="source-method"][value="files"]').check();
    await file('lifecycle.pdf', 'lifecycle');
    await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
    await page.getByRole('button', { name: i18n.t('imports.intake.continueGeneration') })
      .waitFor();
    const beforeCheckAgain = await storageKey();
    await page.getByRole('button', { name: i18n.t('imports.intake.checkAgain') }).click();
    await waitForCanonicalKey(beforeCheckAgain);
    expect(await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).count())
      .toStrictEqual(1);
    expect(
      await page.getByRole('button', { name: i18n.t('imports.intake.continueGeneration') })
        .count(),
    ).toStrictEqual(0);
    await freshOpen('confirmation');
    await file('confirm.pdf', 'confirm');
    await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
    const confirmationContinue = page.getByRole('button', {
      name: i18n.t('imports.intake.continueReview'),
    });
    await confirmationContinue.waitFor();
    expect(await confirmationContinue.isDisabled()).toStrictEqual(true);
    const beforeConfirmationSelection = await storageKey();
    const secondCandidate = activePage.locator('input[type="radio"][value="qti21@1"]');
    await secondCandidate.check();
    await waitForCanonicalKey(beforeConfirmationSelection);
    expect(await secondCandidate.isChecked()).toStrictEqual(true);
    expect(await confirmationContinue.isDisabled()).toStrictEqual(false);
    const confirmationKey = await storageKey();
    expect(confirmationKey ?? '').toMatch(UUID);
    await confirmationContinue.click();
    await page.waitForFunction((run) => location.pathname === `/imports/${run}`, RUN);
    const confirmationExecutes = capturesFor(captures, 'confirmation', 'execute');
    expect(confirmationExecutes).toStrictEqual([{
      scenario: 'confirmation',
      kind: 'execute',
      purpose: 'recover_existing',
      files: [{ name: 'confirm.pdf', type: 'application/pdf', size: 7, text: 'confirm' }],
      adapters: [{ field: 'adapter-0', value: 'qti21@1' }],
      key: confirmationKey,
      text: null,
      formIdempotencyValues: [],
    }]);
    expect(navigations.filter((navigation) => navigation.scenario === 'confirmation'))
      .toStrictEqual([{ scenario: 'confirmation', pathname: `/imports/${RUN}` }]);
    expect(await storageKey()).toStrictEqual(null);
    await freshOpen('conflict-retry');
    await file('conflict.pdf', 'conflict');
    await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).waitFor();
    const conflictKey = await storageKey();
    expect(conflictKey ?? '').toMatch(UUID);
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toStrictEqual(
      i18n.t('imports.intake.error.conflict'),
    );
    expect(new URL(page.url()).pathname).toStrictEqual('/');
    expect(await storageKey()).toStrictEqual(conflictKey);
    expect(await capturesFor(captures, 'conflict-retry', 'execute').length).toStrictEqual(1);
    const firstConflictCapture = capturesFor(captures, 'conflict-retry', 'execute')[0];
    expect(firstConflictCapture).toStrictEqual({
      scenario: 'conflict-retry',
      kind: 'execute',
      purpose: 'recover_existing',
      files: [{ name: 'conflict.pdf', type: 'application/pdf', size: 8, text: 'conflict' }],
      adapters: [{ field: 'adapter-0', value: 'pdf@1' }],
      key: conflictKey,
      text: null,
      formIdempotencyValues: [],
    });
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
    await page.waitForFunction((run) => location.pathname === `/imports/${run}`, RUN);
    const conflictCaptures = capturesFor(captures, 'conflict-retry', 'execute');
    expect(conflictCaptures.length).toStrictEqual(2);
    expect(conflictCaptures[1]).toStrictEqual(conflictCaptures[0]);
    expect(navigations.filter((navigation) => navigation.scenario === 'conflict-retry'))
      .toStrictEqual([{ scenario: 'conflict-retry', pathname: `/imports/${RUN}` }]);
    expect(await storageKey()).toStrictEqual(null);
    await freshOpen('batch');
    await page.locator('#bring-source-files').setInputFiles([
      { name: 'one.pdf', mimeType: 'application/pdf', buffer: Buffer.from('one') },
      { name: 'two.pdf', mimeType: 'application/pdf', buffer: Buffer.from('two') },
    ]);
    await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).waitFor();
    const formatSection = page.locator('section[aria-labelledby="format-heading"]');
    expect(await formatSection.getByText('one.pdf', { exact: true }).count()).toStrictEqual(1);
    expect(await formatSection.getByText('two.pdf', { exact: true }).count()).toStrictEqual(1);
    const formatText = await formatSection.innerText();
    const adapterText = i18n.t('imports.intake.adapterLabel', { id: 'pdf' });
    expect(formatText.split(adapterText).length - 1).toStrictEqual(2);
    expect(capturesFor(captures, 'batch', 'inspect')).toStrictEqual([{
      scenario: 'batch',
      kind: 'inspect',
      purpose: 'recover_existing',
      files: [
        { name: 'one.pdf', type: 'application/pdf', size: 3, text: 'one' },
        { name: 'two.pdf', type: 'application/pdf', size: 3, text: 'two' },
      ],
      adapters: [],
      key: null,
      text: null,
      formIdempotencyValues: [],
    }]);
    const batchKey = await storageKey();
    expect(batchKey ?? '').toMatch(UUID);
    await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
    await page.waitForFunction(
      (batch) => location.pathname === `/imports/batches/${batch}`,
      BATCH,
    );
    expect(capturesFor(captures, 'batch', 'execute')).toStrictEqual([{
      scenario: 'batch',
      kind: 'execute',
      purpose: 'recover_existing',
      files: [
        { name: 'one.pdf', type: 'application/pdf', size: 3, text: 'one' },
        { name: 'two.pdf', type: 'application/pdf', size: 3, text: 'two' },
      ],
      adapters: [
        { field: 'adapter-0', value: 'pdf@1' },
        { field: 'adapter-1', value: 'pdf@1' },
      ],
      key: batchKey,
      text: null,
      formIdempotencyValues: [],
    }]);
    expect(navigations.filter((navigation) => navigation.scenario === 'batch')).toStrictEqual([{
      scenario: 'batch',
      pathname: `/imports/batches/${BATCH}`,
    }]);
    expect(await storageKey()).toStrictEqual(null);
    await freshOpen('generation-batch', 'generate_new');
    await file('generation.pdf', 'generation');
    await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
    await page.getByRole('button', { name: i18n.t('imports.intake.continueGeneration') })
      .waitFor();
    expect(capturesFor(captures, 'generation-batch', 'inspect')).toStrictEqual([{
      scenario: 'generation-batch',
      kind: 'inspect',
      purpose: 'generate_new',
      files: [{ name: 'generation.pdf', type: 'application/pdf', size: 10, text: 'generation' }],
      adapters: [],
      key: null,
      text: null,
      formIdempotencyValues: [],
    }]);
    const generationBatchKey = await storageKey();
    expect(generationBatchKey ?? '').toMatch(UUID);
    await page.getByRole('button', { name: i18n.t('imports.intake.continueGeneration') }).click();
    await page.waitForFunction(
      (batch) => location.pathname === `/imports/batches/${batch}`,
      BATCH,
    );
    expect(capturesFor(captures, 'generation-batch', 'execute')).toStrictEqual([{
      scenario: 'generation-batch',
      kind: 'execute',
      purpose: 'generate_new',
      files: [{ name: 'generation.pdf', type: 'application/pdf', size: 10, text: 'generation' }],
      adapters: [{ field: 'adapter-0', value: 'pdf@1' }],
      key: generationBatchKey,
      text: null,
      formIdempotencyValues: [],
    }]);
    expect(new URL(page.url()).pathname).toStrictEqual(`/imports/batches/${BATCH}`);
    expect(navigations.filter((navigation) => navigation.scenario === 'generation-batch'))
      .toStrictEqual([{ scenario: 'generation-batch', pathname: `/imports/batches/${BATCH}` }]);
    expect(await storageKey()).toStrictEqual(null);
    expect(pageErrors).toStrictEqual([]);
    expect(consoleErrors.filter((message) => !message.includes('status of 409 (Conflict)')))
      .toStrictEqual([]);
    expect(
      await page.evaluate(() =>
        (globalThis as typeof globalThis & { __SOURCE_UNHANDLED__?: string[] })
          .__SOURCE_UNHANDLED__ ?? []
      ),
    ).toStrictEqual([]);
  } finally {
    for (const x of gates.values()) x.release();
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    if (tmp) await _fs.rm(tmp, { recursive: true }).catch(() => undefined);
  }
});
