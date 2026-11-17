import { extractDocxDocument } from './extract_docx_source.ts';
import { extractPdfDocument } from './extract_pdf_source.ts';
import { extractTextDocument } from './extract_text_source.ts';
import { SourceExtractionError, type StructuredSourceDocument } from './source_model.ts';

type ExtractableSourceKind = 'text' | 'markdown' | 'docx' | 'pdf';

/** Return whether filename and MIME identify one supported source format. */
export function isStructuredSourceExtractable(input: {
  readonly filename: string;
  readonly mimeType?: string | null;
}): boolean {
  return classifySourceKind(input) !== null;
}

/** Extract one supported source into the canonical structured document model. */
export async function extractStructuredSource(input: {
  readonly filename: string;
  readonly mimeType?: string | null;
  readonly bytes: Uint8Array;
}): Promise<StructuredSourceDocument> {
  const filename = input.filename.trim();
  if (!filename) throw new SourceExtractionError('Source filename is required.');
  const kind = classifySourceKind({ filename, mimeType: input.mimeType });
  if (!kind) {
    throw new SourceExtractionError(
      `Unsupported source format for structured extraction: ${filename}`,
    );
  }
  switch (kind) {
    case 'docx':
      return await extractDocxDocument(filename, input.bytes);
    case 'pdf':
      return await extractPdfDocument(filename, input.bytes);
    case 'markdown':
    case 'text':
      return extractTextDocument(filename, kind, new TextDecoder().decode(input.bytes));
  }
}

function classifySourceKind(input: {
  readonly filename: string;
  readonly mimeType?: string | null;
}): ExtractableSourceKind | null {
  const lowerName = input.filename.trim().toLowerCase();
  const mime = input.mimeType?.split(';', 1)[0].trim().toLowerCase() ?? '';
  if (
    lowerName.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (lowerName.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (
    lowerName.endsWith('.md') || lowerName.endsWith('.markdown') ||
    mime === 'text/markdown'
  ) {
    return 'markdown';
  }
  if (mime.startsWith('text/') || lowerName.endsWith('.txt')) return 'text';
  return null;
}
