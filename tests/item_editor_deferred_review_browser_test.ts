import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { runCommand } from '../tools/process_command.ts';
import { fileURLToPath } from 'node:url';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import * as _fsSync from 'node:fs';

const REVIEW_CLOCK_ADVANCE_MS = 1_000;

testCase('deferred item review publishes only completed enabled analysis', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const { chromium } = await import('playwright');
  const tempDirectory = await _fs.mkdtemp(_path.join(process.cwd(), '.item-review-browser-'));
  const entryPath = `${tempDirectory}/entry.tsx`;
  const bundlePath = `${tempDirectory}/bundle.js`;

  await _fs.writeFile(
    entryPath,
    `
import { render } from "preact";
import { useMemo, useState } from "preact/hooks";
import { collectA11yIssues } from "../lib/a11y_checks.ts";
import { useDeferredQuestionReview } from "../islands/item_editor/useDeferredQuestionReview.ts";

function ReviewProbe() {
  const [draft, setDraft] = useState({
    type: "extended_text",
    title: "Deferred review probe",
    bodyHtml: "<p>What process stores light energy? Where is that energy stored?</p>",
  });
  const [enabled, setEnabled] = useState(true);
  const a11yIssues = useMemo(() => collectA11yIssues(draft), [draft]);
  const suggestions = useDeferredQuestionReview({ draft, a11yIssues, enabled });
  const codes = suggestions.map((suggestion) => suggestion.code).join(",") || "none";

  return (
    <main>
      <label>
        Question text
        <input
          value={draft.bodyHtml.replaceAll(/<[^>]*>/g, "")}
          onInput={(event) =>
            setDraft((current) => ({
              ...current,
              bodyHtml: \`<p>\${event.currentTarget.value}</p>\`,
            }))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        Review enabled
      </label>
      <output data-review-codes>{codes}</output>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Review probe root is missing.");
render(<ReviewProbe />, root);
`,
    'utf8',
  );

  const bundled = await runCommand(fileURLToPath(import.meta.resolve('esbuild/bin/esbuild')), [
    entryPath,
    '--bundle',
    '--format=esm',
    '--jsx=automatic',
    '--jsx-import-source=preact',
    `--outfile=${bundlePath}`,
  ], { cwd: process.cwd() });
  if (!(bundled.success)) expect.unreachable(new TextDecoder().decode(bundled.stderr));

  const server = await startFetchServer((request) => {
    if (new URL(request.url).pathname === '/bundle.js') {
      return new Response(_fsSync.readFileSync(bundlePath, 'utf8'), {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    return new Response(
      `<!doctype html>
          <html lang="en">
            <head><meta name="viewport" content="width=device-width"></head>
            <body>
              <div id="root"></div>
              <script type="module" src="/bundle.js"></script>
            </body>
          </html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  });

  const browser = await chromium.launch();
  try {
    const page: import('playwright').Page = await browser.newPage();
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto(`http://${'127.0.0.1'}:${server.port}`);
    const input = page.getByLabel('Question text');
    const enabled = page.getByLabel('Review enabled');
    const codes = page.locator('[data-review-codes]');

    await codes.waitFor();
    expect(await codes.textContent()).toStrictEqual('ambiguous_stem.multiple_questions');
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));

    await input.fill('Why?');
    expect(await codes.textContent()).toStrictEqual('ambiguous_stem.multiple_questions');
    await input.fill('Why? What?');
    expect(await codes.textContent()).toStrictEqual('ambiguous_stem.multiple_questions');
    await input.fill('Final?');
    expect(await codes.textContent()).toStrictEqual('ambiguous_stem.multiple_questions');
    await page.clock.runFor(REVIEW_CLOCK_ADVANCE_MS);
    expect(await codes.textContent()).toStrictEqual('ambiguous_stem.short');

    await enabled.uncheck();
    await input.fill('Disabled? Still?');
    await page.clock.runFor(REVIEW_CLOCK_ADVANCE_MS);
    expect(await codes.textContent()).toStrictEqual('ambiguous_stem.short');

    await enabled.check();
    await page.clock.runFor(REVIEW_CLOCK_ADVANCE_MS);
    expect(await codes.textContent()).toStrictEqual('ambiguous_stem.multiple_questions');
  } finally {
    await browser.close();
    await server.close();
    await _fs.rm(tempDirectory, { recursive: true });
  }
});
