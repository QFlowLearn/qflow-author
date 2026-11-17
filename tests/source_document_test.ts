import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { extractTextDocument } from '../lib/conversion/extract_text_source.ts';
import { extractStructuredSource } from '../lib/conversion/source_extraction.ts';
import { pdfNeedsFileExtraction } from '../lib/conversion/extract_pdf_source.ts';
import { parseStructuredSourceDocument } from '../lib/conversion/source_codec.ts';
import { sourceDocumentPageCount, SourceExtractionError } from '../lib/conversion/source_model.ts';
import { pdfFixture } from './helpers/pdf_fixture.ts';

const FIXTURE_ROOT = new URL('./fixtures/conversion/', import.meta.url);

testCase('wedge fixtures preserve exposed document structure', async () => {
  const cases = [
    ['clean.md', ['heading', 'paragraph', 'list']],
    [
      'loosely-formatted.txt',
      ['paragraph', 'paragraph', 'list', 'page_boundary', 'paragraph', 'paragraph'],
    ],
    ['table-heavy.md', ['heading', 'table', 'table']],
    ['image-heavy.md', ['heading', 'image', 'image']],
    ['equation-heavy.md', ['heading', 'equation', 'equation']],
  ] as const;

  for (const [filename, expectedKinds] of cases) {
    const bytes = await _fs.readFile(new URL(filename, FIXTURE_ROOT));
    const document = await extractStructuredSource({
      filename,
      mimeType: filename.endsWith('.md') ? 'text/markdown' : 'text/plain',
      bytes,
    });
    expect(document.blocks.map((block) => block.kind)).toStrictEqual([...expectedKinds]);
  }
});

testCase('image extraction reports missing alternative text', async () => {
  const bytes = await _fs.readFile(new URL('image-heavy.md', FIXTURE_ROOT));
  const document = await extractStructuredSource({
    filename: 'image-heavy.md',
    mimeType: 'text/markdown',
    bytes,
  });
  expect(document.uncertainties.map((entry) => entry.code)).toStrictEqual(['IMAGE_ALT_MISSING']);
});

testCase('PDF extraction reads compressed text and counts real pages without OCR', async () => {
  const bytes = pdfFixture([
    { text: 'Unit 1: Area and Surface Area' },
    { text: 'Unit 2: Ratios; /Type /Page is text, not a page.' },
  ]);
  const original = bytes.slice();
  const document = await extractStructuredSource({
    filename: 'curriculum.pdf',
    mimeType: 'application/pdf',
    bytes,
  });
  if (!(document.text.includes('Unit 1: Area and Surface Area'))) {
    expect.unreachable("Expected document.text.includes('Unit 1: Area and Surface Area')");
  }
  if (!(document.text.includes('Unit 2: Ratios'))) {
    expect.unreachable("Expected document.text.includes('Unit 2: Ratios')");
  }
  expect(sourceDocumentPageCount(document)).toStrictEqual(2);
  expect(document.blocks.filter((block) => block.kind === 'paragraph').map((block) => block.page))
    .toStrictEqual([1, 2]);
  expect(document.uncertainties).toStrictEqual([]);
  expect(pdfNeedsFileExtraction(document)).toStrictEqual(false);
  expect(parseStructuredSourceDocument(document).text).toStrictEqual(document.text);
  expect(bytes).toStrictEqual(original);
});

testCase(
  'mixed PDFs retain readable text and route only real image uncertainty to file reading',
  async () => {
    const bytes = pdfFixture([
      { text: 'A readable curriculum page.' },
      { image: true },
      { text: 'A caption.', image: true },
    ]);
    const document = await extractStructuredSource({
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      bytes,
    });
    expect(document.blocks.filter((block) => block.kind === 'page_boundary').length).toStrictEqual(
      2,
    );
    expect(
      document.uncertainties.filter((entry) => entry.code === 'OCR_REQUIRED').map((entry) =>
        entry.page
      ),
    ).toStrictEqual([2]);
    expect(
      document.uncertainties.filter((entry) => entry.code === 'PDF_TEXT_UNAVAILABLE').map((entry) =>
        entry.page
      ),
    ).toStrictEqual([2]);
    expect(
      document.uncertainties.filter((entry) => entry.code === 'IMAGE_ALT_MISSING').map((entry) =>
        entry.page
      ),
    ).toStrictEqual([3]);
    if (!(document.text.includes('A readable curriculum page.'))) {
      expect.unreachable("Expected document.text.includes('A readable curriculum page.')");
    }
    if (document.text.includes('requires OCR')) {
      expect.unreachable("Expected !document.text.includes('requires OCR')");
    }
    expect(pdfNeedsFileExtraction(document)).toStrictEqual(true);
    expect(parseStructuredSourceDocument(document).text).toStrictEqual(document.text);
  },
);

testCase('blank PDF pages preserve page numbers without pretending to need OCR', async () => {
  const document = await extractStructuredSource({
    filename: 'blank.pdf',
    bytes: pdfFixture([{}, {}, {}]),
  });
  expect(sourceDocumentPageCount(document)).toStrictEqual(3);
  expect(document.uncertainties).toStrictEqual([]);
  expect(pdfNeedsFileExtraction(document)).toStrictEqual(false);
  expect(parseStructuredSourceDocument(document).text).toStrictEqual(document.text);
});

testCase(
  'invalid PDFs fail extraction instead of manufacturing authoritative page text',
  async () => {
    await expect(
      Promise.resolve().then(() =>
        extractStructuredSource({
          filename: 'broken.pdf',
          bytes: new TextEncoder().encode('%PDF-1.7\nnot a PDF'),
        })
      ),
    ).rejects.toBeInstanceOf(SourceExtractionError);
  },
);

testCase('plain text reports inferred structure', () => {
  const document = extractTextDocument('notes.txt', 'text', '# Topic\n\n- First\n- Second');
  if (!(document.uncertainties.some((entry) => entry.code === 'STRUCTURE_INFERRED'))) {
    expect.unreachable(
      "Expected document.uncertainties.some((entry) => entry.code === 'STRUCTURE_INFERRED')",
    );
  }
});

testCase('unsupported source formats fail fast', async () => {
  let failed = false;
  try {
    await extractStructuredSource({
      filename: 'mystery.bin',
      mimeType: 'application/octet-stream',
      bytes: new TextEncoder().encode('not a document'),
    });
  } catch (error) {
    failed = error instanceof Error && error.name === 'SourceExtractionError';
  }
  if (!failed) expect.unreachable('Expected failed');
});
