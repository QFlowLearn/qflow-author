import { expect, it } from 'vitest';
import { extractStructuredSource } from '../lib/conversion/source_extraction.ts';
import { pdfNeedsFileExtraction } from '../lib/conversion/extract_pdf_source.ts';
import {
  renderSourceForGeneration,
  validateGeneratedEvidence,
} from '../lib/conversion/source_evidence.ts';
import { pdfFixture } from '../tests/helpers/pdf_fixture.ts';

it('extracts compressed PDF text in workerd with page-grounded generation and no OCR', async () => {
  const bytes = pdfFixture([
    { text: 'Mathematics 6 Essential Curriculum' },
    { text: 'Find the area of triangles.' },
  ]);
  const document = await extractStructuredSource({
    filename: 'curriculum.pdf',
    mimeType: 'application/pdf',
    bytes,
  });
  expect(document.uncertainties).toEqual([]);
  expect(pdfNeedsFileExtraction(document)).toBe(false);
  expect(renderSourceForGeneration(document)).toContain('[PAGE 2]\nFind the area of triangles.');
  expect(
    validateGeneratedEvidence({
      artifactId: 'pdf',
      artifactHash: 'a'.repeat(64),
      document,
      citations: [{ kind: 'page', page: 2, quote: 'area of triangles' }],
    }).errors,
  ).toEqual([]);
});

it('preserves text in mixed PDFs and identifies image pages for automatic file reading', async () => {
  const document = await extractStructuredSource({
    filename: 'mixed.pdf',
    bytes: pdfFixture([{ text: 'Readable text' }, { image: true }]),
  });
  expect(document.text).toContain('Readable text');
  expect(
    document.uncertainties.filter((entry) => entry.code === 'OCR_REQUIRED').map((entry) =>
      entry.page
    ),
  ).toEqual([2]);
  expect(pdfNeedsFileExtraction(document)).toBe(true);
});
