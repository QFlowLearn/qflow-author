import { expect, test as testCase } from 'vitest';

import {
  InvalidStoredSourceError,
  parseStructuredSourceDocument,
} from '../lib/conversion/source_codec.ts';
import {
  renderSourceForGeneration,
  validateGeneratedEvidence,
} from '../lib/conversion/source_evidence.ts';
import { extractStructuredSource } from '../lib/conversion/source_extraction.ts';
import { sourceBlocksToText } from '../lib/conversion/source_model.ts';
import { pdfFixture } from './helpers/pdf_fixture.ts';
import type { StructuredSourceDocument } from '../lib/conversion/source_model.ts';

const HASH = 'a'.repeat(64);
const DOCUMENT: StructuredSourceDocument = {
  version: 1,
  title: 'Plate tectonics',
  sourceKind: 'text',
  blocks: [{
    id: 'block-1',
    kind: 'paragraph',
    text: 'Tectonic plates move slowly across Earth’s mantle.',
  }],
  text: 'Tectonic plates move slowly across Earth’s mantle.',
  uncertainties: [],
};

testCase('generated evidence persists only exact quotes from an existing source block', () => {
  const valid = validateGeneratedEvidence({
    artifactId: 'artifact-1',
    artifactHash: HASH,
    document: DOCUMENT,
    citations: [{
      kind: 'block',
      blockId: 'block-1',
      quote: 'plates move slowly',
    }],
  });
  expect(valid.errors).toStrictEqual([]);
  expect(valid.anchors).toStrictEqual([{
    kind: 'block',
    artifactId: 'artifact-1',
    artifactHash: HASH,
    blockId: 'block-1',
    quote: 'plates move slowly',
  }]);

  const invented = validateGeneratedEvidence({
    artifactId: 'artifact-1',
    artifactHash: HASH,
    document: DOCUMENT,
    citations: [{
      kind: 'block',
      blockId: 'block-1',
      quote: 'plates never move',
    }],
  });
  expect(invented.anchors).toStrictEqual([]);
  expect(invented.errors.length).toStrictEqual(1);
});

testCase('structured source persistence rejects unknown fields instead of repairing them', () => {
  expect(() => parseStructuredSourceDocument({ ...DOCUMENT, legacyText: DOCUMENT.text }))
    .toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof InvalidStoredSourceError && caught.message.includes('unknown: legacyText')
      ),
    );
});

testCase(
  'PDF generation sees real text with page references and verifies quotes against that page',
  async () => {
    const document = await extractStructuredSource({
      filename: 'curriculum.pdf',
      bytes: pdfFixture([
        { text: 'Find the area of triangles.' },
        { text: 'Use ratio language in a context.' },
      ]),
    });
    const prompt = renderSourceForGeneration(document);
    if (!(prompt.includes('[PAGE 1]\nFind the area of triangles.'))) {
      expect.unreachable("Expected prompt.includes('[PAGE 1]\\nFind the area of triangles.')");
    }
    if (!(prompt.includes('[PAGE 2]\nUse ratio language in a context.'))) {
      expect.unreachable("Expected prompt.includes('[PAGE 2]\\nUse ratio language in a context.')");
    }
    const validate = (page: number, quote: string) =>
      validateGeneratedEvidence({
        artifactId: 'pdf-1',
        artifactHash: HASH,
        document,
        citations: [{ kind: 'page', page, quote }],
      });
    expect(validate(2, 'Use ratio language').errors).toStrictEqual([]);
    expect(validate(1, 'Use ratio language').anchors).toStrictEqual([]);
    expect(validate(2, 'invented source quote').anchors).toStrictEqual([]);
    expect(validate(3, 'Use ratio language').anchors).toStrictEqual([]);
  },
);

testCase(
  'PDF evidence handles line wrapping and Unicode math glyphs without accepting empty quotes',
  () => {
    const blocks = [{
      id: 'block-1',
      kind: 'paragraph' as const,
      page: 1,
      text: 'Find the area\nof triangles. 𝑉 = 𝑙𝑤ℎ',
    }];
    const document: StructuredSourceDocument = {
      version: 1,
      title: 'Math',
      sourceKind: 'pdf',
      blocks,
      text: sourceBlocksToText(blocks),
      uncertainties: [],
    };
    const validate = (quote: string) =>
      validateGeneratedEvidence({
        artifactId: 'pdf-1',
        artifactHash: HASH,
        document,
        citations: [{ kind: 'page', page: 1, quote }],
      });
    expect(validate('area of triangles. V = lwh').errors).toStrictEqual([]);
    expect(validate('   ').anchors).toStrictEqual([]);
  },
);

testCase('unreadable PDF pages keep model quotes unverified for review', async () => {
  const document = await extractStructuredSource({
    filename: 'scan.pdf',
    bytes: pdfFixture([{ image: true }]),
  });
  const result = validateGeneratedEvidence({
    artifactId: 'pdf-1',
    artifactHash: HASH,
    document,
    citations: [{ kind: 'page', page: 1, quote: 'Unverifiable scanned text' }],
  });
  expect(result.anchors).toStrictEqual([]);
  expect(result.errors.length).toStrictEqual(1);
});
