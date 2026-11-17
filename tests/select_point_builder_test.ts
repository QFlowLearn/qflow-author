import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsSelectPoint, validateSelectPoint } from '../lib/types/select_point.ts';
import { selectPointCardinalityPolicy } from '../lib/types/select_point_cardinality.ts';

testCase('select point export emits interaction XML', async () => {
  const draft = defaultsSelectPoint();
  draft.title = 'Select Point';
  draft.responseIdentifier = 'RESPONSE';
  draft.selectPointImageSrc = 'images/map.png';
  draft.selectPointImageAlt = 'Map';
  draft.selectPointImageWidth = 196;
  draft.selectPointImageHeight = 280;
  draft.selectPointTargets = [
    { shape: 'circle', coords: '102,113,16', mappedValue: 1 },
  ];
  draft.selectPointCorrectPoints = ['102 113'];
  draft.minChoices = 0;
  draft.maxChoices = 1;

  const xml = exportQti3TestItemXml('select_point', draft, { identifier: 'item-select-point-1' });
  if (!xml.includes('<qti-select-point-interaction')) {
    throw new Error('missing select point interaction');
  }
  if (!xml.includes('data="images/map.png"')) {
    throw new Error('missing image data');
  }
  if (!xml.includes('map_response_point')) {
    throw new Error('missing response processing template');
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('select point supports multiple correct points up to its configured maximum', () => {
  const draft = defaultsSelectPoint();
  draft.maxChoices = 2;
  draft.selectPointCorrectPoints = ['102 113', '140 160'];

  expect(validateSelectPoint(draft)).toStrictEqual([]);

  const xml = exportQti3TestItemXml('select_point', draft, {
    identifier: 'item-select-point-multiple',
  });
  expect(xml).toContain('cardinality="multiple"');
  expect(xml).toContain('max-choices="2"');
  expect(xml).toContain('<qti-value>102 113</qti-value>');
  expect(xml).toContain('<qti-value>140 160</qti-value>');
});

testCase('select point preserves zero as an unlimited maximum', () => {
  const draft = defaultsSelectPoint();
  draft.maxChoices = 0;
  draft.selectPointCorrectPoints = ['102 113', '140 160'];

  expect(validateSelectPoint(draft)).toStrictEqual([]);

  const xml = exportQti3TestItemXml('select_point', draft, {
    identifier: 'item-select-point-unlimited',
  });
  expect(xml).toContain('cardinality="multiple"');
  expect(xml).toContain('max-choices="0"');
});

testCase('select point validates correct points against a finite maximum', () => {
  const draft = defaultsSelectPoint();
  draft.maxChoices = 2;
  draft.selectPointCorrectPoints = ['10 10', '20 20', '30 30'];

  expect(validateSelectPoint(draft)).toStrictEqual([
    'Correct points cannot exceed the maximum of 2.',
  ]);
});

testCase('select point cardinality policy owns single, finite, and unlimited limits', () => {
  expect(selectPointCardinalityPolicy(undefined)).toStrictEqual({
    maxChoices: undefined,
    pointLimit: 1,
    responseCardinality: 'single',
  });
  expect(selectPointCardinalityPolicy(2)).toStrictEqual({
    maxChoices: 2,
    pointLimit: 2,
    responseCardinality: 'multiple',
  });
  expect(selectPointCardinalityPolicy(0)).toStrictEqual({
    maxChoices: 0,
    pointLimit: undefined,
    responseCardinality: 'multiple',
  });
});
