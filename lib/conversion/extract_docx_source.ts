import { DOMParser } from '@xmldom/xmldom';

import {
  formatSourceByteLimit,
  MAX_SOURCE_ARCHIVE_ENTRIES,
  MAX_SOURCE_ARCHIVE_EXPANDED_BYTES,
  MAX_SOURCE_FILE_BYTES,
} from '../source_intake/policy.ts';
import {
  withZipArchive,
  type ZipArchive,
  ZipArchiveLimitError,
  type ZipArchiveReadLimits,
} from '../zip_archive.ts';
import {
  type ExtractionUncertainty,
  nextSourceBlockId,
  type SourceBlock,
  sourceBlocksToText,
  SourceExtractionError,
  type StructuredSourceDocument,
} from './source_model.ts';

const DOCX_ARCHIVE_READ_LIMITS: ZipArchiveReadLimits = {
  maxCompressedBytes: MAX_SOURCE_FILE_BYTES,
  maxEntries: MAX_SOURCE_ARCHIVE_ENTRIES,
  maxTotalUncompressedBytes: MAX_SOURCE_ARCHIVE_EXPANDED_BYTES,
};

/** Extract Word paragraphs, headings, lists, tables, images, equations, and page breaks. */
export async function extractDocxDocument(
  title: string,
  bytes: Uint8Array,
): Promise<StructuredSourceDocument> {
  try {
    return await withZipArchive(bytes, DOCX_ARCHIVE_READ_LIMITS, async (zip) => {
      await zip.verify();
      return await extractDocxArchive(title, zip);
    });
  } catch (cause: unknown) {
    throw docxExtractionError(cause);
  }
}

async function extractDocxArchive(
  title: string,
  zip: ZipArchive,
): Promise<StructuredSourceDocument> {
  const documentEntry = zip.file('word/document.xml');
  if (!documentEntry) throw new SourceExtractionError('DOCX is missing word/document.xml.');
  const xml = await documentEntry.async('string');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (!document || firstByLocalName(document, 'parsererror')) {
    throw new SourceExtractionError('DOCX document XML is invalid.');
  }

  const blocks: SourceBlock[] = [];
  const uncertainties: ExtractionUncertainty[] = [];
  let page = 1;
  const body = firstByLocalName(document, 'body');
  if (!body) throw new SourceExtractionError('DOCX does not contain a document body.');

  for (const node of elementChildren(body)) {
    const localName = node.localName || node.nodeName.split(':').at(-1);
    if (localName === 'tbl') {
      const rows = descendantsByLocalName(node, 'tr').map((row) =>
        descendantsByLocalName(row, 'tc').map((cell) => nodeText(cell))
      );
      blocks.push({ id: nextSourceBlockId(blocks), kind: 'table', rows, page });
      continue;
    }
    if (localName !== 'p') continue;

    const pageBreaks = descendantsByLocalName(node, 'br').filter((entry) =>
      entry.getAttribute('w:type') === 'page' || entry.getAttribute('type') === 'page'
    );
    if (pageBreaks.length) {
      page += pageBreaks.length;
      blocks.push({ id: nextSourceBlockId(blocks), kind: 'page_boundary', page });
    }
    const text = nodeText(node);
    const equation = firstByLocalName(node, 'oMath') ?? firstByLocalName(node, 'oMathPara');
    if (equation) {
      blocks.push({
        id: nextSourceBlockId(blocks),
        kind: 'equation',
        expression: text || nodeText(equation),
        page,
      });
      continue;
    }
    const drawings = descendantsByLocalName(node, 'drawing');
    for (const drawing of drawings) {
      const description = firstByLocalName(drawing, 'docPr')?.getAttribute('descr')?.trim();
      const relationshipId = firstByLocalName(drawing, 'blip')?.getAttribute('r:embed')?.trim();
      if (!relationshipId) {
        throw new SourceExtractionError('An embedded Word image is missing its relationship ID.');
      }
      const id = nextSourceBlockId(blocks);
      blocks.push({
        id,
        kind: 'image',
        source: relationshipId,
        alt: description || undefined,
        page,
      });
      if (!description) {
        uncertainties.push({
          code: 'IMAGE_ALT_MISSING',
          message: 'An embedded Word image does not include alternative text.',
          blockId: id,
          page,
        });
      }
    }
    if (!text) continue;
    const style = firstByLocalName(node, 'pStyle')?.getAttribute('w:val') ??
      firstByLocalName(node, 'pStyle')?.getAttribute('val') ?? '';
    const heading = style.match(/^Heading([1-6])$/i);
    if (heading) {
      blocks.push({
        id: nextSourceBlockId(blocks),
        kind: 'heading',
        level: Number(heading[1]),
        text,
        page,
      });
      continue;
    }
    if (firstByLocalName(node, 'numPr')) {
      const previous = blocks.at(-1);
      if (previous?.kind === 'list' && previous.page === page) {
        previous.items.push(text);
      } else {
        blocks.push({
          id: nextSourceBlockId(blocks),
          kind: 'list',
          ordered: false,
          items: [text],
          page,
        });
      }
      continue;
    }
    blocks.push({ id: nextSourceBlockId(blocks), kind: 'paragraph', text, page });
  }

  return {
    version: 1,
    title,
    sourceKind: 'docx',
    blocks,
    text: sourceBlocksToText(blocks),
    uncertainties,
  };
}

function docxExtractionError(cause: unknown): SourceExtractionError {
  if (cause instanceof SourceExtractionError) return cause;
  if (cause instanceof ZipArchiveLimitError) {
    if (cause.code === 'compressed_size') {
      return new SourceExtractionError(
        `DOCX sources must be ${formatSourceByteLimit(MAX_SOURCE_FILE_BYTES)} or smaller.`,
      );
    }
    if (cause.code === 'entry_count') {
      return new SourceExtractionError(
        `DOCX sources may contain no more than ${MAX_SOURCE_ARCHIVE_ENTRIES.toLocaleString()} files and folders.`,
      );
    }
    return new SourceExtractionError(
      `DOCX sources must contain no more than ${
        formatSourceByteLimit(MAX_SOURCE_ARCHIVE_EXPANDED_BYTES)
      } after extraction.`,
    );
  }
  return new SourceExtractionError('Unable to open the DOCX source.');
}

function elementChildren(node: Node): Element[] {
  const elements: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index++) {
    const child = node.childNodes.item(index);
    if (child?.nodeType === 1) elements.push(child as Element);
  }
  return elements;
}

function descendantsByLocalName(node: Node, localName: string): Element[] {
  const matches: Element[] = [];
  const all = (node as Element).getElementsByTagName('*');
  for (let index = 0; index < all.length; index++) {
    const entry = all.item(index);
    if (entry && (entry.localName || entry.nodeName.split(':').at(-1)) === localName) {
      matches.push(entry);
    }
  }
  return matches;
}

function firstByLocalName(node: Node, localName: string): Element | null {
  if (
    node.nodeType === 1 &&
    (((node as Element).localName || node.nodeName.split(':').at(-1)) === localName)
  ) {
    return node as Element;
  }
  return descendantsByLocalName(node, localName)[0] ?? null;
}

function nodeText(node: Node): string {
  return descendantsByLocalName(node, 't')
    .map((entry) => entry.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
