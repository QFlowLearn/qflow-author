import type { PaperDocument } from './print_projection.ts';
import type { PrintResult } from './print_contract.ts';

export type RenderedPaper = { readonly bytes: Uint8Array; readonly pages: number };
/** Production compilation crosses the private Worker boundary. */
export type PrintRenderer = {
  render(document: PaperDocument): Promise<PrintResult<RenderedPaper>>;
};
