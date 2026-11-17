import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { printWorkerConfig } from '../../tools/print_worker_config.ts';
import { printCompilerDevelopmentPlugin } from '../../tools/print_compiler_development.ts';

it('Vite development renders a PDF with the real compiler inside its module runner', async () => {
  await mkdir('.artifacts', { recursive: true });
  const directory = await mkdtemp(resolve('.artifacts/print-development-'));
  const entrypoint = resolve(directory, 'entry.ts');
  const document = {
    kind: 'student',
    title: 'Exam',
    form: 'QF-DEV',
    createdAt: '2026-11-17T12:00:00Z',
    paper: 'a4',
    locale: 'en-US',
    instructions: '',
    labels: {
      document: 'Paper',
      question: 'Question',
      response: 'Response',
      marking: 'Marking',
      continued: 'continued',
    },
    images: [],
    parts: [{
      title: 'Part',
      instructions: [],
      entries: [{
        kind: 'question',
        number: 1,
        language: 'en-US',
        content: [{ kind: 'text', text: 'Explain.' }],
        choices: [],
        responseLines: 6,
        selection: '',
      }],
    }],
  };
  await writeFile(
    entrypoint,
    `import {printRenderer} from ${
      JSON.stringify(resolve('deploy/cloudflare/print_renderer.entry.ts'))
    };
export default {fetch(){const result=printRenderer.render(${
      JSON.stringify(document)
    });return result.ok ? new Response(result.value.bytes,{headers:{'content-type':'application/pdf'}}) : new Response(result.code,{status:500});}};`,
  );
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false,
      publicDir: false,
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        printCompilerDevelopmentPlugin(),
        cloudflare({
          types: { generate: false },
          remoteBindings: false,
          inspectorPort: false,
          config: (loaded) => ({
            ...loaded,
            worker: { ...printWorkerConfig(loaded.worker), entrypoint },
          }),
        }),
      ],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw Error('Development listener did not start.');
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
