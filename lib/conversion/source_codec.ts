import {
  type EvidenceAnchor,
  type ExtractionUncertainty,
  type ExtractionUncertaintyCode,
  type SourceBlock,
  sourceBlocksToText,
  type StructuredSourceDocument,
} from './source_model.ts';

/** Signals that persisted normalized source data violates the canonical contract. */
export class InvalidStoredSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStoredSourceError';
  }
}

/** Parse one persisted structured source document without repairing invalid data. */
export function parseStructuredSourceDocument(value: unknown): StructuredSourceDocument {
  const record = parseRecord(value, 'Structured source document must be an object.');
  assertExactKeys(
    record,
    ['version', 'title', 'sourceKind', 'blocks', 'text', 'uncertainties'],
    ['version', 'title', 'sourceKind', 'blocks', 'text', 'uncertainties'],
    'structured source document',
  );
  if (record.version !== 1) throw invalid('Structured source document version must be 1.');
  const title = parseNonEmptyString(record.title, 'Structured source title is required.');
  const sourceKind = parseSourceKind(record.sourceKind);
  const blockValues = parseArray(record.blocks, 'Structured source blocks must be an array.');
  const uncertaintyValues = parseArray(
    record.uncertainties,
    'Structured source uncertainties must be an array.',
  );
  const blocks = blockValues.map(parseSourceBlock);
  const blockIds = new Set(blocks.map((block) => block.id));
  if (blockIds.size !== blocks.length) throw invalid('Structured source block IDs must be unique.');
  const uncertainties = uncertaintyValues.map(parseExtractionUncertainty);
  const text = parseString(record.text, 'Structured source text is required.');
  if (text !== sourceBlocksToText(blocks)) {
    throw invalid('Structured source text does not match its blocks.');
  }
  return { version: 1, title, sourceKind, blocks, text, uncertainties };
}

/** Parse every persisted evidence anchor or reject the complete collection. */
export function parseEvidenceAnchors(value: unknown): EvidenceAnchor[] {
  return parseArray(value, 'Conversion item evidence must be an array.').map(parseEvidenceAnchor);
}

/** Parse every persisted extraction uncertainty or reject the complete collection. */
export function parseExtractionUncertainties(value: unknown): ExtractionUncertainty[] {
  return parseArray(
    value,
    'Conversion item extraction uncertainties must be an array.',
  ).map(parseExtractionUncertainty);
}

function parseSourceBlock(value: unknown): SourceBlock {
  const record = parseRecord(value, 'Source block must be an object.');
  const id = parseNonEmptyString(record.id, 'Source block ID is required.');
  const page = record.page === undefined
    ? undefined
    : parsePositiveInteger(record.page, 'Source block page must be a positive integer.');
  switch (record.kind) {
    case 'heading':
      assertSourceBlockKeys(record, ['id', 'kind', 'level', 'text', 'page'], [
        'id',
        'kind',
        'level',
        'text',
      ]);
      return {
        id,
        kind: 'heading',
        level: parseIntegerInRange(record.level, 1, 6, 'Heading level must be between 1 and 6.'),
        text: parseNonEmptyString(record.text, 'Heading text is required.'),
        page,
      };
    case 'paragraph':
      assertSourceBlockKeys(record, ['id', 'kind', 'text', 'page'], ['id', 'kind', 'text']);
      return {
        id,
        kind: 'paragraph',
        text: parseNonEmptyString(record.text, 'Paragraph text is required.'),
        page,
      };
    case 'list': {
      assertSourceBlockKeys(
        record,
        ['id', 'kind', 'ordered', 'items', 'page'],
        ['id', 'kind', 'ordered', 'items'],
      );
      const items = parseArray(record.items, 'List items must be an array.').map((item) =>
        parseNonEmptyString(item, 'List item text is required.')
      );
      if (!items.length) throw invalid('Source list must contain at least one item.');
      if (typeof record.ordered !== 'boolean') {
        throw invalid('Source list ordered flag must be boolean.');
      }
      return { id, kind: 'list', ordered: record.ordered, items, page };
    }
    case 'table': {
      assertSourceBlockKeys(record, ['id', 'kind', 'rows', 'page'], ['id', 'kind', 'rows']);
      const rows = parseArray(record.rows, 'Table rows must be an array.').map((row) =>
        parseArray(row, 'Table row must be an array.').map((cell) =>
          parseString(cell, 'Table cells must be strings.')
        )
      );
      if (!rows.length) throw invalid('Source table must contain at least one row.');
      return { id, kind: 'table', rows, page };
    }
    case 'image': {
      assertSourceBlockKeys(
        record,
        ['id', 'kind', 'source', 'alt', 'page'],
        ['id', 'kind', 'source'],
      );
      const source = parseNonEmptyString(record.source, 'Source image relationship is required.');
      const alt = record.alt === undefined
        ? undefined
        : parseNonEmptyString(record.alt, 'Source image alternative text cannot be empty.');
      return { id, kind: 'image', source, alt, page };
    }
    case 'equation':
      assertSourceBlockKeys(
        record,
        ['id', 'kind', 'expression', 'page'],
        ['id', 'kind', 'expression'],
      );
      return {
        id,
        kind: 'equation',
        expression: parseNonEmptyString(record.expression, 'Source equation is required.'),
        page,
      };
    case 'page_boundary':
      assertSourceBlockKeys(record, ['id', 'kind', 'page'], ['id', 'kind', 'page']);
      return {
        id,
        kind: 'page_boundary',
        page: parsePositiveInteger(record.page, 'Page boundary must have a positive page number.'),
      };
    default:
      throw invalid(`Unsupported source block kind: ${String(record.kind)}`);
  }
}

