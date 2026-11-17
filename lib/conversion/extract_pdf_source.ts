import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import {
  type ExtractionUncertainty,
  nextSourceBlockId,
  type SourceBlock,
  sourceBlocksToText,
  SourceExtractionError,
  type StructuredSourceDocument,
} from './source_model.ts';

/** Read embedded PDF text, preserving real page numbers and reporting unreadable content only. */
export async function extractPdfDocument(
  title: string,
  bytes: Uint8Array,
): Promise<StructuredSourceDocument> {
  // PDF.js owns its input buffer. Keep the caller's preserved source bytes intact.
  const pdf = await getDocumentProxy(bytes.slice(), {
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
  }).catch((cause: unknown) => {
    throw new SourceExtractionError(
      'This PDF could not be opened. Check that it is not damaged or password protected.',
      { cause },
    );
  });
  try {
    const { OPS } = await getResolvedPDFJS();
    const imageOperations = new Set([
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
      OPS.paintImageXObjectRepeat,
      OPS.paintImageMaskXObjectRepeat,
      OPS.paintInlineImageXObjectGroup,
      OPS.paintImageMaskXObjectGroup,
    ]);
    const blocks: SourceBlock[] = [];
    const uncertainties: ExtractionUncertainty[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (pageNumber > 1) {
        blocks.push({ id: nextSourceBlockId(blocks), kind: 'page_boundary', page: pageNumber });
      }
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) =>
        'str' in item ? [item.str + (item.hasEOL ? '\n' : '')] : []
      ).join('').trim();
      if (text) {
        blocks.push({ id: nextSourceBlockId(blocks), kind: 'paragraph', text, page: pageNumber });
      }
      const operators = await page.getOperatorList();
      const hasImage = operators.fnArray.some((operation) => imageOperations.has(operation));
      if (hasImage) {
        const id = nextSourceBlockId(blocks);
        blocks.push({ id, kind: 'image', source: `pdf:page:${pageNumber}`, page: pageNumber });
        uncertainties.push({
          code: text ? 'IMAGE_ALT_MISSING' : 'OCR_REQUIRED',
          message: text
            ? `Page ${pageNumber} includes image content retained in the original PDF for automatic file reading.`
            : `Page ${pageNumber} contains image content without readable text. The original PDF is retained for automatic file reading.`,
          blockId: id,
          page: pageNumber,
        });
      }
      if (!text && operators.fnArray.length) {
        uncertainties.push({
          code: 'PDF_TEXT_UNAVAILABLE',
          message:
            `No embedded text was readable on page ${pageNumber}. The original PDF is retained for automatic file reading.`,
          page: pageNumber,
        });
      }
      page.cleanup();
    }
    return {
      version: 1,
      title,
      sourceKind: 'pdf',
      blocks,
      text: sourceBlocksToText(blocks),
      uncertainties,
    };
  } catch (cause: unknown) {
    if (cause instanceof SourceExtractionError) throw cause;
    throw new SourceExtractionError(
      'This PDF could not be read completely. Its original file has been preserved.',
      { cause },
    );
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Decide automatically whether generation needs the original PDF's unreadable or visual content. */
export function pdfNeedsFileExtraction(document: StructuredSourceDocument): boolean {
  return document.sourceKind === 'pdf' &&
    document.uncertainties.some((entry) =>
      entry.code === 'PDF_TEXT_UNAVAILABLE' || entry.code === 'OCR_REQUIRED' ||
      entry.code === 'IMAGE_ALT_MISSING'
    );
}
