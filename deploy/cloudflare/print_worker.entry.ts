import { WorkerEntrypoint } from 'cloudflare:workers';
import { printRenderer } from './print_renderer.entry.ts';
import { parsePaperDocument } from '../../lib/print/print_document_parser.ts';
import { PRINT_RENDERER_ID, PRINT_TEMPLATE_VERSION } from '../../lib/print/print_snapshot.ts';

/** Compiler-only private Worker: no database, object storage, public routes or Workflows. */
export default class PrintRendererWorker extends WorkerEntrypoint {
  render(input: unknown) {
    if (
      !input || typeof input !== 'object' || Object.keys(input).length !== 3 ||
      Reflect.get(input, 'rendererId') !== PRINT_RENDERER_ID ||
      Reflect.get(input, 'templateVersion') !== PRINT_TEMPLATE_VERSION
    ) {
      throw Error('Print renderer request identity differs.');
    }
    const document = parsePaperDocument(Reflect.get(input, 'document'));
    if (!document) throw Error('Invalid print renderer document.');
    return printRenderer.render(document);
  }
  fetch() {
    return new Response(null, { status: 404 });
  }
}
