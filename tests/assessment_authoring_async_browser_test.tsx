import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import { hasFileErrorCode } from '../tools/file_errors.ts';
import { parseMetafile } from './helpers/esbuild_metafile.ts';
import { browserEntrySource } from './helpers/assessment_authoring_browser_entry.ts';
import { assertPublishedDeliveryState } from './helpers/assessment_delivery_browser.ts';

import { dirname, join, normalize } from 'node:path';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';

function isItemEditorCanvasInput(input: string): boolean {
  return input.endsWith('/item_editor/ItemEditorCanvas.tsx');
}

testCase('assessment authoring starts with a closed flow and loads deferred features on request', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const enI18n = createI18n('en-US', { assessments: catalogForLocale('en-US').assessments! });
  const tempDirectory = await _fs.mkdtemp(
    _path.join(process.cwd(), '.assessment-authoring-browser-'),
  );
  const entryPath = join(tempDirectory, 'entry.tsx');
  const clientRoot = join(tempDirectory, 'client');
  const metafilePath = join(tempDirectory, 'metafile.json');

  await _fs.writeFile(
    entryPath,
    browserEntrySource(
      JSON.stringify(
        createI18nPayload('en-US', catalogForLocale('en-US'), [
          'assessments',
          'authoring',
          'delivery',
          'items',
          'imports',
        ]),
      ),
      JSON.stringify(playerMessageCatalogForLocale('en-US')),
    ),
    'utf8',
  );
  const bundled = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
    entryPath,
    '--bundle',
    '--format=esm',
    '--splitting',
    '--jsx=automatic',
    '--jsx-import-source=preact',
    '--loader:.css=empty',
    '--loader:.min.mjs=file',
    '--entry-names=entry',
    '--chunk-names=chunks/[name]-[hash]',
    `--metafile=${metafilePath}`,
    `--outdir=${clientRoot}`,
  ], { cwd: process.cwd() });
  if (!(bundled.success)) expect.unreachable(new TextDecoder().decode(bundled.stderr));
  const entryBundle = await _fs.readFile(join(clientRoot, 'entry.js'), 'utf8');
  expect(entryBundle.includes('catalogForLocale')).toStrictEqual(false);
  expect(entryBundle.includes('CATALOGS')).toStrictEqual(false);
  expect(entryBundle.includes('PLAYER_MESSAGE_CATALOGS')).toStrictEqual(false);
  expect(entryBundle.includes('player_messages/catalogs')).toStrictEqual(false);
  const meta = parseMetafile(JSON.parse(await _fs.readFile(metafilePath, 'utf8')));
  const deferredInput = Object.entries(meta.inputs).find(([key]) =>
    key.endsWith('islands/assessment_builder/DeferredItemEditorCanvas.tsx')
  );
  if (!deferredInput) expect.unreachable('Expected deferredInput');
  const editorEdge = deferredInput[1].imports.find((entry) =>
    entry.path.endsWith('item_editor/ItemEditorCanvas.tsx')
  );
  if (!editorEdge) expect.unreachable('Expected editorEdge');
  expect(editorEdge.kind).toStrictEqual('dynamic-import');
  expect(editorEdge.external).toStrictEqual(false);
  const entryOutput = Object.entries(meta.outputs).find(([, output]) =>
    output.entryPoint?.endsWith('/entry.tsx')
  );
  if (!entryOutput) expect.unreachable('Expected entryOutput');
  const resolveOutput = (from: string, target: string): string =>
    meta.outputs[target] ? target : normalize(join(dirname(from), target));
  const staticOutputKeys = new Set<string>();
  const visitStatic = (key: string) => {
    if (staticOutputKeys.has(key)) return;
    staticOutputKeys.add(key);
    for (const edge of meta.outputs[key]?.imports ?? []) {
      if (edge.kind === 'import-statement' && !edge.external) {
        const target = resolveOutput(key, edge.path);
        if (meta.outputs[target]) visitStatic(target);
      }
    }
  };
  visitStatic(entryOutput[0]);
  for (const key of staticOutputKeys) {
    expect(
      Object.keys(meta.outputs[key].inputs).some((input) =>
        isItemEditorCanvasInput(input) || input.endsWith('/assessment_builder/ImportPicker.tsx')
      ),
    ).toStrictEqual(false);
  }
  const pickerOutput = Object.entries(meta.outputs).find(([, output]) =>
    output.entryPoint?.endsWith('/assessment_builder/ImportPicker.tsx')
  );
  if (!pickerOutput) expect.unreachable('Expected pickerOutput');
  const pickerChunkName = pickerOutput[0].split('/').at(-1)!;
  const editorOutput = Object.entries(meta.outputs).find(([, output]) =>
    Object.keys(output.inputs).some(isItemEditorCanvasInput)
  );
  if (!editorOutput) expect.unreachable('Expected editorOutput');
  const dynamicReachable = [...staticOutputKeys].some((key) =>
    meta.outputs[key].imports.some((edge) =>
      edge.kind === 'dynamic-import' && !edge.external &&
      resolveOutput(key, edge.path) === editorOutput[0]
    )
  );
  expect(dynamicReachable).toStrictEqual(true);
  for (const input of Object.keys(meta.inputs)) {
    expect(input.includes('lib/i18n/catalogs.ts')).toStrictEqual(false);
    expect(input.includes('lib/i18n/player_messages/catalogs.ts')).toStrictEqual(false);
    expect(/lib\/i18n\/player_messages\/(?:en-US|en-GB|es-ES|es-419)\.(?:ts|tsx|json)$/.test(input))
      .toStrictEqual(false);
    expect(input.includes('lib/i18n/messages/en-US/')).toStrictEqual(false);
    expect(input.includes('lib/i18n/messages/en-GB/')).toStrictEqual(false);
    expect(input.includes('lib/i18n/messages/es-ES/')).toStrictEqual(false);
    expect(input.includes('lib/i18n/messages/es-419/')).toStrictEqual(false);
  }

  const savedQuestions: unknown[] = [];
  let failNextSave = false;
  let delayedSaveGate: {
    readonly markStarted: () => void;
    readonly release: Promise<void>;
  } | null = null;
  let settingsRequestCount = 0;
  let revisionRequestCount = 0;
  let deliveryVersion = 0;
  const server = await startFetchServer(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/assessments/assessment-1/publish/delivery') {
      const version = `version-${++deliveryVersion}`;
      return Response.json({
        assessmentVersionId: version,
        publishedAt: '2026-10-30T12:00:00.000Z',
        previewUrl: `/published/${version}`,
        adminUrl: `/manage/${version}`,
      });
    }
    if (url.pathname === '/api/assessments/assessment-1/publication-status') {
      return Response.json({ status: 'current' });
    }
    if (url.pathname === '/test-styles.css') {
      return new Response(
        await _fs.readFile('static/tw.css', 'utf8') +
          await _fs.readFile('static/styles.css', 'utf8'),
        { headers: { 'content-type': 'text/css' } },
      );
    }
    if (url.pathname === '/fonts/inter-latin.woff2') {
      return new Response(await _fs.readFile('static/fonts/inter-latin.woff2'), {
        headers: { 'content-type': 'font/woff2' },
      });
    }
    if (url.pathname === '/api/settings') {
      settingsRequestCount += 1;
      return Response.json({ choiceRichText: false });
    }
    if (url.pathname === '/api/assessments') {
      return Response.json({ assessments: [] });
    }
    if (
      url.pathname === '/api/items/11111111-1111-4111-8111-111111111111/revisions/1' &&
      request.method === 'GET'
    ) {
      revisionRequestCount += 1;
      return Response.json({
        pointEditingAuthority: { _tag: 'Generated' },
        draft: {
          itemLanguage: 'en-US',
          type: 'single_select',
          title: 'Capital of France',
          bodyHtml: '<p>What is the capital of France?</p>',
          choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Paris' }],
          correctId: 'A',
        },
      });
    }
    if (
      url.pathname === '/api/assessments/assessment-1/questions' &&
      request.method === 'POST'
    ) {
      const requestBody: unknown = await request.json();
      savedQuestions.push(requestBody);
      if (failNextSave) {
        failNextSave = false;
        return Response.json({ error: 'save_failed' }, { status: 500 });
      }
      const gate = delayedSaveGate;
      if (gate) {
        delayedSaveGate = null;
        gate.markStarted();
        await gate.release;
      }
      const savedQuestion = isRecord(requestBody) && requestBody.operation === 'revise'
        ? {
          itemId: requestBody.itemId,
          placementId: requestBody.placementId,
          revision: 2,
          identifier: 'question-existing',
          fixed: false,
        }
        : {
          itemId: '33333333-3333-4333-8333-333333333333',
          placementId: '44444444-4444-4444-8444-444444444444',
          revision: 1,
          identifier: 'question-1',
          fixed: false,
        };
      return Response.json({
        ...savedQuestion,
      });
    }

    const asset = await readClientAsset(clientRoot, url.pathname);
    if (asset) return asset;
    return new Response(
      `<!doctype html>
          <html lang="en" data-theme="wireframe">
            <head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/test-styles.css"></head>
            <body class="qf-body">
              <div id="root" class="qf-shell qf-main"></div>
              <script type="module" src="/entry.js"></script>
            </body>
          </html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  });

  const browser = await chromium.launch();
  try {
    const page: import('playwright').Page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = `http://${'127.0.0.1'}:${server.port}`;

    await page.goto(`${origin}/?fixture=populated&many=1`);
    await page.locator('[data-assessment-findings] summary').click();
    const showAll = page.getByRole('button', { name: 'Show all 7', exact: true });
    await showAll.focus();
    await page.keyboard.press('Enter');
    const findingRows = page.locator('[data-assessment-findings] li');
    expect(await findingRows.count()).toStrictEqual(7);
    expect(await findingRows.nth(5).evaluate((el) => el === document.activeElement)).toStrictEqual(
      true,
    );
    await page.keyboard.press('Tab');
    expect(
      await findingRows.nth(5).getByRole('link').evaluate((el) => el === document.activeElement),
    ).toStrictEqual(true);

    await page.goto(`${origin}/?fixture=populated`);
    const existingQuestion = page.getByRole('button', {
      name: 'Edit question 1.1: Capital of France',
    });
    await existingQuestion.waitFor();
    expect(await page.getByRole('button', { name: 'Save Item' }).count()).toStrictEqual(0);
    expect(revisionRequestCount).toStrictEqual(0);

    const findings = page.locator('[data-assessment-findings]');
    const summary = findings.locator('summary');
    expect(await findings.getAttribute('open')).toStrictEqual(null);
    expect(await summary.innerText()).toStrictEqual('1 thing worth checking');
    await summary.focus();
    await page.keyboard.press('Enter');
    await findings.getByText('Worth checking: duplicate options', { exact: false }).waitFor();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `/tmp/qflow-content-findings-${width}.png`, fullPage: true });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Horizontal overflow at ${width}px`,
      ).toStrictEqual(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await findings.getByRole('button', { name: 'Hide for now' }).click();
    await page.getByRole('button', { name: 'Undo dismissals' }).waitFor();
    expect(
      await page.getByRole('button', { name: 'Undo dismissals' }).evaluate((el) =>
        el === document.activeElement
      ),
    ).toStrictEqual(true);
    await page.getByRole('button', { name: 'Undo dismissals' }).click();
    await summary.click();
    await findings.getByRole('link', { name: 'Go to question' }).click();
    expect(
      await page.locator('[data-authoring-card]').evaluate((el) => el === document.activeElement),
    ).toStrictEqual(true);
    expect(revisionRequestCount).toStrictEqual(0);
    // Question content stays outside the button's accessible name, but its full card remains clickable.
    const previewBounds = await page.getByText('What is the capital of France?', { exact: true })
      .boundingBox();
    if (!previewBounds) expect.unreachable('The collapsed question body must be visible.');
    const buttonBounds = await existingQuestion.boundingBox();
    if (!buttonBounds) expect.unreachable('The edit control must be visible.');
    await existingQuestion.click({
      position: {
        x: previewBounds.x + previewBounds.width / 2 - buttonBounds.x,
        y: previewBounds.y + previewBounds.height / 2 - buttonBounds.y,
      },
    });
    await page.getByPlaceholder('Choice A').waitFor();
    expect(revisionRequestCount).toStrictEqual(1);
    const firstChoice = page.getByPlaceholder('Choice A');
    expect(await firstChoice.inputValue()).toStrictEqual('Paris');
    await firstChoice.fill('State survives deferred UI');
    await findings.getByRole('link', { name: 'Go to question' }).click();
    expect(await firstChoice.inputValue()).toStrictEqual('State survives deferred UI');
    expect(revisionRequestCount).toStrictEqual(1);

    // Opening tools preserves the active editor, scroll position and every answer edit.
    const toolsAdd = page.getByRole('button', { name: 'Add question', exact: true });
    const activeCard = page.locator('article').filter({ has: firstChoice });
    const beforeTools = await activeCard.boundingBox();
    const beforeScroll = await page.evaluate(() => scrollY);
    const toolBounds = await toolsAdd.boundingBox();
    if (!toolBounds) expect.unreachable('Expected toolBounds');
    await page.mouse.click(
      toolBounds.x + toolBounds.width / 2,
      toolBounds.y + toolBounds.height / 2,
    );
    const floatingPicker = page.getByRole('region', { name: 'Insert question', exact: true });
    await floatingPicker.waitFor();
    expect(
      await activeCard.boundingBox(),
      JSON.stringify({
        beforeScroll,
        afterScroll: await page.evaluate(() => scrollY),
        toolbar: await toolsAdd.boundingBox(),
        picker: await floatingPicker.boundingBox(),
      }),
    ).toStrictEqual(beforeTools);
    expect(await page.evaluate(() => scrollY)).toStrictEqual(beforeScroll);
    expect(await firstChoice.inputValue()).toStrictEqual('State survives deferred UI');
    await floatingPicker.getByRole('button', { name: /^Single select/ }).click();
    const draftPrompt = page.getByRole('dialog', { name: 'Keep your question changes?' });
    await draftPrompt.waitFor();
    await draftPrompt.getByRole('button', { name: 'Cancel', exact: true }).click();
    await draftPrompt.waitFor({ state: 'hidden' });
    expect(await firstChoice.inputValue()).toStrictEqual('State survives deferred UI');
    await page.keyboard.press('Escape');
    await floatingPicker.waitFor({ state: 'detached' });
    expect(
      await toolsAdd.evaluate((el) => el === document.activeElement),
      await page.evaluate(() => document.activeElement?.tagName),
    ).toStrictEqual(true);
    await page.getByRole('button', { name: 'Question settings' }).click();
    await page.getByRole('heading', { name: 'Details and standards' }).waitFor();
    await page.getByLabel('Randomize choices').check();
    await page.getByText('Unsaved changes', { exact: true }).waitFor();
    expect(await dispatchSyntheticBeforeUnload(page)).toStrictEqual(false);
    expect(await firstChoice.inputValue()).toStrictEqual('State survives deferred UI');

    const delayedSaveStarted = createVoidDeferred();
    const delayedSaveResponse = createVoidDeferred();
    delayedSaveGate = {
      markStarted: delayedSaveStarted.resolve,
      release: delayedSaveResponse.promise,
    };
    const firstSaved = page.waitForResponse((response) =>
      response.url().endsWith('/api/assessments/assessment-1/questions')
    );
    await page.getByRole('button', { name: 'Save question', exact: true }).click();
    await page.locator('#question-settings-inspector').getByRole('button', {
      name: 'Saving…',
      exact: true,
    }).waitFor();
    await delayedSaveStarted.promise;
    await firstChoice.fill('Edited while save pending');
    delayedSaveResponse.resolve();
    await firstSaved;
    await page.getByPlaceholder('Choice A').waitFor();
    expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
      'Edited while save pending',
    );
    expect(JSON.stringify(savedQuestions[0])).toContain('State survives deferred UI');
    expect(JSON.stringify(savedQuestions[0])).toContain('"shuffle":true');
    expect(settingsRequestCount).toStrictEqual(0);
    expect(await page.locator('[data-assessment-findings]').count()).toStrictEqual(0);

    await page.getByText('Unsaved changes', { exact: true }).waitFor();
    expect(await dispatchSyntheticBeforeUnload(page)).toStrictEqual(false);
    expect(await page.getByText('Item saved', { exact: true }).count()).toStrictEqual(0);
    await page.getByRole('button', { name: 'Close question settings' }).click();

    const secondSaved = page.waitForResponse((response) =>
      response.url().endsWith('/api/assessments/assessment-1/questions')
    );
    await page.getByRole('button', { name: 'Save Item' }).click();
    await secondSaved;
    expect(JSON.stringify(savedQuestions[1])).toContain('Edited while save pending');

    await page.getByRole('button', { name: 'Question settings' }).click();
    await page.getByText('Item saved', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/qflow-question-settings-save.png' });
    expect(await dispatchSyntheticBeforeUnload(page)).toStrictEqual(true);
    expect(await page.getByText('Settings saved', { exact: true }).count()).toStrictEqual(0);
    await page.getByRole('button', { name: 'Close question settings' }).click();

    const planLink = page.locator('a[href*="tool=assessment-plan"]');
    expect(await planLink.getAttribute('href')).toStrictEqual(
      '/assessments/assessment-1?tool=assessment-plan',
    );
    const planPage: import('playwright').Page = await browser.newPage();
    try {
      await planPage.goto(`${origin}/?tool=assessment-plan`);
      await planPage.getByRole('heading', { name: 'Assessment plan' }).waitFor();
      expect(await planPage.locator('body').isVisible()).toStrictEqual(true);
    } finally {
      await planPage.close();
    }
    const exportPage: import('playwright').Page = await browser.newPage();
    try {
      await exportPage.goto(`${origin}/?tool=assessment-export`);
      expect(exportPage.url()).toStrictEqual(`${origin}/?tool=assessment-export`);
      await exportPage.getByText('Download / export', { exact: true }).click();
      await exportPage.getByRole('heading', { name: 'Export assessment' }).waitFor();
      await exportPage.getByRole('heading', { name: 'Hosted delivery' }).waitFor();
      await assertPublishedDeliveryState(exportPage, origin);
    } finally {
      await exportPage.close();
    }

    // The sidebar inserts after the selected question without changing the existing order.
    await page.goto(`${origin}/?fixture=populated&many=1`);
    expect(await page.getByRole('button', { name: /^Insert question at / }).count()).toStrictEqual(
      0,
    );
    await page.getByRole('button', { name: 'Edit question 1.2: Capital of France', exact: true })
      .click();
    await page.getByPlaceholder('Choice A').waitFor();
    const insert = page.getByRole('button', { name: 'Add question', exact: true });
    await insert.focus();
    await page.keyboard.press('Enter');
    const sidebarPicker = page.getByRole('region', { name: 'Insert question', exact: true });
    await sidebarPicker.waitFor();
    expect(await page.locator('dialog[open]').count()).toStrictEqual(0);
    await page.keyboard.press('Escape');
    await sidebarPicker.waitFor({ state: 'detached' });
    expect(await insert.evaluate((el) => el === document.activeElement)).toStrictEqual(true);
    await insert.hover();
    await insert.click();
    await page.screenshot({ path: '/tmp/qflow-sidebar-picker.png', fullPage: true });
    await sidebarPicker.getByRole('button', { name: /^Single select/ }).click();
    await page.getByPlaceholder('Choice A').waitFor();
    await page.locator('[contenteditable="true"]').first().fill(
      'Which city is in France?',
    );
    await page.getByPlaceholder('Choice A').fill('Paris');
    await page.getByPlaceholder('Choice B').fill('Berlin');
    await page.getByRole('radio').first().check();
    const unsavedCard = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'New Single select question', exact: true }),
    });
    await unsavedCard.waitFor();
    expect(await unsavedCard.innerText()).toContain('1.3');
    await page.screenshot({ path: '/tmp/qflow-sidebar-insertion.png', fullPage: true });
    const creationStarted = createVoidDeferred();
    const creationResponse = createVoidDeferred();
    delayedSaveGate = { markStarted: creationStarted.resolve, release: creationResponse.promise };
    await page.getByRole('button', { name: 'Save Item' }).click();
    await creationStarted.promise;
    await page.getByPlaceholder('Choice A').fill('New question edited during first save');
    creationResponse.resolve();
    await page.locator('[data-authoring-card="33333333-3333-4333-8333-333333333333"]').waitFor();
    expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
      'New question edited during first save',
    );
    expect(await dispatchSyntheticBeforeUnload(page)).toStrictEqual(false);
    expect(JSON.stringify(savedQuestions.at(-1))).toContain(
      '"beforePlacementId":"finding-placement-3"',
    );
    const order = await page.locator('[data-authoring-card]').evaluateAll((cards) =>
      cards.map((card) => card.getAttribute('data-authoring-card'))
    );
    expect(order.indexOf('33333333-3333-4333-8333-333333333333')).toStrictEqual(2);
    await page.getByRole('button', { name: 'Question settings', exact: true }).click();
    await page.getByText('Unsaved changes', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save question', exact: true }).click();
    await page.getByText('Item saved', { exact: true }).waitFor();
    expect(JSON.stringify(savedQuestions.at(-1))).toContain('"operation":"revise"');
    expect(JSON.stringify(savedQuestions.at(-1))).toContain(
      'New question edited during first save',
    );
    expect(JSON.stringify(savedQuestions.at(-1))).toContain(
      '"itemId":"33333333-3333-4333-8333-333333333333"',
    );
    expect(await dispatchSyntheticBeforeUnload(page)).toStrictEqual(true);
    expect(
      await page.locator('[data-authoring-card="33333333-3333-4333-8333-333333333333"]').count(),
    ).toStrictEqual(1);
    await page.getByRole('button', { name: 'Close question settings', exact: true }).click();

    const touchContext: import('playwright').BrowserContext = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    try {
      const touchPage: import('playwright').Page = await touchContext.newPage();
      await touchPage.goto(`${origin}/?fixture=populated&many=1`);
      await touchPage.getByRole('button', {
        name: 'Edit question 1.2: Capital of France',
        exact: true,
      }).click();
      await touchPage.getByPlaceholder('Choice A').waitFor();
      const touchInsert = touchPage.getByRole('button', {
        name: 'Add question',
        exact: true,
      });
      await touchInsert.waitFor();
      await touchPage.evaluate(() => scrollTo(0, 600));
      const touchScroll = await touchPage.evaluate(() => scrollY);
      const insertionBounds = await touchInsert.boundingBox();
      if (!insertionBounds) expect.unreachable('Expected insertionBounds');
      await touchPage.touchscreen.tap(
        insertionBounds.x + insertionBounds.width / 2,
        insertionBounds.y + insertionBounds.height / 2,
      );
      expect(await touchPage.evaluate(() => scrollY)).toStrictEqual(touchScroll);
      await touchPage.getByRole('region', { name: 'Insert question', exact: true }).waitFor();
      const mobileTools = touchPage.getByRole('group', {
        name: 'Question insertion tools',
        exact: true,
      });
      const toolRow = await mobileTools.boundingBox();
      if (!(toolRow && toolRow.y >= 96 && toolRow.y < 108)) {
        expect.unreachable(
          `Tools stay below the application header space while scrolling: ${
            JSON.stringify(toolRow)
          } scroll=${await touchPage.evaluate(() => scrollY)}`,
        );
      }
      for (const button of await mobileTools.getByRole('button').all()) {
        expect(
          await button.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
            );
          }),
          'The open chooser must not cover mobile tools',
        ).toStrictEqual(true);
      }
      expect(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toStrictEqual(true);
      await touchPage.screenshot({
        path: '/tmp/qflow-sidebar-picker-mobile.png',
        fullPage: true,
      });
      await touchPage.screenshot({ path: '/tmp/qflow-toolbar-mobile-viewport.png' });
    } finally {
      await touchContext.close();
    }

    await page.evaluate(() => localStorage.setItem('qflow-last-type', 'extended_text'));
    await page.goto(origin);
    const addFirstQuestion = page.getByRole('button', { name: 'Add first question' });
    await addFirstQuestion.waitFor();
    expect(await page.locator('[data-assessment-findings]').count()).toStrictEqual(0);
    expect(await page.getByRole('button', { name: 'Save Item' }).count()).toStrictEqual(0);
    let pickerLoadFailed = false;
    await page.route(`**/${pickerChunkName}`, async (route) => {
      if (!pickerLoadFailed) {
        pickerLoadFailed = true;
        return await route.fulfill({ status: 503, body: 'temporarily unavailable' });
      }
      await route.continue();
    });
    await addFirstQuestion.click();
    expect(pickerLoadFailed).toStrictEqual(false);
    await page.getByRole('tab', { name: enI18n.t('assessments.builder.fromLibrary') }).click();
    await page.getByRole('alert').filter({
      hasText: enI18n.t('assessments.builder.library.loadFailed'),
    }).waitFor();
    await page.getByRole('button', {
      name: enI18n.t('assessments.builder.library.reload'),
      exact: true,
    }).click();
    await addFirstQuestion.click();
    await page.getByRole('tab', { name: enI18n.t('assessments.builder.fromLibrary') }).click();
    const bankSearch = page.getByLabel(enI18n.t('assessments.builder.library.search'), {
      exact: true,
    });
    await bankSearch.waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'assessment-library-search');
    await page.getByRole('tab', { name: enI18n.t('assessments.builder.createNew') }).click();
    await page.getByText(enI18n.t('assessments.builder.lastUsed', {
      type: enI18n.t('assessments.builder.questionTypeLabel', { type: 'extended_text' }),
    })).waitFor();
    await page.getByRole('button', {
      name: enI18n.t('assessments.builder.questionTypeLabel', { type: 'extended_text' }),
    }).click();
    await page.getByRole('heading', {
      name: enI18n.t('assessments.builder.newQuestion', {
        type: enI18n.t('assessments.builder.questionTypeLabel', { type: 'extended_text' }),
      }),
      exact: true,
    }).waitFor();
    await page.getByText('Scorer rubric (hidden from learners)').waitFor();

    await page.goto(`${origin}/?fixture=populated&many=1`);
    await page.getByRole('button', { name: 'Edit question 1.1: Capital of France', exact: true })
      .click();
    await page.getByPlaceholder('Choice A').fill('Keep this answer after failure');
    await page.getByRole('button', { name: 'Add question', exact: true }).click();
    await page.getByRole('region', { name: 'Insert question', exact: true }).getByRole('button', {
      name: /^Single select/,
    }).click();
    const continuation = page.getByRole('dialog', { name: 'Keep your question changes?' });
    failNextSave = true;
    await continuation.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await continuation.getByRole('alert').waitFor();
    expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual(
      'Keep this answer after failure',
    );
    expect(await continuation.isVisible()).toStrictEqual(true);
    await continuation.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await continuation.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'New Single select question', exact: true })
      .waitFor();
    const newAfterSelection = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'New Single select question', exact: true }),
    });
    expect(await newAfterSelection.innerText()).toContain('1.2');
    await page.locator('[contenteditable="true"]').first().fill(
      'Save this question before continuing.',
    );
    await page.getByPlaceholder('Choice A').fill('Saved before another draft');
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Add question', exact: true }).click();
    await page.getByRole('region', { name: 'Insert question', exact: true }).getByRole('button', {
      name: /^Extended text/,
    }).click();
    await continuation.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page.getByRole('heading', { name: 'New Extended text question', exact: true })
      .waitFor();
    expect(JSON.stringify(savedQuestions.at(-1))).toContain('Saved before another draft');
    expect(JSON.stringify(savedQuestions.at(-1))).toContain('finding-placement-2');
    await page.getByRole('button', { name: 'Add question', exact: true }).click();
    await page.getByRole('region', { name: 'Insert question', exact: true }).getByRole('button', {
      name: /^Single select/,
    }).click();
    await continuation.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.getByPlaceholder('Choice A').waitFor();

    await page.goto(`${origin}/?multipart=1`);
    await page.getByRole('button', { name: 'Add question', exact: true }).click();
    const destination = page.getByLabel('Insert into part', { exact: true });
    expect(await destination.inputValue()).toStrictEqual('');
    expect(await page.locator('[data-type-option]').count()).toStrictEqual(0);
    await destination.selectOption('88888888-8888-4888-8888-888888888888');
    await page.getByRole('region', { name: 'Insert question', exact: true }).getByRole('button', {
      name: /^Single select/,
    }).click();
    await page.getByPlaceholder('Choice A').waitFor();
    await page.locator('[contenteditable="true"]').first().fill(
      'Question in the explicitly selected second part.',
    );
    await page.getByPlaceholder('Choice A').fill('Second part answer');
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Save item', exact: true }).click();
    await page.locator('[data-authoring-card="33333333-3333-4333-8333-333333333333"]').waitFor();
    expect(JSON.stringify(savedQuestions.at(-1))).toContain(
      '"partId":"88888888-8888-4888-8888-888888888888"',
    );

    await page.getByRole('button', { name: 'From library', exact: true }).click();
    await page.getByLabel('Search library', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('region', { name: 'Insert question', exact: true }).waitFor({
      state: 'detached',
    });
    await page.getByRole('button', { name: 'Write from text', exact: true }).click();
    await page.getByRole('region', { name: 'Insert question', exact: true }).getByRole('button', {
      name: 'Type or paste a question',
      exact: true,
    }).click();
    const questionText = page.getByRole('textbox', {
      name: 'Type or paste a question',
      exact: true,
    });
    await questionText.fill('Which city is in France?\nA. Paris\nB. Berlin\nAnswer: A');
    await page.getByRole('button', { name: 'Prepare question', exact: true }).click();
    await page.getByPlaceholder('Choice A').waitFor();
    expect(await page.getByPlaceholder('Choice A').inputValue()).toStrictEqual('Paris');

    expect(pageErrors).toStrictEqual([]);
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tempDirectory, { recursive: true });
  }
});

async function dispatchSyntheticBeforeUnload(
  page: import('playwright').Page,
): Promise<boolean> {
  return await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    return globalThis.dispatchEvent(event);
  });
}

async function readClientAsset(root: string, pathname: string): Promise<Response | null> {
  if (pathname !== '/entry.js' && !pathname.startsWith('/chunks/')) return null;
  try {
    const bytes = await _fs.readFile(join(root, pathname.slice(1)));
    return new Response(bytes, { headers: { 'content-type': 'text/javascript' } });
  } catch (cause: unknown) {
    if (hasFileErrorCode(cause, 'ENOENT')) return null;
    throw cause;
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function createVoidDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
