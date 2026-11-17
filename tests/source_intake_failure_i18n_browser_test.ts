import { expect, test as testCase } from 'vitest';

import type { FetchFixtureServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { createSourceIntakeFailureServer } from './helpers/source_intake_failure_server.ts';
import {
  bodyFor,
  type Capture,
  codes,
  hostile,
  locales,
  malformedBody,
  type Scenario,
} from './helpers/source_intake_failure_cases.ts';
import {
  parseSourceIntakeFailureEnvelope,
  sourceIntakeFailureMessage,
} from '../islands/BringFilesIntake.tsx';
import {
  captureCount as countCaptures,
  capturesFor as capturesForList,
  expectedCapture as makeExpectedCapture,
} from './helpers/source_intake_failure_assertions.ts';

testCase('source-intake browser failures use closed localized contracts', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  let tmp: string | null = null;
  let server: FetchFixtureServer | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>> | null =
    null;
  const captures: Capture[] = [];
  const navigations: Array<{ locale: InterfaceLocale; scenario: Scenario; pathname: string }> = [];
  const executeAttempts = new Map<string, number>();
  const inspectAttempts = new Map<string, number>();
  const pageErrors: string[] = [], consoleErrors: string[] = [];
  const captureCount = (locale: InterfaceLocale, scenario: Scenario, kind: Capture['kind']) =>
    countCaptures(captures, locale, scenario, kind);
  const capturesFor = (locale: InterfaceLocale, scenario: Scenario, kind: Capture['kind']) =>
    capturesForList(captures, locale, scenario, kind);
  const expectedCapture = makeExpectedCapture;
  try {
    tmp = await _fs.mkdtemp(_path.join(process.cwd(), '.source-intake-failure-'));
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
      const marker of [
        'catalogForLocale',
        'CATALOGS',
        'lib/i18n/messages/',
        'playerMessageCatalogForLocale',
      ]
    ) if (bundle.includes(marker)) expect.unreachable('Expected !bundle.includes(marker)');
    server = await createSourceIntakeFailureServer(
      bundle,
      captures,
      navigations,
      executeAttempts,
      inspectAttempts,
    );
    browser = await chromium.launch();
    page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' && !message.text().includes('status of 4') &&
        !message.text().includes('status of 5')
      ) {
        consoleErrors.push(message.text());
      }
    });
    const base = `http://${'127.0.0.1'}:${server.port}`;
    const pageAttempts = async (kind: Capture['kind']) =>
      await page!.evaluate((operation) =>
        (globalThis as typeof globalThis & {
          __SOURCE_ATTEMPTS__?: Record<string, number>;
        }).__SOURCE_ATTEMPTS__?.[operation] ?? 0, kind);
    const assertSafe = async (locale: InterfaceLocale) => {
      const rendered = await page!.locator('body').innerText();
      if (rendered.includes(hostile)) {
        expect.unreachable('Expected !rendered.includes(hostile)');
      }
      if (rendered.includes('imports.')) {
        expect.unreachable("Expected !rendered.includes('imports.')");
      }
      if (rendered.includes('{')) expect.unreachable("Expected !rendered.includes('{')");
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
            'Check source',
            'Source files',
            'Source text',
            'Drop files',
            'Check again',
            'Continue to review',
            'Continue to generate',
            'Cancel',
            'Confirm source',
            'Use this format',
            'Recover an existing assessment',
            'Generate a new assessment',
          ]
        ) {
          if (
            new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`).test(
              rendered,
            )
          ) expect.unreachable(`Spanish leaked phrase: ${phrase}`);
        }
      }
      expect(pageErrors).toStrictEqual([]);
      expect(consoleErrors).toStrictEqual([]);
      expect(
        await page!.evaluate(() =>
          (globalThis as typeof globalThis & { __SOURCE_UNHANDLED__?: string[] })
            .__SOURCE_UNHANDLED__ ?? []
        ),
      ).toStrictEqual([]);
    };
    for (const locale of locales) {
      const i18n = createI18n(locale, catalogForLocale(locale));
      for (const code of codes) {
        await page.goto(`${base}/?locale=${locale}&scenario=${code}`);
        await page.locator('#bring-source-files').setInputFiles({
          name: 'failure Ω.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('source'),
        });
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
        const alert = page.getByRole('alert');
        await alert.waitFor();
        const parsed = parseSourceIntakeFailureEnvelope(bodyFor(code));
        if (!parsed) expect.unreachable('Expected parsed');
        expect(await alert.textContent()).toStrictEqual(sourceIntakeFailureMessage(i18n, parsed));
        expect(captureCount(locale, code, 'inspect')).toStrictEqual(1);
        expect(await pageAttempts('inspect')).toStrictEqual(1);
        expect(capturesFor(locale, code, 'inspect')[0]).toStrictEqual(
          expectedCapture(locale, code, 'inspect', 'failure Ω.pdf', 'source'),
        );
        const rendered = await page.locator('body').innerText();
        if (rendered.includes(hostile)) {
          expect.unreachable('Expected !rendered.includes(hostile)');
        }
        if (rendered.includes('imports.')) {
          expect.unreachable("Expected !rendered.includes('imports.')");
        }
        if (rendered.includes('{')) expect.unreachable("Expected !rendered.includes('{')");
        await assertSafe(locale);
        if (locale.startsWith('es-')) {
          for (
            const formerEnglish of [
              'Check source',
              'Checking source',
              'Continue to review',
              'Retry',
            ]
          ) {
            if (rendered.includes(formerEnglish)) {
              expect.unreachable('Expected !rendered.includes(formerEnglish)');
            }
          }
        }
      }
      for (const scenario of ['malformed', 'invalid-json'] as const) {
        await page.goto(`${base}/?locale=${locale}&scenario=${scenario}`);
        await page.locator('#bring-source-files').setInputFiles({
          name: 'retry Ω.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('retry'),
        });
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
        await page.getByRole('alert').waitFor();
        expect(await page.getByRole('alert').textContent()).toStrictEqual(
          i18n.t('imports.intake.malformedResponse'),
        );
        expect(captureCount(locale, scenario, 'inspect')).toStrictEqual(1);
        expect(await pageAttempts('inspect')).toStrictEqual(1);
        expect(capturesFor(locale, scenario, 'inspect')[0]).toStrictEqual(
          expectedCapture(locale, scenario, 'inspect', 'retry Ω.pdf', 'retry'),
        );
        const rendered = await page.locator('body').innerText();
        if (rendered.includes(hostile)) {
          expect.unreachable('Expected !rendered.includes(hostile)');
        }
        if (rendered.includes('imports.')) {
          expect.unreachable("Expected !rendered.includes('imports.')");
        }
        if (rendered.includes('{')) expect.unreachable("Expected !rendered.includes('{')");
        await assertSafe(locale);
      }
      for (
        const scenario of [
          'inspect-message',
          'inspect-extra',
          'inspect-unknown',
          'inspect-missing-limit',
          'inspect-wrong-limit',
          'inspect-limit-zero',
          'inspect-params-extra',
          'inspect-invalid-json-500',
          'inspect-invalid-json-200',
          'inspect-network',
        ] as const
      ) {
        await page.goto(`${base}/?locale=${locale}&scenario=${scenario}`);
        await page.locator('#bring-source-files').setInputFiles({
          name: 'matrix Ω.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('matrix'),
        });
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
        await page.getByRole('alert').waitFor();
        const inspectError = scenario === 'inspect-extra' || scenario === 'inspect-params-extra'
          ? parseSourceIntakeFailureEnvelope(malformedBody(scenario, 'inspect'))
          : null;
        if (scenario === 'inspect-extra' || scenario === 'inspect-params-extra') {
          if (!inspectError) expect.unreachable('Expected inspectError');
        }
        expect(await page.getByRole('alert').textContent()).toStrictEqual(
          inspectError
            ? sourceIntakeFailureMessage(i18n, inspectError)
            : i18n.t('imports.intake.malformedResponse'),
        );
        if (scenario === 'inspect-network') {
          expect(
            await page.evaluate(() =>
              (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { inspect: number } })
                .__SOURCE_ATTEMPTS__?.inspect ?? 0
            ),
          ).toStrictEqual(1);
          expect(captureCount(locale, scenario, 'inspect')).toStrictEqual(0);
        } else {
          expect(captureCount(locale, scenario, 'inspect')).toStrictEqual(1);
          expect(await pageAttempts('inspect')).toStrictEqual(1);
          expect(capturesFor(locale, scenario, 'inspect')[0]).toStrictEqual(
            expectedCapture(locale, scenario, 'inspect', 'matrix Ω.pdf', 'matrix'),
          );
        }
        const rendered = await page.locator('body').innerText();
        if (rendered.includes(hostile)) {
          expect.unreachable('Expected !rendered.includes(hostile)');
        }
        if (rendered.includes('imports.')) {
          expect.unreachable("Expected !rendered.includes('imports.')");
        }
        if (rendered.includes('{')) expect.unreachable("Expected !rendered.includes('{')");
        expect(
          await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') })
            .isDisabled(),
        ).toStrictEqual(false);
        expect(new URL(page.url()).pathname).toStrictEqual('/');
        await assertSafe(locale);
      }
      for (
        const scenario of [
          'inspect-wrong-purpose',
          'inspect-poisoned-200',
          'inspect-unknown-adapter-200',
        ] as const
      ) {
        await page.goto(`${base}/?locale=${locale}&scenario=${scenario}`);
        await page.locator('#bring-source-files').setInputFiles({
          name: 'matrix Ω.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('matrix'),
        });
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
        await page.getByText(i18n.t('imports.intake.detectedFormat')).waitFor();
        if (!((await page.getByText('matrix Ω.pdf', { exact: true }).count()) >= 1)) {
          expect.unreachable(
            "Expected (await page.getByText('matrix Ω.pdf', { exact: true }).count()) >= 1",
          );
        }
        if (scenario === 'inspect-unknown-adapter-200') {
          if (!((await page.locator('body').innerText()).includes('Legacy source format'))) {
            expect.unreachable(
              "Expected (await page.locator('body').innerText()).includes('Legacy source format')",
            );
          }
        }
        if ((await page.locator('body').innerText()).includes(hostile)) {
          expect.unreachable(
            "Expected !(await page.locator('body').innerText()).includes(hostile)",
          );
        }
        await assertSafe(locale);
      }
      await page.goto(`${base}/?locale=${locale}&scenario=inspect-retry`);
      await page.locator('#bring-source-files').setInputFiles({
        name: 'retry-inspect Ω.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('retry-inspect'),
      });
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('alert').textContent()).toStrictEqual(
        i18n.t('imports.intake.malformedResponse'),
      );
      expect(
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') })
          .isDisabled(),
      ).toStrictEqual(false);
      expect(await pageAttempts('inspect')).toStrictEqual(1);
      expect(captureCount(locale, 'inspect-retry', 'inspect')).toStrictEqual(1);
      expect(capturesFor(locale, 'inspect-retry', 'inspect')[0]).toStrictEqual(expectedCapture(
        locale,
        'inspect-retry',
        'inspect',
        'retry-inspect Ω.pdf',
        'retry-inspect',
      ));
      expect(await pageAttempts('execute')).toStrictEqual(0);
      expect(captureCount(locale, 'inspect-retry', 'execute')).toStrictEqual(0);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'inspect-retry'
        ),
      ).toStrictEqual([]);
      expect(await page.getByText('retry-inspect Ω.pdf', { exact: true }).count()).toStrictEqual(1);
      await assertSafe(locale);
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).waitFor();
      expect(await pageAttempts('inspect')).toStrictEqual(2);
      expect(await pageAttempts('execute')).toStrictEqual(0);
      expect(captureCount(locale, 'inspect-retry', 'execute')).toStrictEqual(0);
      expect(captureCount(locale, 'inspect-retry', 'inspect')).toStrictEqual(2);
      const retryCaptures = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'inspect-retry' &&
        capture.kind === 'inspect'
      );
      expect(retryCaptures[1]).toStrictEqual(retryCaptures[0]);
      expect(retryCaptures[0]).toStrictEqual(expectedCapture(
        locale,
        'inspect-retry',
        'inspect',
        'retry-inspect Ω.pdf',
        'retry-inspect',
      ));
      expect(
        await page.locator('section[aria-labelledby="format-heading"]').getByText(
          'retry-inspect Ω.pdf',
          { exact: true },
        ).count(),
      ).toStrictEqual(1);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'inspect-retry'
        ),
      ).toStrictEqual([]);
      await assertSafe(locale);
      for (
        const code of [
          'conflict',
          'invalid_idempotency_key',
          'missing_selection',
          'source_too_large',
        ] as const
      ) {
        const scenario = `execute-${code}` as const;
        await page.goto(`${base}/?locale=${locale}&scenario=${scenario}`);
        await page.locator('#bring-source-files').setInputFiles({
          name: 'execute Ω.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('execute'),
        });
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
        await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') })
          .waitFor();
        expect(await pageAttempts('inspect')).toStrictEqual(1);
        expect(captureCount(locale, scenario, 'inspect')).toStrictEqual(1);
        expect(capturesFor(locale, scenario, 'inspect')[0]).toStrictEqual(
          expectedCapture(locale, scenario, 'inspect', 'execute Ω.pdf', 'execute'),
        );
        const executeKey: string | null = await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        );
        expect(executeKey ?? '').toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
        await page.getByRole('alert').waitFor();
        const parsed = parseSourceIntakeFailureEnvelope(bodyFor(code));
        if (!parsed) expect.unreachable('Expected parsed');
        expect(await page.getByRole('alert').textContent()).toStrictEqual(
          sourceIntakeFailureMessage(i18n, parsed),
        );
        expect(captureCount(locale, scenario, 'execute')).toStrictEqual(1);
        expect(await pageAttempts('execute')).toStrictEqual(1);
        expect(
          await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') })
            .isDisabled(),
        ).toStrictEqual(false);
        const executeCaptures = captures.filter((capture) =>
          capture.locale === locale && capture.scenario === scenario &&
          capture.kind === 'execute'
        );
        expect(executeCaptures.length).toStrictEqual(1);
        expect(executeCaptures[0]).toStrictEqual({
          locale,
          scenario,
          kind: 'execute',
          purpose: 'recover_existing',
          files: [{
            name: 'execute Ω.pdf',
            type: 'application/pdf',
            size: 7,
            text: 'execute',
          }],
          adapters: [{ field: 'adapter-0', value: 'pdf@1' }],
          key: executeKey,
          text: null,
        });
        expect(new URL(page.url()).pathname).toStrictEqual('/');
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
          ),
        ).toStrictEqual(executeKey);
        expect(
          navigations.filter((navigation) =>
            navigation.locale === locale && navigation.scenario === scenario
          ),
        ).toStrictEqual([]);
        await assertSafe(locale);
      }
      for (
        const scenario of ['execute-wrong-purpose-200', 'execute-extra-success-200'] as const
      ) {
        await page.goto(`${base}/?locale=${locale}&scenario=${scenario}`);
        await page.locator('#bring-source-files').setInputFiles({
          name: 'success Ω.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('success'),
        });
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
        await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') })
          .waitFor();
        await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
        await page.waitForFunction(() => location.pathname.startsWith('/imports/'));
        if ((await page.locator('body').innerText()).includes(hostile)) {
          expect.unreachable(
            "Expected !(await page.locator('body').innerText()).includes(hostile)",
          );
        }
        await assertSafe(locale);
      }
      for (
        const scenario of [
          'execute-malformed',
          'execute-message',
          'execute-extra',
          'execute-unknown',
          'execute-missing-limit',
          'execute-wrong-limit',
          'execute-limit-zero',
          'execute-params-extra',
          'execute-invalid-json-500',
          'execute-invalid-json-200',
          'execute-network',
        ] as const
      ) {
        await page.goto(`${base}/?locale=${locale}&scenario=${scenario}`);
        await page.locator('#bring-source-files').setInputFiles({
          name: 'execute-matrix Ω.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('execute'),
        });
        await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
        await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') })
          .waitFor();
        expect(await pageAttempts('inspect')).toStrictEqual(1);
        expect(captureCount(locale, scenario, 'inspect')).toStrictEqual(1);
        expect(capturesFor(locale, scenario, 'inspect')[0]).toStrictEqual(
          expectedCapture(locale, scenario, 'inspect', 'execute-matrix Ω.pdf', 'execute'),
        );
        const malformedExecuteKey: string | null = await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        );
        expect(malformedExecuteKey ?? '').toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
        await page.getByRole('alert').waitFor();
        const executeError = parseSourceIntakeFailureEnvelope(malformedBody(scenario, 'execute'));
        expect(await page.getByRole('alert').textContent(), scenario).toStrictEqual(
          executeError
            ? sourceIntakeFailureMessage(i18n, executeError)
            : i18n.t('imports.intake.malformedResponse'),
        );
        expect(
          await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') })
            .isDisabled(),
        ).toStrictEqual(false);
        expect(new URL(page.url()).pathname).toStrictEqual('/');
        expect(await pageAttempts('execute')).toStrictEqual(1);
        expect(await pageAttempts('inspect')).toStrictEqual(1);
        expect(captureCount(locale, scenario, 'inspect')).toStrictEqual(1);
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
          ),
        ).toStrictEqual(malformedExecuteKey);
        expect(
          navigations.filter((navigation) =>
            navigation.locale === locale && navigation.scenario === scenario
          ),
        ).toStrictEqual([]);
        if ((await page.locator('body').innerText()).includes(hostile)) {
          expect.unreachable(
            "Expected !(await page.locator('body').innerText()).includes(hostile)",
          );
        }
        await assertSafe(locale);
        if (scenario === 'execute-network') {
          expect(
            await page.evaluate(() =>
              (globalThis as typeof globalThis & { __SOURCE_ATTEMPTS__?: { execute: number } })
                .__SOURCE_ATTEMPTS__?.execute ?? 0
            ),
          ).toStrictEqual(1);
          expect(captureCount(locale, scenario, 'execute')).toStrictEqual(0);
        } else {
          expect(captureCount(locale, scenario, 'execute')).toStrictEqual(1);
          const malformedCapture = captures.find((capture) =>
            capture.locale === locale && capture.scenario === scenario &&
            capture.kind === 'execute'
          );
          expect(malformedCapture).toStrictEqual({
            locale,
            scenario,
            kind: 'execute',
            purpose: 'recover_existing',
            files: [{
              name: 'execute-matrix Ω.pdf',
              type: 'application/pdf',
              size: 7,
              text: 'execute',
            }],
            adapters: [{ field: 'adapter-0', value: 'pdf@1' }],
            key: malformedExecuteKey,
            text: null,
          });
        }
        await assertSafe(locale);
      }
      await page.goto(`${base}/?locale=${locale}&scenario=execute-retry`);
      await page.locator('#bring-source-files').setInputFiles({
        name: 'retry-execute Ω.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('retry'),
      });
      await page.getByRole('button', { name: i18n.t('imports.intake.checkSource') }).click();
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).waitFor();
      const retryKey: string | null = await page.evaluate(() =>
        sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
      );
      expect(retryKey ?? '').toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('alert').textContent()).toStrictEqual(
        i18n.t('imports.intake.malformedResponse'),
      );
      expect(captureCount(locale, 'execute-retry', 'inspect')).toStrictEqual(1);
      expect(await pageAttempts('inspect')).toStrictEqual(1);
      expect(await pageAttempts('execute')).toStrictEqual(1);
      expect(captureCount(locale, 'execute-retry', 'execute')).toStrictEqual(1);
      expect(capturesFor(locale, 'execute-retry', 'inspect')[0]).toStrictEqual(
        expectedCapture(locale, 'execute-retry', 'inspect', 'retry-execute Ω.pdf', 'retry'),
      );
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'execute-retry'
        ),
      ).toStrictEqual([]);
      expect((await page.getByRole('alert').textContent())?.includes(hostile)).toStrictEqual(false);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        ),
      ).toStrictEqual(retryKey);
      expect(await pageAttempts('execute')).toStrictEqual(1);
      expect(capturesFor(locale, 'execute-retry', 'execute')[0]).toStrictEqual({
        locale,
        scenario: 'execute-retry',
        kind: 'execute',
        purpose: 'recover_existing',
        files: [{ name: 'retry-execute Ω.pdf', type: 'application/pdf', size: 5, text: 'retry' }],
        adapters: [{ field: 'adapter-0', value: 'pdf@1' }],
        key: retryKey,
        text: null,
      });
      expect(new URL(page.url()).pathname).toStrictEqual('/');
      expect(
        await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') })
          .isDisabled(),
      ).toStrictEqual(false);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'execute-retry'
        ),
      ).toStrictEqual([]);
      await assertSafe(locale);
      await page.getByRole('button', { name: i18n.t('imports.intake.continueReview') }).click();
      await page.waitForFunction(
        (run) => location.pathname === `/imports/${run}`,
        '00000000-0000-4000-8000-0000000000a2',
      );
      const retries = captures.filter((capture) =>
        capture.locale === locale && capture.scenario === 'execute-retry' &&
        capture.kind === 'execute'
      );
      expect(retries.length).toStrictEqual(2);
      expect(retries[1]).toStrictEqual(retries[0]);
      expect(retries[0].key).toStrictEqual(retryKey);
      expect(retries[1].key).toStrictEqual(retryKey);
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('__SOURCE_ATTEMPTS_PERSISTED__') ?? '{}').execute
        ),
      ).toStrictEqual(2);
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem('__SOURCE_ATTEMPTS_PERSISTED__') ?? '{}').inspect
        ),
      ).toStrictEqual(1);
      expect(
        navigations.filter((navigation) =>
          navigation.locale === locale && navigation.scenario === 'execute-retry'
        ).map((navigation) => navigation.pathname),
      ).toStrictEqual(['/imports/00000000-0000-4000-8000-0000000000a2']);
      expect(
        captures.filter((capture) =>
          capture.locale === locale && capture.scenario === 'execute-retry' &&
          capture.kind === 'inspect'
        ).length,
      ).toStrictEqual(1);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('qflow.source-intake.submission-key.v2:assessment')
        ),
      ).toStrictEqual(null);
      await assertSafe(locale);
    }
    expect(pageErrors).toStrictEqual([]);
    expect(consoleErrors).toStrictEqual([]);
    expect(
      await page.evaluate(() =>
        (globalThis as typeof globalThis & { __SOURCE_UNHANDLED__?: string[] })
          .__SOURCE_UNHANDLED__ ?? []
      ),
    ).toStrictEqual([]);
  } finally {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    if (tmp) await _fs.rm(tmp, { recursive: true }).catch(() => undefined);
  }
});
