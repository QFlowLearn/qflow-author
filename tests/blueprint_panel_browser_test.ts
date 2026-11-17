import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { join } from 'node:path';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;

testCase('blueprint panel preserves authored state through browser mutations', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    for (const locale of locales) await runLocale(browser, locale);
  } finally {
    await browser.close();
  }
});

async function runLocale(
  browser: import('playwright').Browser,
  locale: typeof locales[number],
): Promise<void> {
  const temp = await _fs.mkdtemp(_path.join(process.cwd(), '.blueprint-browser-'));
  const entry = join(temp, 'entry.tsx');
  const out = join(temp, 'client');
  const metafile = join(temp, 'metafile.json');
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['imports']);
  const i18n = createI18n(locale, payload.namespaces);
  let requests = 0;
  const requestBodies: unknown[] = [];
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => releaseGate = resolve);
  const server = await startFetchServer(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/assessments/assessment-1/blueprint' && request.method === 'PUT') {
      requests += 1;
      const body: unknown = await request.json();
      requestBodies.push(body);
      if (requests === 1) {
        await gate;
        return Response.json({ blueprint: body });
      }
      if (requests === 2) {
        return Response.json({ code: 'unknown', error: 'HOSTILE-UPSTREAM-DETAIL' }, {
          status: 500,
        });
      }
      return Response.json({}, { status: 200 });
    }
    if (url.pathname === '/entry.js') {
      try {
        return new Response(await _fs.readFile(join(out, 'entry.js')), {
          headers: { 'content-type': 'text/javascript' },
        });
      } catch (_error) {
        return new Response('missing entry', { status: 404 });
      }
    }
    if (url.pathname.startsWith('/chunks/')) {
      try {
        return new Response(await _fs.readFile(join(out, url.pathname.slice(1))), {
          headers: { 'content-type': 'text/javascript' },
        });
      } catch (_error) {
        return new Response('missing chunk', { status: 404 });
      }
    }
    return new Response(
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>',
      {
        headers: { 'content-type': 'text/html' },
      },
    );
  });
  try {
    await _fs.writeFile(
      entry,
      browserEntrySource(
        JSON.stringify(payload),
        JSON.stringify(i18n.t('imports.blueprint.saveFailed')),
      ),
      'utf8',
    );
    const bundled = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
      entry,
      '--bundle',
      '--format=esm',
      '--splitting',
      '--jsx=automatic',
      '--jsx-import-source=preact',
      `--metafile=${metafile}`,
      `--outdir=${out}`,
    ], { cwd: process.cwd() });
    if (!(bundled.success)) expect.unreachable(new TextDecoder().decode(bundled.stderr));
    const inputs = JSON.parse(await _fs.readFile(metafile, 'utf8')).inputs as Record<
      string,
      unknown
    >;
    for (const input of Object.keys(inputs)) {
      expect(input.includes('lib/i18n/catalogs.ts')).toStrictEqual(false);
      expect(input.includes('lib/i18n/messages/')).toStrictEqual(false);
      expect(input.includes('lib/i18n/player_messages/')).toStrictEqual(false);
    }
    const page: import('playwright').Page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = `http://${'127.0.0.1'}:${server.port}`;
    await page.goto(origin);
    await page.getByText(i18n.t('imports.blueprint.outcomeWeight', { value: 1 }), { exact: true })
      .waitFor();
    await page.getByRole('button', { name: i18n.t('imports.blueprint.addOutcome') }).click();
    const outcomes = page.getByRole('group', {
      name: i18n.t('imports.blueprint.learningOutcomes'),
      exact: true,
    });
    const targets = page.getByRole('group', {
      name: i18n.t('imports.blueprint.targets'),
      exact: true,
    });
    const outcomeInputs = outcomes.locator('input');
    expect(await outcomeInputs.nth(2).inputValue()).toStrictEqual(
      i18n.t('imports.blueprint.outcomeNumber', { index: 2 }),
    );
    await outcomeInputs.nth(1).fill('50');
    await page.getByText(i18n.t('imports.blueprint.outcomeWeight', { value: 0.5 }), { exact: true })
      .waitFor();
    await outcomeInputs.nth(2).fill('Éxito ✨');
    await outcomeInputs.nth(3).fill('50');
    const targetInputs = targets.locator('input[type="number"]');
    await targetInputs.nth(0).fill('1');
    await page.getByRole('button', { name: i18n.t('imports.blueprint.addTarget') }).click();
    await targets.locator('select').nth(4).selectOption('outcome-2');
    const selects = targets.locator('select');
    expect(await selects.nth(1).locator('option[value="understand"]').textContent()).toStrictEqual(
      i18n.t('imports.blueprint.demandLabel', { value: 'understand' }),
    );
    expect(await selects.nth(2).locator('option[value="medium"]').textContent()).toStrictEqual(
      i18n.t('imports.blueprint.difficultyLabel', { value: 'medium' }),
    );
    expect(await selects.nth(3).locator('option[value="single_select"]').textContent())
      .toStrictEqual(i18n.t('imports.blueprint.typeLabel', { type: 'single_select' }));
    expect(await selects.nth(3).locator('option[value="single_select"]').getAttribute('value'))
      .toStrictEqual('single_select');
    await page.getByText(i18n.t('imports.blueprint.plannedTotal', { count: 2 }), { exact: true })
      .waitFor();
    const save = page.getByRole('button', { name: i18n.t('imports.blueprint.save') });
    await save.click();
    await page.getByRole('status').filter({ hasText: i18n.t('imports.blueprint.saving') })
      .waitFor();
    const savingButton = page.getByRole('button', { name: i18n.t('imports.blueprint.saving') });
    expect(await savingButton.isDisabled()).toStrictEqual(true);
    await savingButton.click({ force: true });
    expect(requests).toStrictEqual(1);
    expect(requestBodies.length).toStrictEqual(1);
    const firstBody = requestBodies[0] as {
      outcomes: Array<{ id: string; title: string; weight: number }>;
      targets: Array<
        {
          id: string;
          outcomeId: string;
          questionType: string;
          cognitiveDemand: string;
          difficulty: string;
        }
      >;
    };
    expect(firstBody.outcomes[1]).toStrictEqual({ id: 'outcome-2', title: 'Éxito ✨', weight: 50 });
    expect(firstBody.targets.map((target) => target.id)).toStrictEqual(['target-1', 'target-2']);
    expect(firstBody.targets[0].questionType).toStrictEqual('single_select');
    expect(firstBody.targets[0].cognitiveDemand).toStrictEqual('understand');
    expect(firstBody.targets[0].difficulty).toStrictEqual('medium');
    releaseGate();
    await page.getByText('Éxito ✨', { exact: true }).first().waitFor();
    expect(await save.count()).toStrictEqual(0);
    await page.getByRole('button', { name: i18n.t('imports.blueprint.edit') }).click();
    const edited = outcomes.locator('input').first();
    await edited.fill('Changed then cancelled');
    await page.getByRole('button', { name: i18n.t('imports.blueprint.cancel'), exact: true })
      .click();
    await page.getByText('Éxito ✨', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: i18n.t('imports.blueprint.edit') }).click();
    expect(await outcomes.locator('input').first().inputValue()).toStrictEqual(
      i18n.t('imports.blueprint.primaryOutcome'),
    );
    await outcomes.locator('input').first().fill('Failure attempt');
    await page.getByRole('button', { name: i18n.t('imports.blueprint.save') }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').innerText()).toContain(
      i18n.t('imports.blueprint.saveFailed'),
    );
    expect((await page.locator('body').innerText()).includes('HOSTILE-UPSTREAM-DETAIL'))
      .toStrictEqual(false);
    expect((await page.locator('body').innerText()).includes('unknown')).toStrictEqual(false);
    await page.getByRole('button', { name: i18n.t('imports.blueprint.save') }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').innerText()).toContain(
      i18n.t('imports.blueprint.saveFailed'),
    );
    expect(requests).toStrictEqual(3);
    expect(pageErrors).toStrictEqual([]);
    await page.close();
  } finally {
    await server.close();
    await _fs.rm(temp, { recursive: true });
  }
}

function browserEntrySource(payload: string, saveFailed: string): string {
  return `
import { render } from 'preact';
import BlueprintPanel from '../islands/BlueprintPanel.tsx';
const initial = { _tag: 'Unspecified', version: 1 };
render(<BlueprintPanel resource='assessment' resourceId='assessment-1' initialBlueprint={initial} payload={${payload}} onSaved={() => {}} />, document.getElementById('root'));
void ${JSON.stringify(saveFailed)};
`;
}
