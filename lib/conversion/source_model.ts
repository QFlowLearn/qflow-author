/** One structured unit extracted from source material. */
export type SourceBlock =
  | {
    readonly id: string;
    readonly kind: 'heading';
    readonly level: number;
    readonly text: string;
    readonly page?: number;
  }
  | {
    readonly id: string;
    readonly kind: 'paragraph';
    readonly text: string;
    readonly page?: number;
  }
  | {
    readonly id: string;
    readonly kind: 'list';
    readonly ordered: boolean;
    readonly items: string[];
    readonly page?: number;
  }
  | {
    readonly id: string;
    readonly kind: 'table';
    readonly rows: string[][];
    readonly page?: number;
  }
  | {
    readonly id: string;
    readonly kind: 'image';
    readonly source: string;
    readonly alt?: string;
    readonly page?: number;
  }
  | {
    readonly id: string;
    readonly kind: 'equation';
    readonly expression: string;
    readonly page?: number;
  }
  | { readonly id: string; readonly kind: 'page_boundary'; readonly page: number };

/** A known limitation in a normalized source extraction. */
export type ExtractionUncertaintyCode =
  | 'OCR_REQUIRED'
  | 'PDF_TEXT_UNAVAILABLE'
  | 'IMAGE_ALT_MISSING'
  | 'STRUCTURE_INFERRED'
  | 'SOURCE_TRUNCATED'
  | 'UNSUPPORTED_SOURCE';

/** Reviewable extraction uncertainty tied to a block or page when possible. */
export type ExtractionUncertainty = {
  readonly code: ExtractionUncertaintyCode;
  readonly message: string;
  readonly blockId?: string;
  readonly page?: number;
};

/** Canonical normalized representation of one source document. */
export type StructuredSourceDocument = {
  readonly version: 1;
  readonly title: string;
  readonly sourceKind: 'text' | 'markdown' | 'docx' | 'pdf' | 'package';
  readonly blocks: SourceBlock[];
  readonly text: string;
  readonly uncertainties: ExtractionUncertainty[];
};

/** Verified location inside a content-addressed source artifact. */
export type EvidenceAnchor =
  | {
    readonly kind: 'text_range';
    readonly artifactId: string;
    readonly artifactHash: string;
    readonly start: number;
    readonly end: number;
    readonly quote: string;
  }
  | {
    readonly kind: 'block';
    readonly artifactId: string;
    readonly artifactHash: string;
    readonly blockId: string;
    readonly quote: string;
  }
  | {
    readonly kind: 'page';
    readonly artifactId: string;
    readonly artifactHash: string;
    readonly page: number;
    readonly quote: string;
  }
  | {
    readonly kind: 'package_entry';
    readonly artifactId: string;
    readonly artifactHash: string;
    readonly path: string;
    readonly identifier?: string;
  };

/** Signals that source bytes cannot be normalized under the selected source contract. */
export class SourceExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SourceExtractionError';
  }
}

/** Return the stable identifier for the next block in a document builder. */
export function nextSourceBlockId(blocks: readonly SourceBlock[]): string {
  return `block-${blocks.length + 1}`;
}

/** Project one source block into searchable plain text. */
export function sourceBlockText(block: SourceBlock): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return block.text;
    case 'list':
      return block.items.join('\n');
    case 'table':
      return block.rows.map((row) => row.join(' | ')).join('\n');
    case 'image':
      return block.alt ?? '';
    case 'equation':
      return block.expression;
    case 'page_boundary':
      return `Page ${block.page}`;
  }
}

/** Project structured blocks into the document's canonical plain-text representation. */
export function sourceBlocksToText(blocks: readonly SourceBlock[]): string {
  return blocks.map((block) =>
    block.kind === 'page_boundary' ? `\f${sourceBlockText(block)}` : sourceBlockText(block)
  ).join('\n\n');
}

/** Return the highest known page number in a structured document. */
export function sourceDocumentPageCount(document: StructuredSourceDocument): number {
  return document.blocks.reduce((highest, block) => Math.max(highest, block.page ?? 1), 1);
}
