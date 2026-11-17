import module from '../../vendor/typst/typst_ts_web_compiler_bg.wasm';
import regular from '../../vendor/typst/NewCM10-Regular.otf.bin';
import bold from '../../vendor/typst/NewCM10-Bold.otf.bin';
import italic from '../../vendor/typst/NewCM10-Italic.otf.bin';
import math from '../../vendor/typst/NewCMMath-Regular.otf.bin';
import { createPrintRenderer } from '../../lib/print/print_renderer.ts';

/** One immutable startup compiler; request worlds are freed and caches evicted by the adapter. */
export const printRenderer = await createPrintRenderer(module, [regular, bold, italic, math]);
