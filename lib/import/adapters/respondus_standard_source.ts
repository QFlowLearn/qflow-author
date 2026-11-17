import { extractDocxDocument } from '../../conversion/extract_docx_source.ts';
import {
  nextSourceBlockId,
  type SourceBlock,
  sourceBlocksToText,
  sourceBlockText,
  type StructuredSourceDocument,
} from '../../conversion/source_model.ts';
import type { ImportSource } from '../types.ts';

/** One parseable line tied to an exact normalized-source block. */
export type RespondusSourceLine = {
  readonly line: number;
  readonly blockId: string;
  readonly text: string;
};

/** Signals that a selected source cannot be decoded as a supported Respondus document. */
class RespondusSourceError extends Error {
  readonly _tag = 'RespondusSourceError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RespondusSourceError';
  }
}

/** Decode a TXT or DOCX source into the normalized document used by parsing and evidence. */
export async function extractRespondusSource(
  source: ImportSource,
): Promise<StructuredSourceDocument> {
  const filename = source.filename?.trim();
  if (!filename) throw new RespondusSourceError('Respondus source filename is required.');

  const kind = classifyRespondusSource(source);
  if (kind === 'docx') {
    try {
      return await extractDocxDocument(filename, source.bytes);
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : 'Unable to decode the DOCX source.';
      throw new RespondusSourceError(`Respondus DOCX could not be read: ${detail}`);
    }
  }
  if (kind !== 'text') {
    throw new RespondusSourceError('Respondus recovery supports UTF-8 TXT and DOCX sources.');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
  } catch (_cause: unknown) {
    throw new RespondusSourceError('Respondus text sources must use UTF-8 encoding.');
  }
  const blocks: SourceBlock[] = [];
  for (const rawLine of text.replaceAll('\0', '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    blocks.push({
      id: nextSourceBlockId(blocks),
      kind: 'paragraph',
      text: line,
      page: 1,
    });
  }
  return {
    version: 1,
    title: filename,
    sourceKind: 'text',
    blocks,
    text: sourceBlocksToText(blocks),
    uncertainties: [],
  };
}

/** Project a normalized source into the logical lines consumed by the strict grammar. */
export function respondusSourceLines(
  document: StructuredSourceDocument,
): RespondusSourceLine[] {
  const lines: RespondusSourceLine[] = [];
  for (const block of document.blocks) {
    if (block.kind === 'page_boundary') continue;
    const text = block.kind === 'image'
      ? `[embedded image: ${block.source}${block.alt ? `; alt=${block.alt}` : ''}]`
      : sourceBlockText(block);
    for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      lines.push({
        line: lines.length + 1,
        blockId: block.id,
        text: line,
      });
    }
  }
  return lines;
}

/** Return whether the external source is a supported Respondus container. */
export function classifyRespondusSource(source: ImportSource): 'text' | 'docx' | null {
  const filename = source.filename?.trim().toLowerCase() ?? '';
  const mime = source.mime?.split(';', 1)[0].trim().toLowerCase() ?? '';
  if (
    filename.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (
    filename.endsWith('.txt') ||
    filename.endsWith('.respondus') ||
    mime === 'text/plain'
  ) {
    return 'text';
  }
  return null;
}
