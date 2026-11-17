import {
  type ExtractionUncertainty,
  nextSourceBlockId,
  type SourceBlock,
  sourceBlocksToText,
  type StructuredSourceDocument,
} from './source_model.ts';

/** Extract headings, lists, tables, images, equations, pages, and paragraphs from text. */
export function extractTextDocument(
  title: string,
  sourceKind: 'text' | 'markdown',
  raw: string,
): StructuredSourceDocument {
  const normalized = normalizeLineEndings(raw);
  const blocks: SourceBlock[] = [];
  const uncertainties: ExtractionUncertainty[] = [];
  const lines = normalized.split('\n');
  let page = 1;
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    if (rawLine.includes('\f')) {
      const segments = rawLine.split('\f');
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        appendParagraph(blocks, segments[segmentIndex].trim(), page);
        if (segmentIndex < segments.length - 1) {
          page += 1;
          blocks.push({ id: nextSourceBlockId(blocks), kind: 'page_boundary', page });
        }
      }
      index += 1;
      continue;
    }

    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        id: nextSourceBlockId(blocks),
        kind: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
        page,
      });
      index += 1;
      continue;
    }

    if (/^\$\$\s*$/.test(line)) {
      const equationLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index])) {
        equationLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        id: nextSourceBlockId(blocks),
        kind: 'equation',
        expression: equationLines.join('\n').trim(),
        page,
      });
      continue;
    }

    const inlineEquation = line.match(/^\$\$(.+)\$\$$/);
    if (inlineEquation) {
      blocks.push({
        id: nextSourceBlockId(blocks),
        kind: 'equation',
        expression: inlineEquation[1].trim(),
        page,
      });
      index += 1;
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const id = nextSourceBlockId(blocks);
      const alt = image[1].trim();
      blocks.push({
        id,
        kind: 'image',
        source: image[2].trim(),
        alt: alt || undefined,
        page,
      });
      if (!alt) {
        uncertainties.push({
          code: 'IMAGE_ALT_MISSING',
          message: 'The source image does not include alternative text.',
          blockId: id,
          page,
        });
      }
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const rows = [parseTableRow(line)];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].trim())) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ id: nextSourceBlockId(blocks), kind: 'table', rows, page });
      continue;
    }

    const listMatch = line.match(/^(\d+[.)]|[-*+])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items = [listMatch[2].trim()];
      index += 1;
      while (index < lines.length) {
        const next = lines[index].trim().match(/^(\d+[.)]|[-*+])\s+(.+)$/);
        if (!next || /^\d/.test(next[1]) !== ordered) break;
        items.push(next[2].trim());
        index += 1;
      }
      blocks.push({ id: nextSourceBlockId(blocks), kind: 'list', ordered, items, page });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsStructuredBlock(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    appendParagraph(blocks, paragraphLines.join(' '), page);
  }

  if (sourceKind === 'text' && blocks.some((block) => block.kind !== 'paragraph')) {
    uncertainties.push({
      code: 'STRUCTURE_INFERRED',
      message: 'Document structure was inferred from plain-text markers.',
    });
  }

  return {
    version: 1,
    title,
    sourceKind,
    blocks,
    text: sourceBlocksToText(blocks),
    uncertainties,
  };
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\0', '').replace(/\r\n?/g, '\n');
}

function appendParagraph(blocks: SourceBlock[], text: string, page: number): void {
  if (text) blocks.push({ id: nextSourceBlockId(blocks), kind: 'paragraph', text, page });
}

function startsStructuredBlock(lines: string[], index: number): boolean {
  const line = lines[index].trim();
  return /^(#{1,6})\s+/.test(line) ||
    /^(\d+[.)]|[-*+])\s+/.test(line) ||
    /^\$\$/.test(line) ||
    /^!\[/.test(line) ||
    (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1]));
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.split('|').filter((part) => part.trim()).length >= 2;
}

function isTableDivider(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}
