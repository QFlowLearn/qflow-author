import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { type SliderDraft } from '../lib/types/slider.ts';
import { draftOfType } from './import_draft.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'slider.xml';

testCase('slider import: fixture → draft preserves fields', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<SliderDraft>(parsed, 'slider');
  expect(draft.sliderLowerBound).toStrictEqual(0);
  expect(draft.sliderUpperBound).toStrictEqual(100);
  expect(draft.sliderStep).toStrictEqual(1);
  expect(draft.sliderStepLabel).toStrictEqual(false);
  expect(draft.sliderCorrectValue).toStrictEqual(16);
  expect(draft.sliderMappings?.length).toStrictEqual(9);
  if (!((draft.promptHtml ?? '').includes('percentage'))) {
    expect.unreachable("Expected (draft.promptHtml ?? '').includes('percentage')");
  }
});

testCase('slider import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<SliderDraft>(parsed, 'slider');
  const rebuilt = exportQti3TestItemXml(
    'slider',
    {
      title: draft.title,
      promptHtml: draft.promptHtml,
      bodyHtml: draft.bodyHtml,
      responseIdentifier: draft.responseIdentifier,
      sliderLowerBound: draft.sliderLowerBound,
      sliderUpperBound: draft.sliderUpperBound,
      sliderStep: draft.sliderStep,
      sliderStepLabel: draft.sliderStepLabel,
      sliderOrientation: draft.sliderOrientation,
      sliderReverse: draft.sliderReverse,
      sliderCorrectValue: draft.sliderCorrectValue,
      sliderMappings: draft.sliderMappings,
    },
    { identifier: 'item-slider-roundtrip' },
  );

  if (!(rebuilt.includes('lower-bound="0"'))) {
    expect.unreachable('Expected rebuilt.includes(\'lower-bound="0"\')');
  }
  if (!(rebuilt.includes('upper-bound="100"'))) {
    expect.unreachable('Expected rebuilt.includes(\'upper-bound="100"\')');
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  const reDraft = draftOfType<SliderDraft>(reparsed, 'slider');
  expect(reDraft.sliderLowerBound).toStrictEqual(0);
  expect(reDraft.sliderUpperBound).toStrictEqual(100);
  expect(reDraft.sliderMappings?.length).toStrictEqual(9);
});
