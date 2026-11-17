import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { type PositionObjectDraft } from '../lib/types/position_object.ts';
import { draftOfType } from './import_draft.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'position_object.xml';

testCase('position object import: fixture → draft preserves fields', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<PositionObjectDraft>(parsed, 'position_object');
  expect(draft.positionStageSrc).toStrictEqual('images/uk.png');
  expect(draft.positionStageType).toStrictEqual('image/png');
  expect(draft.positionStageWidth).toStrictEqual(206);
  expect(draft.positionStageHeight).toStrictEqual(280);
  expect(draft.positionObjectSrc).toStrictEqual('images/airport.png');
  expect(draft.positionObjectType).toStrictEqual('image/png');
  expect(draft.positionObjectWidth).toStrictEqual(16);
  expect(draft.positionObjectHeight).toStrictEqual(16);
  expect(draft.maxChoices).toStrictEqual(3);
  expect(draft.positionCorrectPoints?.length).toStrictEqual(3);
  expect(draft.positionTargets?.length).toStrictEqual(3);
  if (!((draft.bodyHtml ?? '').includes('Edinburgh'))) {
    expect.unreachable("Expected (draft.bodyHtml ?? '').includes('Edinburgh')");
  }
});

testCase(
  'position object import round-trip: fixture → draft → qti3 export → re-import',
  async () => {
    const xml = await readQtiFixture(FIXTURE);

    const parsed = parseItemXml(xml);
    const draft = draftOfType<PositionObjectDraft>(parsed, 'position_object');
    const rebuilt = exportQti3TestItemXml(
      'position_object',
      {
        title: draft.title,
        promptHtml: draft.promptHtml,
        bodyHtml: draft.bodyHtml,
        responseIdentifier: draft.responseIdentifier,
        positionStageSrc: draft.positionStageSrc,
        positionStageAlt: draft.positionStageAlt,
        positionStageType: draft.positionStageType,
        positionStageWidth: draft.positionStageWidth,
        positionStageHeight: draft.positionStageHeight,
        positionObjectSrc: draft.positionObjectSrc,
        positionObjectAlt: draft.positionObjectAlt,
        positionObjectType: draft.positionObjectType,
        positionObjectWidth: draft.positionObjectWidth,
        positionObjectHeight: draft.positionObjectHeight,
        positionCenterPoint: draft.positionCenterPoint,
        positionTargets: draft.positionTargets,
        positionCorrectPoints: draft.positionCorrectPoints,
        minChoices: draft.minChoices,
        maxChoices: draft.maxChoices,
      },
      { identifier: 'item-position-roundtrip' },
    );

    if (!(rebuilt.includes('data="images/uk.png"'))) {
      expect.unreachable('Expected rebuilt.includes(\'data="images/uk.png"\')');
    }
    if (!(rebuilt.includes('data="images/airport.png"'))) {
      expect.unreachable('Expected rebuilt.includes(\'data="images/airport.png"\')');
    }
    await assertQtiXmlWellFormed(rebuilt);

    const reparsed = parseItemXml(rebuilt);
    const reDraft = draftOfType<PositionObjectDraft>(reparsed, 'position_object');
    expect(reDraft.positionStageSrc).toStrictEqual('images/uk.png');
    expect(reDraft.positionObjectSrc).toStrictEqual('images/airport.png');
    expect(reDraft.positionCorrectPoints?.length).toStrictEqual(3);
    expect(reDraft.positionTargets?.length).toStrictEqual(3);
  },
);
