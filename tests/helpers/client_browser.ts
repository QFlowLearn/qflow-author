import { build } from 'esbuild';
import { type Browser, chromium } from 'playwright';
import { startFetchServer } from './fetch_server.ts';

/** Run browser-only clients against an owned HTTP origin and their actual browser globals. */
export async function clientBrowser(entry: string) {
  const built = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: 'client-fixture.ts' },
    bundle: true,
    format: 'esm',
    write: false,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: { '.css': 'empty' },
  });
  const script = built.outputFiles[0]?.text;
  if (!script) throw Error('Missing client fixture bundle.');
  let response = new Response(null, { status: 500 });
  const server = await startFetchServer((request) => {
    const path = new URL(request.url).pathname;
    if (path === '/') {
      return new Response(
        '<!doctype html><title>Client protocol fixture</title><script type="module">import * as client from "/client.js"; window.qflowClient = client;</script>',
        {
          headers: { 'content-type': 'text/html' },
        },
      );
    }
    if (path === '/client.js') {
      return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    }
    return response.clone();
  });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const ownedBrowser = browser;
    const page = await ownedBrowser.newPage();
    await page.goto(server.origin);
    await page.waitForFunction(() => 'qflowClient' in window);
    return {
      page,
      respond(next: Response) {
        response = next;
      },
      async disconnect() {
        await page.route('**/api/**', (route) => route.abort('failed'));
      },
      async reconnect() {
        await page.unroute('**/api/**');
      },
      async close() {
        await ownedBrowser.close();
        await server.close();
      },
    };
  } catch (cause: unknown) {
    await browser?.close();
    await server.close();
    throw cause;
  }
}
