import { test as testCase } from 'vitest';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsPositionObject } from '../lib/types/position_object.ts';

testCase('position object export emits interaction XML', async () => {
  const draft = defaultsPositionObject();
  draft.title = 'Position Object';
  draft.promptHtml = '  Drag the marker to the correct location.  ';
  draft.responseIdentifier = 'RESPONSE';
  draft.positionStageSrc = 'images/stage.png';
  draft.positionStageAlt = 'Stage';
  draft.positionStageType = 'image/png';
  draft.positionStageWidth = 320;
  draft.positionStageHeight = 240;
  draft.positionObjectSrc = 'images/marker.png';
  draft.positionObjectAlt = 'Marker';
  draft.positionObjectType = 'image/png';
  draft.positionObjectWidth = 16;
  draft.positionObjectHeight = 16;
  draft.positionCenterPoint = '118 184';
  draft.positionTargets = [
    { shape: 'circle', coords: '118,184,12', mappedValue: 1 },
    { shape: 'circle', coords: '150,235,12', mappedValue: 2 },
  ];
  draft.positionCorrectPoints = ['118 184', '150 235'];
  draft.minChoices = 0;
  draft.maxChoices = 2;

  const xml = exportQti3TestItemXml('position_object', draft, { identifier: 'item-position-1' });
  if (!xml.includes('<qti-position-object-stage>')) {
    throw new Error('missing position object stage');
  }
  if (!xml.includes('<qti-position-object-interaction')) {
    throw new Error('missing position object interaction');
  }
  if (!xml.includes('center-point="118 184"')) {
    throw new Error('missing center point');
  }
  if (!xml.includes('data="images/stage.png"')) {
    throw new Error('missing stage image');
  }
  if (!xml.includes('data="images/marker.png"')) {
    throw new Error('missing object image');
  }
  if (!xml.includes('mapped-value="2"')) {
    throw new Error('missing mapped value');
  }
  if (!xml.includes('map_response_point')) {
    throw new Error('missing response processing template');
  }
  if (xml.includes('<qti-prompt')) {
    throw new Error('position-object prompt must be emitted as schema-valid item body content');
  }
  const promptIndex = xml.indexOf('Drag the marker to the correct location.');
  const stageIndex = xml.indexOf('<qti-position-object-stage>');
  if (promptIndex === -1 || promptIndex > stageIndex) {
    throw new Error('position-object prompt content must precede the stage');
  }
  if (!xml.includes('<div>  Drag the marker to the correct location.  </div>')) {
    throw new Error('position-object item-body prompt must preserve authored whitespace');
  }
  await assertQtiXmlWellFormed(xml);
});
