import type { PrintRenderer } from '../../lib/print/print_renderer_contract.ts';
import { PRINT_RENDERER_ID, PRINT_TEMPLATE_VERSION } from '../../lib/print/print_snapshot.ts';

/** Private service adapter. Missing configuration and transport failures stay retryable defects. */
export function resolvePrintRenderer(bindings: Record<string, unknown>): PrintRenderer {
  const service = bindings.QFLOW_PRINT_RENDERER;
  if (
    !service || typeof service !== 'object' || typeof Reflect.get(service, 'render') !== 'function'
  ) {
    throw Error('QFLOW_PRINT_RENDERER service binding is required.');
  }
  return {
    async render(document) {
      const result: unknown = await Reflect.apply(Reflect.get(service, 'render'), service, [{
        rendererId: PRINT_RENDERER_ID,
        templateVersion: PRINT_TEMPLATE_VERSION,
        document,
      }]);
      if (!result || typeof result !== 'object') throw Error('Invalid print renderer response.');
      if (Reflect.get(result, 'ok') === false) {
        const code: unknown = Reflect.get(result, 'code');
        if (code === 'render_failed' || code === 'font_unsupported') return { ok: false, code };
      }
      const value: unknown = Reflect.get(result, 'value');
      if (Reflect.get(result, 'ok') === true && value && typeof value === 'object') {
        const bytes: unknown = Reflect.get(value, 'bytes'),
          pages: unknown = Reflect.get(value, 'pages');
        if (
          bytes instanceof Uint8Array && bytes.length >= 5 && bytes.length <= 10000000 &&
          new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-' &&
          typeof pages === 'number' && Number.isSafeInteger(pages) && pages >= 1 && pages <= 100
        ) {
          return { ok: true, value: { bytes, pages } };
        }
      }
      throw Error('Invalid print renderer response.');
    },
  };
}
