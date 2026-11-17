import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { type DrawingDraft } from '../lib/types/drawing.ts';
import { draftOfType } from './import_draft.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'drawing.xml';

testCase('drawing import: fixture → draft preserves fields', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<DrawingDraft>(parsed, 'drawing');
  expect(draft.drawingImageSrc).toStrictEqual('images/house.png');
  expect(draft.drawingImageType).toStrictEqual('image/png');
  expect(draft.drawingImageWidth).toStrictEqual(144);
  expect(draft.drawingImageHeight).toStrictEqual(260);
  if (!((draft.promptHtml ?? '').includes('Il tetto'))) {
    expect.unreachable("Expected (draft.promptHtml ?? '').includes('Il tetto')");
  }
  if (!((draft.bodyHtml ?? '').includes('Giovanni'))) {
    expect.unreachable("Expected (draft.bodyHtml ?? '').includes('Giovanni')");
  }
});

testCase('drawing import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<DrawingDraft>(parsed, 'drawing');
  const rebuilt = exportQti3TestItemXml(
    'drawing',
    {
      title: draft.title,
      promptHtml: draft.promptHtml,
      bodyHtml: draft.bodyHtml,
      responseIdentifier: draft.responseIdentifier,
      drawingImageSrc: draft.drawingImageSrc,
      drawingImageAlt: draft.drawingImageAlt,
      drawingImageType: draft.drawingImageType,
      drawingImageWidth: draft.drawingImageWidth,
      drawingImageHeight: draft.drawingImageHeight,
    },
    { identifier: 'item-drawing-roundtrip' },
  );
  if (!(rebuilt.includes('data="images/house.png"'))) {
    expect.unreachable('Expected rebuilt.includes(\'data="images/house.png"\')');
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  expect(draftOfType<DrawingDraft>(reparsed, 'drawing').drawingImageSrc).toStrictEqual(
    'images/house.png',
  );
});
