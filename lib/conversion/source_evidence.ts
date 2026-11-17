import {
  type EvidenceAnchor,
  sourceBlockText,
  sourceDocumentPageCount,
  type StructuredSourceDocument,
} from './source_model.ts';
import type { AIGeneratedSourceCitation } from '../ai/generation.ts';

/** Result of validating model-provided citations against one normalized artifact. */
export type ValidatedEvidence = {
  readonly anchors: EvidenceAnchor[];
  readonly errors: string[];
};

/** Render stable block/page references for the generation prompt. */
export function renderSourceForGeneration(document: StructuredSourceDocument): string {
  if (document.sourceKind === 'pdf') {
    return [
      `The source PDF contains ${sourceDocumentPageCount(document)} pages.`,
      'Cite the exact PDF page and a short verbatim quote for every generated question.',
      ...document.blocks.filter((block) => block.kind !== 'page_boundary').map((block) =>
        `[PAGE ${block.page ?? 1}]\n${sourceBlockText(block)}`
      ),
    ].join('\n');
  }
  return document.blocks.map((block) => {
    const page = block.page === undefined ? '' : ` page=${block.page}`;
    return `[BLOCK ${block.id}${page}]\n${sourceBlockText(block)}`;
  }).join('\n\n');
}

/** Validate citations and project only verified locations into persisted evidence anchors. */
export function validateGeneratedEvidence(input: {
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly document: StructuredSourceDocument;
  readonly citations: readonly AIGeneratedSourceCitation[];
}): ValidatedEvidence {
  const anchors: EvidenceAnchor[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const citation of input.citations) {
    if (citation.kind === 'page') {
      validatePageCitation(input, citation, anchors, errors, seen);
      continue;
    }
    validateBlockCitation(input, citation, anchors, errors, seen);
  }
  if (!input.citations.length) errors.push('The model did not provide source citations.');
  return { anchors, errors };
}

function validateBlockCitation(
  input: {
    readonly artifactId: string;
    readonly artifactHash: string;
    readonly document: StructuredSourceDocument;
  },
  citation: Extract<AIGeneratedSourceCitation, { readonly kind: 'block' }>,
  anchors: EvidenceAnchor[],
  errors: string[],
  seen: Set<string>,
): void {
  if (input.document.sourceKind === 'pdf') {
    errors.push('PDF evidence must cite a page, not a source block.');
    return;
  }
  const block = input.document.blocks.find((entry) => entry.id === citation.blockId);
  if (!block) {
    errors.push(`Source block "${citation.blockId}" does not exist.`);
    return;
  }
  const sourceText = sourceBlockText(block);
  const quote = citation.quote.trim();
  const start = sourceText.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
  if (!quote || start < 0) {
    errors.push(`Citation quote was not found in source block "${citation.blockId}".`);
    return;
  }
  const key = `block:${citation.blockId}:${start}:${quote.length}`;
  if (seen.has(key)) return;
  seen.add(key);
  anchors.push({
    kind: 'block',
    artifactId: input.artifactId,
    artifactHash: input.artifactHash,
    blockId: citation.blockId,
    quote: sourceText.slice(start, start + quote.length),
  });
}

function validatePageCitation(
  input: {
    readonly artifactId: string;
    readonly artifactHash: string;
    readonly document: StructuredSourceDocument;
  },
  citation: Extract<AIGeneratedSourceCitation, { readonly kind: 'page' }>,
  anchors: EvidenceAnchor[],
  errors: string[],
  seen: Set<string>,
): void {
  if (input.document.sourceKind !== 'pdf') {
    errors.push('Page evidence is only valid for PDF source material.');
    return;
  }
  const pageCount = sourceDocumentPageCount(input.document);
  if (!Number.isInteger(citation.page) || citation.page < 1 || citation.page > pageCount) {
    errors.push(`Cited PDF page ${citation.page} is outside the preserved page range.`);
    return;
  }
  const quote = citation.quote.trim();
  if (!quote) {
    errors.push(`Cited PDF page ${citation.page} is missing a source quote.`);
    return;
  }
  const pageText = input.document.blocks.filter((block) =>
    block.page === citation.page && block.kind !== 'page_boundary'
  ).map(sourceBlockText).join('\n');
  const normalizedText = normalizePdfQuote(pageText);
  const normalizedQuote = normalizePdfQuote(quote);
  if (!normalizedText.includes(normalizedQuote)) {
    errors.push(
      `Citation quote could not be verified in the extracted text of PDF page ${citation.page}.`,
    );
    return;
  }
  const key = `page:${citation.page}:${normalizedQuote}`;
  if (seen.has(key)) return;
  seen.add(key);
  anchors.push({
    kind: 'page',
    artifactId: input.artifactId,
    artifactHash: input.artifactHash,
    page: citation.page,
    quote,
  });
}

function normalizePdfQuote(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}
