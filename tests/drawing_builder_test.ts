import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsDrawing, validateDrawing } from '../lib/types/drawing.ts';

testCase('drawing export emits drawing interaction XML', async () => {
  const draft = defaultsDrawing();
  draft.title = 'Drawing Item';
  draft.responseIdentifier = 'RESPONSE';
  draft.drawingImageSrc = 'images/canvas.png';
  draft.drawingImageAlt = 'Canvas';
  draft.drawingImageType = 'image/png';
  draft.drawingImageWidth = 320;
  draft.drawingImageHeight = 200;

  const xml = exportQti3TestItemXml('drawing', draft, { identifier: 'item-drawing-1' });
  if (!xml.includes('<qti-drawing-interaction')) {
    throw new Error('missing drawing interaction');
  }
  if (!xml.includes('data="images/canvas.png"')) {
    throw new Error('missing image data');
  }
  if (!xml.includes('width="320"')) {
    throw new Error('missing width');
  }
  if (!xml.includes('height="200"')) {
    throw new Error('missing height');
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('drawing validation requires image type when src type cannot be inferred', () => {
  const draft = defaultsDrawing();
  draft.drawingImageSrc = '/uploads/canvas';
  draft.drawingImageType = '';

  expect(validateDrawing(draft)).toStrictEqual([
    'Drawing image type is required when it cannot be inferred from the image src.',
  ]);
});

testCase('drawing infers SVG MIME type from a data URL', () => {
  const draft = defaultsDrawing();
  draft.drawingImageSrc = 'data:image/svg+xml;base64,PHN2Zy8+';
  draft.drawingImageType = '';

  expect(validateDrawing(draft)).toStrictEqual([]);
  const xml = exportQti3TestItemXml('drawing', draft, { identifier: 'item-drawing-svg' });
  expect(xml.includes('type="image/svg+xml"')).toStrictEqual(true);
});
