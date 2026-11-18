import { expect, test as testCase } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright';

testCase('async UI callbacks preserve native events and report rejected tasks', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { uiEvent } from './lib/client/ui_event.ts';
        const form = document.querySelector('form');
        const output = document.querySelector('output');
        form.addEventListener('submit', uiEvent(async (event) => {
          event.preventDefault();
          await Promise.resolve();
          output.textContent = event.defaultPrevented ? 'Saved' : 'Submitted';
        }));
        document.querySelector('#defect').addEventListener('click', uiEvent(async () => {
          await Promise.resolve();
          throw new Error('UI action failed');
        }));
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (cause) => errors.push(cause.message));
    await page.setContent(`<form><button type="submit">Save</button></form>
      <output></output><button id="defect" type="button">Fail</button>`);
    const script = bundle.outputFiles[0];
    if (!script) throw new Error('Browser fixture bundle is missing.');
    await page.addScriptTag({ type: 'module', content: script.text });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    expect(errors).toStrictEqual([]);
    const failed = page.waitForEvent('pageerror');
    await page.getByRole('button', { name: 'Fail', exact: true }).click();
    expect((await failed).message).toStrictEqual('UI action failed');
    expect(errors).toStrictEqual(['UI action failed']);
  } finally {
    await browser.close();
  }
});
