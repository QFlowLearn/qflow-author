import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import type { DriverDraft } from '../lib/types/registry.ts';

import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'hotspot-qti3.xml';

testCase('hotspot import: fixture → draft contains choices + image', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<DriverDraft<'hotspot'>>(parsed, 'hotspot');
  expect(draft.hotspotImageSrc).toStrictEqual('ukair.png');
  const choices = draft.choices;
  const correct = draft.correctIds ?? [];
  if (!(choices.length >= 1)) expect.unreachable('Expected choices.length >= 1');
  if (!(correct.length >= 1)) expect.unreachable('Expected correct.length >= 1');
  if (!(choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0))) {
    expect.unreachable(
      "Expected choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0)",
    );
  }
  if (!(correct.every((id: unknown) => typeof id === 'string' && id.length > 0))) {
    expect.unreachable(
      "Expected correct.every((id: unknown) => typeof id === 'string' && id.length > 0)",
    );
  }
});

testCase('hotspot import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);
  const parsed = parseItemXml(xml);
  const draft = draftOfType<DriverDraft<'hotspot'>>(parsed, 'hotspot');
  const rebuilt = exportQti3TestItemXml('hotspot', {
    title: draft.title ?? '',
    promptHtml: draft.promptHtml,
    hotspotImageSrc: draft.hotspotImageSrc,
    hotspotImageAlt: draft.hotspotImageAlt,
    hotspotImageLongDesc: draft.hotspotImageLongDesc,
    responseIdentifier: draft.responseIdentifier,
    maxChoices: draft.maxChoices,
    minChoices: draft.minChoices,
    maxChoicesMessage: draft.maxChoicesMessage,
    minChoicesMessage: draft.minChoicesMessage,
    choices: draft.choices,
    correctIds: draft.correctIds ?? [],
  }, { identifier: 'item-hotspot-roundtrip' });
  if (!(rebuilt.includes('data="ukair.png"'))) {
    expect.unreachable('Expected rebuilt.includes(\'data="ukair.png"\')');
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  expect(draftOfType<DriverDraft<'hotspot'>>(reparsed, 'hotspot').hotspotImageSrc).toStrictEqual(
    'ukair.png',
  );
});
