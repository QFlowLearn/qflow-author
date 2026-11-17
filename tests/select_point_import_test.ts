import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { type SelectPointDraft } from '../lib/types/select_point.ts';
import { draftOfType } from './import_draft.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'select_point.xml';

testCase('select point import: fixture → draft preserves fields', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<SelectPointDraft>(parsed, 'select_point');
  expect(draft.selectPointImageSrc).toStrictEqual('images/uk.png');
  expect(draft.selectPointImageWidth).toStrictEqual(196);
  expect(draft.selectPointImageHeight).toStrictEqual(280);
  expect(draft.maxChoices).toStrictEqual(1);
  expect(draft.selectPointCorrectPoints?.length).toStrictEqual(1);
  expect(draft.selectPointTargets?.length).toStrictEqual(1);
  if (!((draft.promptHtml ?? '').includes('Mark Edinburgh'))) {
    expect.unreachable("Expected (draft.promptHtml ?? '').includes('Mark Edinburgh')");
  }
});

testCase('select point import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<SelectPointDraft>(parsed, 'select_point');
  const rebuilt = exportQti3TestItemXml('select_point', {
    title: draft.title,
    promptHtml: draft.promptHtml,
    bodyHtml: draft.bodyHtml,
    responseIdentifier: draft.responseIdentifier,
    selectPointImageSrc: draft.selectPointImageSrc,
    selectPointImageAlt: draft.selectPointImageAlt,
    selectPointImageWidth: draft.selectPointImageWidth,
    selectPointImageHeight: draft.selectPointImageHeight,
    selectPointTargets: draft.selectPointTargets,
    selectPointCorrectPoints: draft.selectPointCorrectPoints,
    minChoices: draft.minChoices,
    maxChoices: draft.maxChoices,
  }, { identifier: 'item-select-point-roundtrip' });

  if (!(rebuilt.includes('data="images/uk.png"'))) {
    expect.unreachable('Expected rebuilt.includes(\'data="images/uk.png"\')');
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  const reDraft = draftOfType<SelectPointDraft>(reparsed, 'select_point');
  expect(reDraft.selectPointImageSrc).toStrictEqual('images/uk.png');
  expect(reDraft.selectPointCorrectPoints?.length).toStrictEqual(1);
  expect(reDraft.selectPointTargets?.length).toStrictEqual(1);
});
