import { expect, test } from 'vitest';
import { parsePaperDocument } from '../lib/print/print_document_parser.ts';
import { printWorkerConfig } from '../tools/print_worker_config.ts';
import { resolvePrintRenderer } from '../deploy/cloudflare/print_renderer_binding.ts';
import type { StudentPaper } from '../lib/print/print_projection.ts';

const document: StudentPaper = {
  kind: 'student',
  title: 'Exam',
  form: 'QF-TEST',
  createdAt: '2026-10-30T12:00:00Z',
  paper: 'a4',
  locale: 'es-419',
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
test('private renderer boundary preserves projected data and rejects source/staff fields and excessive trees', () => {
  expect(parsePaperDocument(document)).toBe(document);
  expect(parsePaperDocument({ ...document, source: '#eval("secret")' })).toBeNull();
  const question = document.parts[0].entries[0];
  expect(
    parsePaperDocument({
      ...document,
      parts: [{
        ...document.parts[0],
        entries: [{ ...question, marking: { rules: ['SECRET'], guidance: [] } }],
      }],
    }),
  ).toBeNull();
  expect(parsePaperDocument({ ...document, images: [{ format: 'png', bytes: [1, 2] }] }))
    .toBeNull();
  expect(
    parsePaperDocument({ ...document, images: [{ format: 'png', bytes: new Uint8Array(500001) }] }),
  ).toBeNull();
  let node: unknown = { kind: 'text', text: 'Deep' };
  for (let i = 0; i < 40; i++) node = { kind: 'group', language: 'en-US', children: [node] };
  expect(
    parsePaperDocument({
      ...document,
      parts: [{ title: 'Part', instructions: [node], entries: [] }],
    }),
  ).toBeNull();
});
test('compiler deployment requires an explicit separate service target and exposes no public route', () => {
  const main = {
    name: 'app',
    services: [{ binding: 'QFLOW_PRINT_RENDERER', service: 'app-renderer' }],
    compatibility_date: '2026-06-03',
    compatibility_flags: ['nodejs_compat'],
    limits: { cpu_ms: 300000 },
  };
  expect(printWorkerConfig(main)).toMatchObject({
    name: 'app-renderer',
    workers_dev: false,
    preview_urls: false,
  });
  expect(() => printWorkerConfig({ ...main, services: [] })).toThrow();
  expect(() =>
    printWorkerConfig({ ...main, services: [{ binding: 'QFLOW_PRINT_RENDERER', service: 'app' }] })
  ).toThrow();
  expect(() => resolvePrintRenderer({})).toThrow('QFLOW_PRINT_RENDERER');
});
