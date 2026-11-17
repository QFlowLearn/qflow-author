import { printDocumentFontsSupported, printFontCoverage } from './print_fonts.ts';
import { initSync, TypstCompilerBuilder } from '../../vendor/typst/typst_ts_web_compiler.js';
import template from './print_template.txt';
import type { PaperDocument } from './print_projection.ts';
import type { PrintResult } from './print_contract.ts';

/** Runtime capability: only explicit student or staff projections can enter the compiler. */
type PrintCompiler = {
  render(
    document: PaperDocument,
  ): PrintResult<{ readonly bytes: Uint8Array; readonly pages: number }>;
};

/** Construct once at the true Worker composition root; no request-time evaluation or resource fetch. */
export async function createPrintRenderer(
  module: WebAssembly.Module,
  fonts: readonly ArrayBuffer[],
): Promise<PrintCompiler> {
  const supports = printFontCoverage(fonts);
  initSync({ module });
  const builder = new TypstCompilerBuilder();
  builder.set_dummy_access_model();
  for (const font of fonts) await builder.add_raw_font(new Uint8Array(font));
  const compiler = await builder.build();
  return {
    render(document) {
      if (!printDocumentFontsSupported(document, supports)) {
        return { ok: false, code: 'font_unsupported' };
      }
      // Only content and generated local paths cross the JSON boundary. Image bytes stay binary.
      const { images, ...content } = document;
      const files = images.map((image, index) => `/images/${index}.${image.format}`);
      const input = JSON.stringify({ ...content, images: files });
      if (
        new TextEncoder().encode(input).length +
            images.reduce((total, image) => total + image.bytes.length, 0) > 2000000
      ) {
        return { ok: false, code: 'render_failed' };
      }
      let world: ReturnType<typeof compiler.snapshot> | undefined;
      try {
        if (!compiler.add_source('/paper.typ', template)) {
          return { ok: false, code: 'render_failed' };
        }
        for (const [index, image] of images.entries()) {
          if (!compiler.map_shadow(files[index], image.bytes)) {
            return { ok: false, code: 'render_failed' };
          }
        }
        world = compiler.snapshot(undefined, '/paper.typ', [['document', input]]);
        world.set_pdf_opts({
          creation_timestamp: Math.floor(Date.parse(document.createdAt) / 1000),
          pdf_tags: true,
        });
        const diagnostics: unknown = world.compile(0, 3);
        if (
          !diagnostics || typeof diagnostics !== 'object' ||
          Reflect.get(diagnostics, 'hasError') !== false ||
          !Array.isArray(Reflect.get(diagnostics, 'diagnostics')) ||
          Reflect.get(diagnostics, 'diagnostics').length !== 0
        ) return { ok: false, code: 'render_failed' };
        const bytes: unknown = world.get_artifact(1, 0);
        if (!(bytes instanceof Uint8Array) || bytes.length > 10000000) {
          return { ok: false, code: 'render_failed' };
        }
        const rawPages: unknown = JSON.parse(world.query(0, '<qflow-page-count>', 'value'));
        const pages = Array.isArray(rawPages) && rawPages.length === 1 ? rawPages[0] : null;
        if (typeof pages !== 'number' || !Number.isSafeInteger(pages) || pages < 1 || pages > 100) {
          return { ok: false, code: 'render_failed' };
        }
        return { ok: true, value: { bytes, pages } };
      } catch {
        return { ok: false, code: 'render_failed' };
      } finally {
        try {
          world?.free();
        } finally {
          try {
            compiler.reset_shadow();
          } finally {
            compiler.evict_cache(0);
          }
        }
      }
    },
  };
}
