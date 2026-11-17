import { expect, test as testCase } from 'vitest';

import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import {
  batchId,
  canonicalUuid,
  type Capture,
  createSourceIntakeServer,
  locales,
  runId,
  type Scenario,
} from './helpers/source_intake_i18n_browser.ts';

testCase('source-intake browser workflow exercises requests, branches, and locale isolation', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tmp = await _fs.mkdtemp(_path.join(process.cwd(), '.source-intake-browser-'));
  const entry = `${tmp}/entry.ts`, output = `${tmp}/bundle.js`;
  await _fs.writeFile(
    entry,
    `
import { h, render } from 'preact';
import BringFilesIntake from '../islands/BringFilesIntake.tsx';
const root = document.getElementById('root');
window.renderIntake = (config) => render(h(BringFilesIntake, { destination: { _tag: 'Assessment' }, ...config }), root);
window.renderIntake(window.__INTAKE_CONFIG__);
`,
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
  if (!(built.success)) expect.unreachable(new TextDecoder().decode(built.stderr));
  const bundle = await _fs.readFile(output, 'utf8');
  for (
    const forbidden of [
      'catalogForLocale',
      'CATALOGS',
      'lib/i18n/messages/',
      'lib/i18n/catalogs.ts',
      'lib/i18n/player_messages/',
      'playerMessageCatalogForLocale',
      'en-US/imports',
      'es-ES/imports',
      'es-419/imports',
      'en-GB/imports',
    ]
  ) if (bundle.includes(forbidden)) expect.unreachable('Expected !bundle.includes(forbidden)');
  const captures: Capture[] = [];
  const navigations: Array<{ locale: InterfaceLocale; scenario: Scenario; pathname: string }> = [];
  const server = await createSourceIntakeServer(bundle, captures, navigations);
  const browser = await chromium.launch();
  try {
    let page = await browser.newPage();
    const errors: string[] = [], consoleErrors: string[] = [];
    const attachMonitoring = () => {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
    };
    attachMonitoring();
    const goto = async (url: string) => {
      errors.length = 0;
      consoleErrors.length = 0;
      await page.close();
      page = await browser.newPage();
      attachMonitoring();
      await page.goto(url);
    };
    const assertSafe = async (locale: InterfaceLocale) => {
      const body = await page.innerText('body');
      if (body.includes('imports.')) expect.unreachable("Expected !body.includes('imports.')");
      if (body.includes('{')) expect.unreachable("Expected !body.includes('{')");
      if (body.includes('HOSTILE_SERVER_PROSE')) {
        expect.unreachable("Expected !body.includes('HOSTILE_SERVER_PROSE')");
      }
      if (locale.startsWith('es-')) {
        for (
          const phrase of [
            'Check source',
            'Checking source',
            'Continue to review',
            'Retry',
            'Source format',
            'Choose how to start',
            'Recover existing',
            'Generate new',
            'Files',
            'Paste text',
            'Drop files here',
            'Check again',
            'Continue',
            'Preparing',
            'Detected format',
            'High confidence',
            'Source files',
            'Source text',
            'Drop files',
            'Continue to generate',
            'Cancel',
            'Confirm source',
            'Use this format',
            'Recover an existing assessment',
            'Generate a new assessment',
          ]
        ) {
          const escaped = phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
          if (new RegExp(`\\b${escaped}\\b`).test(body)) {
            expect.unreachable('Expected !new RegExp(`\\\\b${escaped}\\\\b`).test(body)');
          }
        }
      }
      expect(errors).toStrictEqual([]);
      expect(consoleErrors).toStrictEqual([]);
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_UNHANDLED__?: string[] })
            .__SOURCE_UNHANDLED__ ?? []
        ),
      ).toStrictEqual([]);
    };
    for (const locale of locales) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      await goto(
        `http://${'127.0.0.1'}:${server.port}/?locale=${locale}&scenario=resolved`,
      );
      await page.locator('#bring-source-files').setInputFiles({
        name: '<source Ω>.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(1234, 'P'),
      });
      const initialBody = await page.locator('body').innerText();
      for (
        const key of [
          'intentLegend',
          'sourceLegend',
          'filesMethod',
          'pasteMethod',
          'checkSource',
        ] as const
      ) expect(initialBody).toContain(i18n.t(`imports.intake.${key}`));
      expect(initialBody).toContain(
        i18n.t('imports.intake.recoverFileHelp', { files: 10, batchMiB: 16 }),
      );
      expect(await page.locator('input[name="source-method"][value="files"]').count())
        .toStrictEqual(1);
      expect(await page.locator('input[name="source-method"][value="paste"]').count())
        .toStrictEqual(1);
      expect(
        await page.locator('input[name="source-purpose"][value="recover_existing"]').isChecked(),
      ).toStrictEqual(true);
      expect(await page.locator('input[name="source-purpose"][value="generate_new"]').isChecked())
        .toStrictEqual(false);
      expect(initialBody).toContain('<source Ω>.pdf');
      expect(await page.getByText('<source Ω>.pdf', { exact: true }).count()).toStrictEqual(1);
      if (await page.locator('img').count()) {
        expect.unreachable("Expected !await page.locator('img').count()");
      }
      expect(await page.locator('body').innerText()).toContain(
        i18n.t('imports.intake.sizeKiB', { value: 1.2 }),
      );
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByText(i18n.t('imports.intake.detectedFormat')).waitFor();
      expect(await page.locator('body').innerText()).toContain(
        i18n.t('imports.intake.adapterLabel', { id: 'pdf' }),
      );
      const resolvedInspects = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'resolved' && capture.kind === 'inspect'
      );
      expect(resolvedInspects.length).toStrictEqual(1);
      expect(resolvedInspects[0]).toStrictEqual({
        locale,
        scenario: 'resolved',
        kind: 'inspect',
        purpose: 'recover_existing',
        files: [{
          name: '<source Ω>.pdf',
          type: 'application/pdf',
          size: 1234,
          text: 'P'.repeat(1234),
        }],
        adapters: [],
        key: null,
        text: null,
      });
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
            .__SOURCE_ATTEMPTS__?.inspect ?? 0
        ),
      ).toStrictEqual(1);
      const firstKey = await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
      if (!firstKey) expect.unreachable('Expected firstKey');
      await assertSafe(locale);
      await page.getByRole('button', { name: i18n.t('imports.intake.checkAgain') }).click();
      await page.waitForFunction(
        (previous) =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment') !== previous,
        firstKey,
      );
      const secondKey = await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
      if (!(firstKey !== secondKey)) expect.unreachable('Expected firstKey !== secondKey');
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).waitFor();
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
            .__SOURCE_ATTEMPTS__?.inspect ?? 0
        ),
      ).toStrictEqual(2);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'resolved'
        ),
      ).toStrictEqual([]);
      const resolvedInspectsAfterRetry = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'resolved' && capture.kind === 'inspect'
      );
      expect(resolvedInspectsAfterRetry.length).toStrictEqual(2);
      expect(resolvedInspectsAfterRetry[1]).toStrictEqual(resolvedInspectsAfterRetry[0]);
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
      await page.waitForFunction(() =>
        location.pathname === '/imports/00000000-0000-4000-8000-0000000000a2'
      );
      const resolvedExecutes = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'resolved' && capture.kind === 'execute'
      );
      expect(resolvedExecutes.length).toStrictEqual(1);
      expect(resolvedExecutes[0]).toStrictEqual({
        locale,
        scenario: 'resolved',
        kind: 'execute',
        purpose: 'recover_existing',
        files: [{
          name: '<source Ω>.pdf',
          type: 'application/pdf',
          size: 1234,
          text: 'P'.repeat(1234),
        }],
        adapters: [{ field: 'adapter-0', value: 'pdf@1' }],
        key: secondKey,
        text: null,
      });
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'resolved'
        ).map((navigation) => navigation.pathname),
      ).toStrictEqual(['/imports/00000000-0000-4000-8000-0000000000a2']);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        ),
      ).toStrictEqual(null);
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('__SOURCE_ATTEMPTS__') ?? '{}').execute
        ),
      ).toStrictEqual(1);
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('__SOURCE_ATTEMPTS__') ?? '{}').inspect
        ),
      ).toStrictEqual(2);
      expect(await page.locator('body').innerText().then((body) => body.includes('imports.')))
        .toStrictEqual(false);
      await assertSafe(locale);
    }
    for (const locale of locales) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      await goto(
        `http://${'127.0.0.1'}:${server.port}/?locale=${locale}&scenario=confirmation`,
      );
      await page.locator('#bring-source-files').setInputFiles({
        name: 'confirmation Ω.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('confirm'),
      });
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByText(i18n.t('imports.intake.reason.confirmationRequired')).waitFor();
      const confirmationInspects = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'confirmation' &&
        capture.kind === 'inspect'
      );
      expect(confirmationInspects.length).toStrictEqual(1);
      expect(confirmationInspects[0]).toStrictEqual({
        locale,
        scenario: 'confirmation',
        kind: 'inspect',
        purpose: 'recover_existing',
        files: [{
          name: 'confirmation Ω.pdf',
          type: 'application/pdf',
          size: 7,
          text: 'confirm',
        }],
        adapters: [],
        key: null,
        text: null,
      });
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
            .__SOURCE_ATTEMPTS__?.inspect ?? 0
        ),
      ).toStrictEqual(1);
      const confirmationBody = await page.locator('body').innerText();
      expect(confirmationBody).toContain(i18n.t('imports.intake.adapterLabel', { id: 'pdf' }));
      expect(confirmationBody).toContain(i18n.t('imports.intake.adapterLabel', { id: 'qti21' }));
      expect(confirmationBody).toContain(i18n.t('imports.intake.confidenceHigh'));
      expect(confirmationBody).toContain(i18n.t('imports.intake.confidenceLikely'));
      const continueReview = page.getByRole('button', {
        name: i18n.t('imports.intake.continueReview'),
      });
      await page.waitForFunction(() =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment') ?? '',
        )
      );
      const confirmationKeyBefore = await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
      expect(await continueReview.isDisabled()).toStrictEqual(true);
      expect(
        await page.locator('input[value="pdf@1"], input[value="qti21@1"]').evaluateAll(
          (inputs) => inputs.map((input) => (input as HTMLInputElement).value),
        ),
      ).toStrictEqual(['pdf@1', 'qti21@1']);
      await page.locator('input[value="qti21@1"]').check();
      await page.waitForFunction(
        (previous) => {
          const current =
            sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment') ?? '';
          return current !== previous &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(current);
        },
        confirmationKeyBefore,
      );
      const confirmationKey = await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
      if (!(confirmationKey && confirmationKey !== confirmationKeyBefore)) {
        expect.unreachable('Expected confirmationKey && confirmationKey !== confirmationKeyBefore');
      }
      expect(await continueReview.isDisabled()).toStrictEqual(false);
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { execute: number } })
            .__SOURCE_ATTEMPTS__?.execute ?? 0
        ),
      ).toStrictEqual(0);
      await assertSafe(locale);
      await continueReview.click();
      await page.waitForFunction(
        (expected) => location.pathname === expected,
        `/imports/${runId}`,
      );
      const confirmationExecutes = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'confirmation' &&
        capture.kind === 'execute'
      );
      expect(confirmationExecutes.length).toStrictEqual(1);
      expect(confirmationExecutes[0]).toStrictEqual({
        locale,
        scenario: 'confirmation',
        kind: 'execute',
        purpose: 'recover_existing',
        files: [{
          name: 'confirmation Ω.pdf',
          type: 'application/pdf',
          size: 7,
          text: 'confirm',
        }],
        adapters: [{ field: 'adapter-0', value: 'qti21@1' }],
        key: confirmationKey,
        text: null,
      });
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'confirmation'
        ).map((navigation) => navigation.pathname),
      ).toStrictEqual([`/imports/${runId}`]);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        ),
      ).toStrictEqual(null);
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('__SOURCE_ATTEMPTS__') ?? '{}')
        ),
      ).toStrictEqual({ inspect: 1, execute: 1 });
      await assertSafe(locale);

      await goto(
        `http://${'127.0.0.1'}:${server.port}/?locale=${locale}&scenario=unsupported`,
      );
      await page.locator('#bring-source-files').setInputFiles({
        name: 'unsupported Ω.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('unsupported'),
      });
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      const unsupportedInspect = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'unsupported' &&
        capture.kind === 'inspect'
      );
      expect(unsupportedInspect.length).toStrictEqual(1);
      expect(unsupportedInspect[0]).toStrictEqual({
        locale,
        scenario: 'unsupported',
        kind: 'inspect',
        purpose: 'recover_existing',
        files: [{
          name: 'unsupported Ω.pdf',
          type: 'application/pdf',
          size: 11,
          text: 'unsupported',
        }],
        adapters: [],
        key: null,
        text: null,
      });
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
            .__SOURCE_ATTEMPTS__?.inspect ?? 0
        ),
      ).toStrictEqual(1);
      await page.getByRole('button', { name: i18n.t('imports.intake.switchGenerate') }).click();
      expect(await page.locator('input[name="source-purpose"][value="generate_new"]').isChecked())
        .toStrictEqual(true);
      expect(await page.locator('body').innerText()).toContain(
        i18n.t('imports.intake.generateDescription'),
      );
      expect(await page.locator('body').innerText()).toContain('unsupported Ω.pdf');
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { execute: number } })
            .__SOURCE_ATTEMPTS__?.execute ?? 0
        ),
      ).toStrictEqual(0);
      expect(await page.locator('input[name="source-method"][value="files"]').isChecked())
        .toStrictEqual(true);
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
            .__SOURCE_ATTEMPTS__?.inspect ?? 0
        ),
      ).toStrictEqual(1);
      expect(
        captures.filter((capture) =>
          capture.locale === locale && capture.scenario === 'unsupported' &&
          capture.kind === 'inspect'
        ).length,
      ).toStrictEqual(1);
      expect(
        captures.filter((capture) =>
          capture.locale === locale && capture.scenario === 'unsupported' &&
          capture.kind === 'execute'
        ).length,
      ).toStrictEqual(0);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'unsupported'
        ),
      ).toStrictEqual([]);
      await assertSafe(locale);

      await goto(
        `http://${'127.0.0.1'}:${server.port}/?locale=${locale}&scenario=paste`,
      );
      await page.locator('input[name="source-purpose"][value="generate_new"]').check();
      await page.locator('input[name="source-method"][value="paste"]').check();
      const textarea = page.locator('textarea');
      expect(await textarea.getAttribute('maxlength')).toStrictEqual('12000');
      expect(await textarea.getAttribute('placeholder')).toStrictEqual(
        i18n.t('imports.intake.pasteGeneratePlaceholder'),
      );
      expect(await page.locator('body').innerText()).toContain(
        i18n.t('imports.intake.characterCount', { count: 0, limit: 12000 }),
      );
      const pastedText = '  Unicode Ω source  ';
      await textarea.fill(pastedText);
      expect(await page.locator('body').innerText()).toContain(
        i18n.t('imports.intake.characterCount', { count: pastedText.length, limit: 12000 }),
      );
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByRole('button', { name: i18n.t('imports.intake.continueGeneration') })
        .waitFor();
      const pasteCapture = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'paste' && capture.kind === 'inspect'
      );
      expect(pasteCapture.length).toStrictEqual(1);
      expect(pasteCapture[0]).toStrictEqual({
        locale,
        scenario: 'paste',
        kind: 'inspect',
        purpose: 'generate_new',
        files: [],
        adapters: [],
        key: null,
        text: pastedText,
      });
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
            .__SOURCE_ATTEMPTS__?.inspect ?? 0
        ),
      ).toStrictEqual(1);
      await assertSafe(locale);
      const pasteKeyBefore = await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
      if (!(pasteKeyBefore && canonicalUuid.test(pasteKeyBefore))) {
        expect.unreachable('Expected pasteKeyBefore && canonicalUuid.test(pasteKeyBefore)');
      }
      await page.getByRole('button', { name: i18n.t('imports.intake.continueGeneration') })
        .click();
      await page.waitForFunction(
        (expected) => location.pathname === expected,
        `/imports/${runId}`,
      );
      const pasteExecutes = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'paste' && capture.kind === 'execute'
      );
      expect(pasteExecutes.length).toStrictEqual(1);
      expect(pasteExecutes[0].key).toStrictEqual(pasteKeyBefore);
      expect(pasteExecutes[0]).toStrictEqual({
        locale,
        scenario: 'paste',
        kind: 'execute',
        purpose: 'generate_new',
        files: [],
        adapters: [{ field: 'adapter-0', value: 'pdf@1' }],
        key: pasteKeyBefore,
        text: pastedText,
      });
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('__SOURCE_ATTEMPTS__') ?? '{}')
        ),
      ).toStrictEqual({ inspect: 1, execute: 1 });
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        ),
      ).toStrictEqual(null);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'paste'
        ).map((navigation) => navigation.pathname),
      ).toStrictEqual([`/imports/${runId}`]);
      await assertSafe(locale);

      await goto(
        `http://${'127.0.0.1'}:${server.port}/?locale=${locale}&scenario=batch`,
      );
      await page.locator('#bring-source-files').setInputFiles([
        { name: 'one Ω.pdf', mimeType: 'application/pdf', buffer: Buffer.from('one') },
        { name: 'two Ω.pdf', mimeType: 'application/pdf', buffer: Buffer.from('two-two') },
      ]);
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByText(i18n.t('imports.intake.detectedFormat')).waitFor();
      const formatResults = page.locator('section[aria-labelledby="format-heading"]');
      expect(await formatResults.getByText('one Ω.pdf', { exact: true }).count()).toStrictEqual(1);
      expect(await formatResults.getByText('two Ω.pdf', { exact: true }).count()).toStrictEqual(1);
      const batchInspects = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'batch' && capture.kind === 'inspect'
      );
      expect(batchInspects.length).toStrictEqual(1);
      expect(batchInspects[0]).toStrictEqual({
        locale,
        scenario: 'batch',
        kind: 'inspect',
        purpose: 'recover_existing',
        files: [
          { name: 'one Ω.pdf', type: 'application/pdf', size: 3, text: 'one' },
          { name: 'two Ω.pdf', type: 'application/pdf', size: 7, text: 'two-two' },
        ],
        adapters: [],
        key: null,
        text: null,
      });
      expect(
        await page.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
            .__SOURCE_ATTEMPTS__?.inspect ?? 0
        ),
      ).toStrictEqual(1);
      const batchKey = await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
      if (!(batchKey && canonicalUuid.test(batchKey))) {
        expect.unreachable('Expected batchKey && canonicalUuid.test(batchKey)');
      }
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
      await page.waitForFunction(
        (expected) => location.pathname === expected,
        `/imports/batches/${batchId}`,
      );
      const batchExecutes = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'batch' && capture.kind === 'execute'
      );
      expect(batchExecutes.length).toStrictEqual(1);
      expect(batchExecutes[0]).toStrictEqual({
        locale,
        scenario: 'batch',
        kind: 'execute',
        purpose: 'recover_existing',
        files: [
          { name: 'one Ω.pdf', type: 'application/pdf', size: 3, text: 'one' },
          { name: 'two Ω.pdf', type: 'application/pdf', size: 7, text: 'two-two' },
        ],
        adapters: [
          { field: 'adapter-0', value: 'pdf@1' },
          { field: 'adapter-1', value: 'pdf@1' },
        ],
        key: batchKey,
        text: null,
      });
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('__SOURCE_ATTEMPTS__') ?? '{}')
        ),
      ).toStrictEqual({ inspect: 1, execute: 1 });
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        ),
      ).toStrictEqual(null);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'batch'
        ).map((navigation) => navigation.pathname),
      ).toStrictEqual([`/imports/batches/${batchId}`]);
      await assertSafe(locale);
    }
    expect(errors).toStrictEqual([]);
    expect(consoleErrors).toStrictEqual([]);
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tmp, { recursive: true });
  }
});