function parseEvidenceAnchor(value: unknown): EvidenceAnchor {
  const record = parseRecord(value, 'Evidence anchor must be an object.');
  const artifactId = parseNonEmptyString(record.artifactId, 'Evidence artifact ID is required.');
  const artifactHash = parseNonEmptyString(
    record.artifactHash,
    'Evidence artifact hash is required.',
  );
  if (!/^[0-9a-f]{64}$/.test(artifactHash)) {
    throw invalid('Evidence artifact hash must be a lowercase SHA-256 digest.');
  }
  switch (record.kind) {
    case 'text_range': {
      assertExactKeys(
        record,
        ['kind', 'artifactId', 'artifactHash', 'start', 'end', 'quote'],
        ['kind', 'artifactId', 'artifactHash', 'start', 'end', 'quote'],
        'text-range evidence',
      );
      const start = parseNonNegativeInteger(
        record.start,
        'Evidence text start must be a non-negative integer.',
      );
      const end = parsePositiveInteger(record.end, 'Evidence text end must be a positive integer.');
      if (end <= start) throw invalid('Evidence text end must be greater than its start.');
      return {
        kind: 'text_range',
        artifactId,
        artifactHash,
        start,
        end,
        quote: parseNonEmptyString(record.quote, 'Evidence quote is required.'),
      };
    }
    case 'block':
      assertExactKeys(
        record,
        ['kind', 'artifactId', 'artifactHash', 'blockId', 'quote'],
        ['kind', 'artifactId', 'artifactHash', 'blockId', 'quote'],
        'block evidence',
      );
      return {
        kind: 'block',
        artifactId,
        artifactHash,
        blockId: parseNonEmptyString(record.blockId, 'Evidence block ID is required.'),
        quote: parseNonEmptyString(record.quote, 'Evidence quote is required.'),
      };
    case 'page':
      assertExactKeys(
        record,
        ['kind', 'artifactId', 'artifactHash', 'page', 'quote'],
        ['kind', 'artifactId', 'artifactHash', 'page', 'quote'],
        'page evidence',
      );
      return {
        kind: 'page',
        artifactId,
        artifactHash,
        page: parsePositiveInteger(record.page, 'Evidence page must be a positive integer.'),
        quote: parseNonEmptyString(record.quote, 'Evidence quote is required.'),
      };
    case 'package_entry': {
      assertExactKeys(
        record,
        ['kind', 'artifactId', 'artifactHash', 'path', 'identifier'],
        ['kind', 'artifactId', 'artifactHash', 'path'],
        'package-entry evidence',
      );
      const identifier = record.identifier === undefined
        ? undefined
        : parseNonEmptyString(record.identifier, 'Package evidence identifier cannot be empty.');
      return {
        kind: 'package_entry',
        artifactId,
        artifactHash,
        path: parseNonEmptyString(record.path, 'Package evidence path is required.'),
        identifier,
      };
    }
    default:
      throw invalid(`Unsupported evidence anchor kind: ${String(record.kind)}`);
  }
}

function parseExtractionUncertainty(value: unknown): ExtractionUncertainty {
  const record = parseRecord(value, 'Extraction uncertainty must be an object.');
  assertExactKeys(
    record,
    ['code', 'message', 'blockId', 'page'],
    ['code', 'message'],
    'extraction uncertainty',
  );
  const code = parseUncertaintyCode(record.code);
  const blockId = record.blockId === undefined
    ? undefined
    : parseNonEmptyString(record.blockId, 'Extraction uncertainty block ID cannot be empty.');
  const page = record.page === undefined
    ? undefined
    : parsePositiveInteger(record.page, 'Extraction uncertainty page must be positive.');
  return {
    code,
    message: parseNonEmptyString(record.message, 'Extraction uncertainty message is required.'),
    blockId,
    page,
  };
}

function parseSourceKind(value: unknown): StructuredSourceDocument['sourceKind'] {
  if (
    value === 'text' || value === 'markdown' || value === 'docx' || value === 'pdf' ||
    value === 'package'
  ) {
    return value;
  }
  throw invalid(`Unsupported structured source kind: ${String(value)}`);
}

function parseUncertaintyCode(value: unknown): ExtractionUncertaintyCode {
  if (
    value === 'OCR_REQUIRED' || value === 'PDF_TEXT_UNAVAILABLE' ||
    value === 'IMAGE_ALT_MISSING' || value === 'STRUCTURE_INFERRED' ||
    value === 'SOURCE_TRUNCATED' || value === 'UNSUPPORTED_SOURCE'
  ) {
    return value;
  }
  throw invalid(`Unsupported extraction uncertainty code: ${String(value)}`);
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(message);
  // SAFETY: the runtime checks above establish a non-array object boundary.
  return value as Record<string, unknown>;
}

function assertSourceBlockKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  assertExactKeys(record, allowed, required, `${String(record.kind)} source block`);
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  const missing = required.filter((key) => !(key in record));
  if (unknown.length || missing.length) {
    throw invalid(
      `Invalid ${label} keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}

function parseArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(message);
  return value;
}

function parseString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw invalid(message);
  return value;
}

function parseNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(message);
  return value.trim();
}

function parseNonNegativeInteger(value: unknown, message: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0) throw invalid(message);
  return value;
}

function parsePositiveInteger(value: unknown, message: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1) throw invalid(message);
  return value;
}

function parseIntegerInRange(value: unknown, min: number, max: number, message: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < min || value > max) {
    throw invalid(message);
  }
  return value;
}

function invalid(message: string): InvalidStoredSourceError {
  return new InvalidStoredSourceError(message);
}
