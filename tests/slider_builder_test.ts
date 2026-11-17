import { test as testCase } from 'vitest';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsSlider } from '../lib/types/slider.ts';

testCase('slider export emits interaction XML', async () => {
  const draft = defaultsSlider();
  draft.title = 'Slider';
  draft.responseIdentifier = 'RESPONSE';
  draft.sliderLowerBound = 0;
  draft.sliderUpperBound = 100;
  draft.sliderStep = 10;
  draft.sliderStepLabel = false;
  draft.sliderOrientation = 'horizontal';
  draft.sliderCorrectValue = 70;
  draft.sliderMappings = [
    { mapKey: 60, mappedValue: 0.5 },
    { mapKey: 70, mappedValue: 1 },
  ];

  const xml = exportQti3TestItemXml('slider', draft, { identifier: 'item-slider-1' });
  if (!xml.includes('<qti-slider-interaction')) {
    throw new Error('missing slider interaction');
  }
  if (!xml.includes('lower-bound="0"')) {
    throw new Error('missing lower bound');
  }
  if (!xml.includes('upper-bound="100"')) {
    throw new Error('missing upper bound');
  }
  if (!xml.includes('map_response')) {
    throw new Error('missing response processing template');
  }
  await assertQtiXmlWellFormed(xml);
});
